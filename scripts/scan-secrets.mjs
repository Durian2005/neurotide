#!/usr/bin/env node
// 入库前脱敏扫描：在提交前把"不该进仓库"的内容拦下来。
//
// 仓库是公开的，而本项目在本地开发时会自然产生三类敏感痕迹：
// 1. 本机路径（用户名、盘符、项目绝对路径）；
// 2. 个人身份信息（邮箱、手机号）；
// 3. 凭据（各类 token / 私钥 / 密钥赋值）。
//
// 用法：node scripts/scan-secrets.mjs [--staged] [--strict]
//   --staged 只扫描已暂存的文件（适合 pre-commit）
//   --strict git 不可用时直接以退出码 2 失败（只要降级就别放过）
// 命中即返回退出码 1。误报可在该行加注释 scan-secrets-allow 放行。
//
// 退出码：0 通过 / 1 命中敏感内容 / 2 扫描范围降级且开启了 --strict

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SELF = 'scripts/scan-secrets.mjs'
const onlyStaged = process.argv.includes('--staged')
const strict = process.argv.includes('--strict')

// 用字符拼接构造敏感词，避免扫描脚本把自己的规则文本当成命中项
const ME = ['dur', 'ian'].join('')

/** 纯文本二进制后缀，跳过以免误报（大文件 / 资源） */
const SKIP_EXT = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|wasm|traineddata|pdf|zip|gz|mp4|mp3)$/i
/** 单文件扫描上限，避免把巨型产物读进内存 */
const MAX_BYTES = 2 * 1024 * 1024

