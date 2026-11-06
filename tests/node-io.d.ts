// 配色一致性测试需要读一次 src/index.css 的源码。
// 本项目不依赖 @types/node，这里只为实际用到的两个 API 补最小声明，
// 避免为了一个测试把整套 Node 类型拉进 tsconfig 的 types。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string
}
