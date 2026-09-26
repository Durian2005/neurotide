import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * 产物是单文件、通过 file:// 双击打开的。浏览器对 module 脚本在 file:// 下有额外限制，
 * 而打包产物经核验已不含任何 import / export / import.meta / 动态 import，因此把内联脚本
 * 降级为普通脚本，彻底不走 module 加载流程。
 *
 * 两个必须配套处理的点：
 * 1. module 脚本天然延迟到文档解析完成后执行，普通脚本不会。Vite 把脚本放在 <head>，
 *    降级后它会早于 <div id="root"> 执行，导致 createRoot 拿到 null（React error #299）。
 *    故需把脚本移到 </body> 前。
 * 2. 普通脚本默认是宽松模式，这里补回 "use strict" 以保持 module 原本的严格模式语义。
 */
function inlineScriptForFileProtocol(): Plugin {
  return {
    name: 'neurotide:inline-script-for-file-protocol',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue

          const scripts: string[] = []
          const stripped = String(file.source).replace(
            /<script\b[^>]*>[\s\S]*?<\/script>/g,
            (tag) => {
              scripts.push(tag.replace(/^<script\b[^>]*>/, '<script>"use strict";'))
              return ''
            },
          )

          // 用函数形式替换：字符串形式的替换会把 bundle 里的 $& / $' 当成特殊模式解释
          file.source = stripped.replace(
            '</body>',
            () => `${scripts.join('')}\n</body>`,
          )
        }
      },
    },
  }
}

export default defineConfig({
  // 相对路径：产物放到任何目录都能用 file:// 直接打开
  base: './',
  // viteSingleFile 仅作用于 build，把 JS/CSS 全部内联进单个 index.html
  plugins: [react(), tailwindcss(), viteSingleFile(), inlineScriptForFileProtocol()],
})