const RULES = [
  {
    name: '本机用户名',
    re: new RegExp(`\\b${ME}\\b`, 'i'),
    hint: '本机 Windows 用户名，替换为 <user> 或泛化描述',
  },
  {
    name: 'Windows 用户目录',
    re: /[A-Za-z]:\\{1,2}Users\\{1,2}(?!<|\$|\{)/,
    hint: '绝对路径泄露，改用相对路径',
  },
  {
    name: 'Windows 盘符绝对路径',
    re: /[A-Za-z]:\\{1,2}(?![a-z\\])[A-Za-z0-9_.-]+\\{1,2}/,
    hint: '确认该路径是否必须写死，优先使用相对路径或占位符',
  },
  {
    name: '邮箱地址',
    re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/,
    hint: '若为 GitHub noreply 地址可放行（见 allowlist）',
    allowlist: [/users\.noreply\.github\.com$/i, /example\.(com|org)$/i, /@qq\.com$/i],
  },
  {
    name: '疑似手机号',
    re: /(?<!\d)1[3-9]\d{9}(?!\d)/,
    hint: '个人手机号',
  },
  {
    name: 'GitHub Token',
    re: /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/,
    hint: '立即吊销该 token 并改用环境变量',
  },
  {
    name: '云厂商密钥',
    re: /\b(AKIA[0-9A-Z]{12,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/,
    hint: '立即吊销该密钥',
  },
  {
    name: '私钥文件内容',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    hint: '私钥绝不能入库',
  },
  {
    name: '疑似硬编码口令',
    re: /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    hint: '凭据应通过配置文件或环境变量注入',
  },
]

/** 降级遍历时跳过的目录 */
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '.workbuddy', 'public', '.trae'])

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** 同步睡眠（Atomics.wait 阻塞当前线程，避免为了退避引入异步） */
function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

/**
 * git 瞬时失败的错误码：EBUSY（Windows 上偶发，索引文件被占用）、
 * EAGAIN / ENOMEM / EMFILE / ETIMEDOUT 一类资源竞争。
 * 这些都是重试就能过去的，不该把扫描悄悄降级掉。
 */
const TRANSIENT = new Set(['EBUSY', 'EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE', 'ETIMEDOUT'])

const GIT_ATTEMPTS = 4
const GIT_BACKOFF_MS = [120, 400, 1200]

function classifyGitError(err) {
  const code = err?.code
  if (code === 'ENOENT') return { kind: 'no-git', message: '未找到 git 可执行文件' }
  if (err?.stderr && /not a git repository/i.test(String(err.stderr))) {
    return { kind: 'no-repo', message: '当前目录不在 git 仓库内' }
  }
  if (TRANSIENT.has(code)) {
    return { kind: 'transient', message: `git 调用瞬时失败（${code}）` }
  }
  const stderr = String(err?.stderr ?? '')
    .trim()
    .split('\n')[0]
  return { kind: 'fatal', message: `git 调用失败（${code ?? 'unknown'}${stderr ? `：${stderr}` : ''}）` }
}

function gitFileList(args) {
  let lastErr
  for (let attempt = 0; attempt < GIT_ATTEMPTS; attempt++) {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Windows 下 git 的 stdout 管道偶发 EBUSY，显式声明编码走文本通道
        windowsHide: true,
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch (err) {
      lastErr = err
      const { kind } = classifyGitError(err)
      // 只有瞬时失败值得重试；缺 git / 非仓库 / 语义错误重试也没用
      if (kind !== 'transient') break
      if (attempt < GIT_BACKOFF_MS.length) sleepSync(GIT_BACKOFF_MS[attempt])
    }
  }
  throw lastErr
}

function listFiles() {
  const args = onlyStaged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files', '--cached', '--others', '--exclude-standard']
  try {
    return { files: gitFileList(args), degraded: null }
  } catch (err) {
    const { kind, message } = classifyGitError(err)
    if (kind === 'transient' || kind === 'fatal') {
      // 重试已尽还失败 = 扫描范围不可信，宁可失败也不放行
      console.error(`脱敏扫描无法确定文件清单：${message}（已重试 ${GIT_ATTEMPTS} 次）。`)
      console.error(
        kind === 'transient'
          ? '这是 Windows 上的瞬时占用，多半重跑一次即可；确认 git 仓库状态正常后请重试。'
          : '请检查 git 是否可用、仓库是否完整。',
      )
      process.exit(2)
    }
    // 从压缩包解压、尚未 git init 时也能用：退化为目录遍历
    console.log(`提示：${message}，改为遍历当前目录（已跳过 node_modules / dist / public）。`)
    return { files: walk('.'), degraded: kind }
  }
}

function scan(file) {
  if (file === SELF || SKIP_EXT.test(file) || !existsSync(file)) return []
  let text
  try {
    const raw = readFileSync(file)
    if (raw.byteLength > MAX_BYTES) return []
    text = raw.toString('utf8')
  } catch {
    return []
  }

  const findings = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('scan-secrets-allow')) continue

    for (const rule of RULES) {
      const matched = line.match(rule.re)
      if (!matched) continue
      if (rule.allowlist?.some((allowed) => allowed.test(matched[0]))) continue
      findings.push({
        file,
        line: i + 1,
        rule: rule.name,
        hint: rule.hint,
        // 只回显片段，避免把命中的真实内容二次写进日志
        excerpt: line.trim().slice(0, 110),
      })
    }
  }
  return findings
}

const { files, degraded } = listFiles()
const findings = files.flatMap(scan)
const scope = onlyStaged ? '已暂存文件' : '待入库文件'

if (findings.length === 0) {
  console.log(`脱敏扫描通过：${scope} ${files.length} 个，未发现敏感内容。`)
  // 降级遍历比 git 清单范围更大（跳过 public/），仅在 --strict 下视为不可信
  process.exit(strict && degraded ? 2 : 0)
}

console.error(`脱敏扫描发现 ${findings.length} 处可疑内容（${scope} ${files.length} 个）：\n`)
for (const item of findings) {
  console.error(`  ${item.file}:${item.line}  [${item.rule}]`)
  console.error(`    ${item.excerpt}`)
  console.error(`    → ${item.hint}\n`)
}
console.error('确认为误报时，在该行加注释 scan-secrets-allow 即可放行。')
process.exit(strict && degraded ? 2 : 1)
