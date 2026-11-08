#!/usr/bin/env node
// 构建产物守卫：dist/index.html 必须是能在 file:// 下双击打开的自包含单文件。
//
// 这条硬约束此前只靠人工核验；只要某个依赖升级重新引入 ESM 语法、动态 import
// 或外链资源，file:// 下就是白屏，而 lint / 单测 / tsc 全都不会报错。
// 同时盯住体积：误把约 9MB 的 OCR 资源内联进 HTML，也会让单文件方案失去意义。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const TARGET = join(ROOT, 'dist', 'index.html')
// 当前产物约 528KB；留约 16% 余量。若确属正常增长，上调时请在提交说明里写清原因。
const MAX_BYTES = 600 * 1024

if (!existsSync(TARGET)) {
  console.error('产物守卫失败：未找到 dist/index.html，请先运行 npm run build。')
  process.exit(1)
}

const bytes = statSync(TARGET).size
const html = readFileSync(TARGET, 'utf8')
const problems = []

if (bytes === 0) problems.push('dist/index.html 是空文件')
if (bytes > MAX_BYTES) {
  problems.push(`体积 ${bytes} B 超过上限 ${MAX_BYTES} B；检查是否误把 OCR 资源内联进 HTML`)
}
if (!/<style\b/i.test(html)) problems.push('缺少内联 <style>，CSS 可能没有打进 HTML')
if (!/<script\b/i.test(html)) problems.push('缺少内联 <script>，应用代码可能没有打进 HTML')

/** 任一命中都意味着浏览器会发起独立请求或走 ESM 加载流程，file:// 下必然失败 */
const forbidden = [
  { pattern: /<script\b[^>]*\bsrc\s*=/i, why: '存在外部 <script src>，资源没有内联' },
  { pattern: /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i, why: '存在外部 stylesheet，CSS 没有内联' },
  { pattern: /@import\b[^;]*url\s*\(/i, why: '内联 CSS 里有 @import url()，会发起独立请求' },
  { pattern: /<script\b[^>]*\btype\s*=\s*["']?module/i, why: '仍带 type="module"，file:// 下会被 CORS 拦下' },
  { pattern: /\bimport\s*\.\s*meta\b/, why: '产物含 import.meta，普通脚本下会直接抛错' },
  { pattern: /\bimport\s*\(/, why: '产物含动态 import()，会尝试请求独立 chunk' },
]
for (const { pattern, why } of forbidden) {
  if (pattern.test(html)) problems.push(why)
}

if (/<link\b[^>]*\brel\s*=\s*["']?preload/i.test(html)) {
  console.warn('警告：产物包含 preload 预加载，单文件场景下可能无效。')
}

if (problems.length > 0) {
  console.error('产物守卫失败：')
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}

console.log(`产物守卫通过：dist/index.html ${bytes} B（上限 ${MAX_BYTES} B），无外链、无 ESM、无动态 import。`)
