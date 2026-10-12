#!/usr/bin/env node
// 打包分发产物。
//
// 形态（方案 A）：
//   release/neurotide-lite.html      单文件，双击即用，不含 OCR 资源
//   release/neurotide-full/           完整目录：index.html + ocr/ + serve 脚本 + 启动器
//   release/neurotide-ocr-pack.zip    可选 OCR 包，给已有单文件的人补上截图识别
//
// 为什么拆两半：产物是单文件，但截图 OCR 必须发独立请求加载
// worker / wasm / traineddata（约 9MB），浏览器在 file:// 下不加载这些。
// 所以「零安装的lite」和「能用OCR 的 full」天然互斥，只能二选一或分开发。
//
// 用法：npm run package
//   --build先构建再打包（需要能拉起 npm；部分受限环境不允许 spawn .cmd，
//            此时请手动 npm run build 后用默认的 --skip-build 行为）
//   --zip   额外产出 zip（full 目录已在 release/ 下，zip 仅为方便传文件）
//
// 默认不构建：直接用现有 dist/。这既省一次构建，也让本脚本在
// 无法 spawn npm 的受限环境里依然可用。

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const args = new Set(process.argv.slice(2))
const wantBuild = args.has('--build')
const wantZip = args.has('--zip')

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const RELEASE = join(ROOT, 'release')
const LITE = join(RELEASE, 'neurotide-lite.html')
const FULL = join(RELEASE, 'neurotide-full')

function fail(message) {
  console.error(`打包失败：${message}`)
  process.exit(1)
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 目录总字节数（如实汇报体积，不依赖 git 或 shell） */
function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else if (entry.isFile()) total += statSync(full).size
  }
  return total
}

if (wantBuild) {
  console.log('正在构建产物（npm run build）...')
  // Windows 上 npm 是 npm.cmd，必须显式补后缀；另外部分受限环境不允许
  // spawn .cmd（会报 spawnSync EINVAL），这两种情况都给出明确指引而非含糊报错。
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  try {
    execFileSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  } catch (err) {
    if (err?.code === 'EINVAL') {
      fail('当前环境不允许脚本拉起 npm。请手动执行 npm run build，再运行 npm run package。')
    }
    fail('构建未通过，请先修复构建错误。')
  }
}

const indexHtml = join(DIST, 'index.html')
if (!existsSync(indexHtml)) {
  fail(`未找到 ${indexHtml}。请先运行 npm run build（或 npm run package -- --build）。`)
}

const ocrDir = join(DIST, 'ocr')
const hasOcr = existsSync(join(ocrDir, 'lang', 'chi_sim.traineddata'))
const ocrSize = hasOcr ? dirSize(ocrDir) : 0

