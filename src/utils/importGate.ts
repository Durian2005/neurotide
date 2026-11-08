// 导入请求门：维护「只有最新一次导入可以回写界面与存储」的并发契约。
//
// 分片解析会让出主线程，期间用户完全可能再拖一份文件；不设令牌的话，先发的
// 大文件后完成时就会用旧结果覆盖新数据（含原始文本与活动数据集指针）。
// 这里把「取号 / 作废旧请求 / 判定是否仍是最新」抽成不依赖 React 的纯逻辑，
// 既能被 node 环境的单测覆盖，也让 App 只需接线、不必自己维护两个 ref。

export interface ImportRequest {
  /** 自增令牌，用于跨 await 复核「我还是不是最新请求」 */
  readonly id: number
  /** 旧请求被取代或调用方卸载时会收到 abort */
  readonly signal: AbortSignal
  /** 该请求此刻是否仍是最新 */
  isCurrent(): boolean
}

export interface ImportGate {
  /** 开始一次新导入：abort 上一次并领新令牌 */
  begin(): ImportRequest
  /** 当前最新令牌；供解析完成后的多步异步写入复核 */
  currentId(): number
  /** 外部取消（组件卸载、StrictMode 双挂载） */
  abort(): void
}

export function createImportGate(): ImportGate {
  let seq = 0
  let active: AbortController | null = null

  return {
    begin() {
      active?.abort()
      const controller = new AbortController()
      active = controller
      const id = ++seq
      return {
        id,
        signal: controller.signal,
        isCurrent: () => seq === id,
      }
    },
    currentId: () => seq,
    abort: () => active?.abort(),
  }
}
