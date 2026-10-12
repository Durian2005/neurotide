import { defineConfig } from 'vitest/config'

// 测试只覆盖 src/utils 下的纯函数模块（解析 / 情绪 / 编码 / 时间坐标 / 存储逻辑 / 导出）。
// 这些模块不依赖 DOM，因此用 node 环境即可，无需 jsdom，跑得更快。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts'],
      // browserStorage / browserExport 直接调用 IndexedDB、localStorage、Canvas 与 DOM，
      // node 环境无法执行；它们对应的行为改由真实浏览器端到端验证覆盖（见 README「质量保障」）。
      exclude: [
        'src/utils/ocr.ts',
        'src/utils/sampleData.ts',
        'src/utils/browserStorage.ts',
        'src/utils/browserExport.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
})
