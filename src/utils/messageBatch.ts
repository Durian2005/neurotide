/**
 * 当日消息列表的分批渲染（规模化：一天上万条消息时不能一次插进 DOM）。
 *
 * 背景：`DayDetail` 原来把 `day.messages` 全量 `map` 成 DOM。实测一天 5 万条时
 * 会产生约 40 万个节点、单次主线程阻塞 2.4 秒。这里把「显示多少条」抽成纯函数，
 * 组件只负责把结果渲染出来，规则本身可以单测。
 */

/** 首批渲染条数：够填满一屏并留出滚动余量，又不至于一次插入太多节点 */
export const INITIAL_BATCH = 120

/** 每次追加的条数 */
export const BATCH_STEP = 120

/** 把数字按千分位分组。自己实现而不是用 toLocaleString：后者依赖运行环境 locale，中文 Windows 与 CI 结果会不一致。 */
export function groupDigits(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 首次渲染多少条 */
export function initialVisibleCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(Math.trunc(total), INITIAL_BATCH)
}

/** 再展开一批后的条数；已到末尾就停在末尾 */
export function nextVisibleCount(current: number, total: number, step = BATCH_STEP): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const limit = Math.trunc(total)
  const safeCurrent = Number.isFinite(current) ? Math.min(Math.max(0, Math.trunc(current)), limit) : 0
  if (safeCurrent >= limit) return limit
  const increment = Number.isFinite(step) && step >= 1 ? Math.trunc(step) : 1
  return Math.min(limit, safeCurrent + increment)
}

/** 是否还有没显示的消息 */
export function hasMoreMessages(visible: number, total: number): boolean {
  if (!Number.isFinite(total) || total <= 0) return false
  return Math.min(Math.max(0, Math.trunc(visible)), Math.trunc(total)) < Math.trunc(total)
}

/** 列表底部的计数文案 */
export function batchProgressLabel(visible: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '暂无记录'
  const limit = Math.trunc(total)
  const shown = Math.min(Math.max(0, Math.trunc(visible)), limit)
  if (shown >= limit) return `共 ${groupDigits(limit)} 条`
  return `已显示 ${groupDigits(shown)} / ${groupDigits(limit)} 条`
}
