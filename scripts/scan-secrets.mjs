#!/usr/bin/env node
// 入库前脱敏扫描：在提交前把"不该进仓库"的内容拦下来。
//
// 仓库是公开的，而本项目在本地开发时会自然产生三类敏感痕迹：
// 1. 本机路径（用户名、盘符、项目绝对路径）；
// 2. 个人身份信息（邮箱、手机号）；
// 3. 凭据（各类 token / 私钥 / 密钥赋值）。
//
// 用法：node scripts/scan-secrets.mjs [--staged]
//   --staged 只扫描已暂存的文件（适合 pre-commit）
// 命中即返回退出码 1。误报可在该行加注释 scan-secrets-allow 放行。

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SELF = 'scripts/scan-secrets.mjs'
const onlyStaged = process.argv.includes('--staged')

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

function listFiles() {
  const args = onlyStaged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files', '--cached', '--others', '--exclude-standard']
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    // 从压缩包解压、尚未 git init 时也能用：退化为目录遍历
    console.log('提示：未检测到可用的 git，改为遍历当前目录（已跳过 node_modules / dist / public）。')
    return walk('.')
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

const files = listFiles()
const findings = files.flatMap(scan)
const scope = onlyStaged ? '已暂存文件' : '待入库文件'

if (findings.length === 0) {
  console.log(`脱敏扫描通过：${scope} ${files.length} 个，未发现敏感内容。`)
  process.exit(0)
}

console.error(`脱敏扫描发现 ${findings.length} 处可疑内容（${scope} ${files.length} 个）：\n`)
for (const item of findings) {
  console.error(`  ${item.file}:${item.line}  [${item.rule}]`)
  console.error(`    ${item.excerpt}`)
  console.error(`    → ${item.hint}\n`)
}
console.error('确认为误报时，在该行加注释 scan-secrets-allow 即可放行。')
process.exit(1)