// 产物是单文件 +相对路径，理论上可直接file:// 打开。
// 但 OCR 资源若被内联进 HTML 会暴涨到 9MB+，这里明确拒绝，避免误产出巨型文件。
const liteSource = readFileSync(indexHtml, 'utf8')
if (/<script[^>]+src=/.test(liteSource) || /<link[^>]+rel=["']?stylesheet/.test(liteSource)) {
  fail('产物里仍有外部 script/stylesheet 引用，说明资源没有内联，不能作为单文件分发。')
}
if (/<link[^>]+rel=["']?preload/.test(liteSource)) {
  console.warn('警告：产物包含 preload 预加载，单文件场景下可能无效。')
}

console.log('\n正在准备 release/ ...')
rmSync(RELEASE, { recursive: true, force: true })
mkdirSync(RELEASE, { recursive: true })

// ① lite：单文件
cpSync(indexHtml, LITE)

// ② full：完整目录（含 OCR 与启动器）
mkdirSync(FULL, { recursive: true })
cpSync(indexHtml, join(FULL, 'index.html'))
if (hasOcr) cpSync(ocrDir, join(FULL, 'ocr'), { recursive: true })
// 启动器与服务器脚本：让收到包的人无需安装 Node。
// full 包里 index.html 与 serve.ps1 同级，所以这里用模板生成而不是改写仓库里的
// 那个（那份还兼有「源码仓库先构建」的职责，语义不同，强行 sed 替换容易漏）。
// ⚠️ 必须写 CRLF：LF 会让多行 if (...) 块在双击时秒退。
const FULL_LAUNCHER = [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  '',
  'echo.',
  'echo   NeuroTide 本地启动器',
  'echo   ----------------------------------------',
  'echo   本窗口是本地静态服务器（仅监听 127.0.0.1，',
  'echo   不会上传任何数据）。关闭窗口即停止。',
  'echo.',
  'echo   启动后请用页面上传聊天截图，即可使用本地 OCR。',
  'echo.',
  '',
  'if not exist "%~dp0index.html" (',
  '  echo   包内缺少 index.html，请重新解压完整压缩包。',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'if not exist "%~dp0serve.ps1" (',
  '  echo   包内缺少 serve.ps1，请重新解压完整压缩包。',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'if not exist "%~dp0ocr\\lang\\chi_sim.traineddata" (',
  '  echo   未检测到 OCR 引擎（ocr 目录不完整），截图 OCR 将不可用。',
  '  echo.',
  ')',
  '',
  'echo   正在启动并打开浏览器...',
  'rem -ExecutionPolicy Bypass 只对本进程生效，不会改动机器的全局执行策略',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 4173 -Root "%~dp0"',
  '',
  'echo.',
  'echo   服务已停止，按任意键关闭窗口。',
  'pause >nul',
  '',
].join('\r\n')
writeFileSync(join(FULL, 'open-neurotide.bat'), Buffer.from(FULL_LAUNCHER, 'utf8'))
cpSync(join(ROOT, 'scripts', 'serve.ps1'), join(FULL, 'serve.ps1'))

// ③ 使用说明
const liteSize = statSync(LITE).size
writeFileSync(
  join(FULL, '使用说明.txt'),
  [
    'NeuroTide —— 个人情绪地图',
    '',
    '两种用法，按需选择：',
    '',
    '【一】只分析聊天记录（最简单）',
    '  直接双击 index.html。不需要本窗口、不需要联网、不需要装任何东西。',
    '  局限：截图 OCR（上传聊天截图识别文字）不可用。',
    '',
    '【二】需要截图 OCR',
    '  双击 open-neurotide.bat，会自动起一个本地服务并打开浏览器。',
    '  关掉那个黑窗口即停止服务。',
    '  本机无需安装 Node 或任何运行时。',
    '',
    '安全说明：',
    '  - 服务只监听 127.0.0.1，局域网内其他设备无法访问；',
    '  - 页面不会上传任何数据，所有解析与计算都在你自己的浏览器里完成；',
    '  - 但请注意：以 file:// 打开的本地网页共用同一个浏览器存储域，',
    '    也就是说你机器上其它本地 HTML 页面理论上能读到同一份存储。',
    '    用完可在页面里点「清空本地数据」。',
    '',
    `体积：单文件 ${humanSize(liteSize)}${hasOcr ? `，OCR 引擎约 ${humanSize(ocrSize)}` : '（本包未含 OCR 引擎）'}`,
    '',
  ].join('\r\n'),
  'utf8',
)

const manifest = {
  name: 'neurotide',
  builtFrom: 'dist/index.html',
  files: [
    { path: 'neurotide-lite.html', bytes: liteSize, sha256: sha256(LITE), note: '单文件，不含 OCR' },
    {
      path: 'neurotide-full/',
      ocr: hasOcr,
      ocrBytes: hasOcr ? ocrSize : 0,
      note: '完整目录，含 OCR 与启动器',
    },
  ],
}
writeFileSync(join(RELEASE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

if (wantZip) {
  console.log('正在压缩 full 目录与 OCR 包...')
  for (const [target, source] of [
    ['neurotide-full.zip', FULL],
    ['neurotide-ocr-pack.zip', ocrDir],
  ]) {
    try {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Compress-Archive -Path '${source}' -DestinationPath '${join(RELEASE, target)}' -Force`,
        ],
        { stdio: 'inherit' },
      )
    } catch {
      console.warn(`  跳过 ${target}（压缩失败，不影响已生成的目录产物）`)
    }
  }
}

console.log('\n打包完成，产物在 release/：\n')
console.log(`  neurotide-lite.html      ${humanSize(liteSize)}   单文件，双击即用（无 OCR）`)
console.log(
  `  neurotide-full/           ${humanSize(statSync(join(FULL, 'index.html')).size + ocrSize)}   完整目录，含 OCR 与启动器`,
)
if (hasOcr) console.log(`  └ ocr/                    ${humanSize(ocrSize)}   可单独分发`)
if (wantZip) console.log('  neurotide-full.zip / neurotide-ocr-pack.zip')
console.log('\n提示：release/ 已在 .gitignore 中，不会入库；对外分发请走 GitHub Release 附件。')
console.log('校验：sha256 见 release/manifest.json。\n')
