// 日历热力图的几何与键盘导航。
//
// 从组件里抽出来的原因：这两块都是纯计算（给定天数与画布尺寸 → 格子坐标；给定当前格子与按键 → 下一个格子），
// 放在组件内部既没法单测，也让「视觉层」和「无障碍层」不得不各算一遍、迟早漂移。
//
// 网格口径：X 轴 = 月（每个月一块，块内按周分列），Y 轴 = 星期（0 = 周一 … 6 = 周日）。
// 因为每个月都从 1 号开始铺，`week` 是跨月累加的全局列号，`row` 就是真实星期。
// 关键性质：cells 的 key 是**日期连续的序列**（首月 1 号 → 末月最后一天，中间的空白日也在），
// 所以「左/右 ±1 格」等于 ±1 天，「上/下 ±7 格」等于 ±7 天，翻月也不会错位。

import { toDateKey } from './parser'
import type { DailyMood } from './parser'
import { formatShortDate, formatScore } from './format'
import { moodLabel } from './sentiment'

/**
 * 月份块行之间的纵向间距。
 * 要同时放得下下一行的月份标签（MONTH_LABEL_GAP = 8）并留出视觉分隔 ——
 * 18px 时标签顶端离上一行的格子只剩 2px，会被误读成上一行的注脚。
 */
export const BLOCK_ROW_GAP = 26
/** 月份块最多折成几行。再多也不会更清晰，只会把格子压小。 */
export const MAX_BLOCK_ROWS = 8

export const GAP = 2
export const BLOCK_GAP = 18
export const LEFT_PAD = 24
export const TOP_PAD = 24
/** 月份标签基线到格子区上沿的距离（`textBaseline = 'bottom'`）。 */
export const MONTH_LABEL_GAP = 8
/** 格子区下方的收尾留白，避免最后一横排贴着画布边缘。 */
export const BOTTOM_PAD = 4
export const MIN_CELL_SIZE = 5
export const MAX_CELL_SIZE = 34

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
/** 只在画布上标注这几行星期，避免 7 行文字挤在一起 */
export const WEEKDAY_SHOWN = [0, 2, 4, 6]

export const NO_DATA_HEX = '#16203a'
export const CANVAS_BG = '#0f172a'
export const TOOLTIP_WIDTH = 224

export interface GridCell {
  /** YYYY-MM-DD */
  key: string
  /** 0 = 周一 … 6 = 周日 */
  row: number
  /** **所在块行内的**列号（0 基），用于 ARIA 的 aria-colindex */
  week: number
  /** 第几个月份块行（0 基）。月份折成多行后，视觉行 = blockRow * 7 + row */
  blockRow: number
  /** 0-11 */
  month: number
  x: number
  y: number
  size: number
  day: DailyMood | null
}

export interface MonthBlock {
  key: string
  short: string
  full: string
  month: number
  x: number
  /** 该块所在块行内第一列对应的列号 */
  weekStart: number
  weeks: number
  blockRow: number
  /** 块内第一行格子的纵坐标（月份标签画在它上方） */
  y: number
  width: number
}

export interface HeatmapLayout {
  blocks: MonthBlock[]
  cells: GridCell[]
  cellSize: number
  offsetY: number
  /** 所有月份块周数之和 */
  totalWeeks: number
  /** 月份折成了几个块行 */
  blockRows: number
  /** 每个块行第一行格子的纵坐标，供星期标签与命中测试使用 */
  blockRowTops: number[]
  /** 单块行内的最大列数，用于 aria-colcount */
  maxWeeksPerRow: number
  /**
   * 画布真正需要的高度（月份标签 + 各块行 + 底部留白）。
   * 容器比它高时应当把画布裁到这么高，否则格子会浮在一片空白中间
   * （同时导出的报告 PNG 也会被这片空白按比例压扁）。
   */
  contentHeight: number
}

export const EMPTY_LAYOUT: HeatmapLayout = {
  blocks: [],
  cells: [],
  cellSize: 0,
  offsetY: 0,
  totalWeeks: 0,
  blockRows: 0,
  blockRowTops: [],
  maxWeeksPerRow: 0,
  contentHeight: 0,
}

/** 周一为 0 的星期序号 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

interface MonthSpan {
  year: number
  month: number
  weeks: number
}

interface BlockRowPlan {
  months: MonthSpan[]
  /** 该行所有月份周数之和，也就是该行的列数 */
  weeks: number
}

/**
 * 把月份按顺序**尽量均匀**地折成 blockRows 行。
 * 例：10 个月 3 行 → 4/3/3，而不是贪心的 4/4/2 或 8/2。
 * 均匀的意义是「最宽的那一行尽量窄」，格子才能更大。
 */
function splitIntoBlockRows(months: MonthSpan[], blockRows: number): BlockRowPlan[] {
  const base = Math.floor(months.length / blockRows)
  const extra = months.length % blockRows
  const rows: BlockRowPlan[] = []
  let cursor = 0
  for (let index = 0; index < blockRows; index++) {
    const count = base + (index < extra ? 1 : 0)
    const slice = months.slice(cursor, cursor + count)
    cursor += count
    rows.push({ months: slice, weeks: slice.reduce((sum, month) => sum + month.weeks, 0) })
  }
  return rows
}

/** 给定块行划分，算出能同时塞进宽高的最大格子边长 */
function cellSizeForRows(rows: BlockRowPlan[], availW: number, availH: number): number {
  // 单行宽度 = (size+GAP)*W - GAP*k + BLOCK_GAP*(k-1)，其中 W = 该行列数、k = 该行月份数
  let widthBased = Number.POSITIVE_INFINITY
  for (const row of rows) {
    if (row.weeks === 0) continue
    const count = row.months.length
    const limit = (availW + GAP * count - BLOCK_GAP * (count - 1)) / row.weeks - GAP
    widthBased = Math.min(widthBased, limit)
  }
  // 总高度 = rows*7*(size+GAP) - rows*GAP + (rows-1)*BLOCK_ROW_GAP
  const rowCount = rows.length
  const heightBased = (availH - GAP * 6 * rowCount - (rowCount - 1) * BLOCK_ROW_GAP) / (7 * rowCount)
  return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Math.floor(Math.min(widthBased, heightBased))))
}

/**
 * 扫描块行数，取能让格子最大的划分；并列时保留行数少的（布局更紧凑）。
 * 早退条件 `cellSize >= MAX_CELL_SIZE`：已经顶格就没必要再折行了。
 */
function chooseBlockRows(
  months: MonthSpan[],
  availW: number,
  availH: number,
): { rows: BlockRowPlan[]; cellSize: number } {
  const maxRows = Math.min(months.length, MAX_BLOCK_ROWS)
  const single = splitIntoBlockRows(months, 1)
  let best = { rows: single, cellSize: cellSizeForRows(single, availW, availH) }
  for (let blockRows = 2; blockRows <= maxRows; blockRows++) {
    if (best.cellSize >= MAX_CELL_SIZE) break
    const rows = splitIntoBlockRows(months, blockRows)
    const cellSize = cellSizeForRows(rows, availW, availH)
    if (cellSize > best.cellSize) best = { rows, cellSize }
  }
  return best
}

export function buildHeatmapLayout(days: DailyMood[], width: number, height: number): HeatmapLayout {
  if (days.length === 0 || width <= 0 || height <= 0) return EMPTY_LAYOUT

  const first = days[0].day
  const last = days[days.length - 1].day

  const months: MonthSpan[] = []
  let cursor = new Date(first.getFullYear(), first.getMonth(), 1)
  while (cursor.getTime() <= last.getTime()) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const offset = mondayIndex(new Date(year, month, 1))
    months.push({ year, month, weeks: Math.ceil((offset + daysInMonth(year, month)) / 7) })
    cursor = new Date(year, month + 1, 1)
  }
  if (months.length === 0) return EMPTY_LAYOUT

  const totalWeeks = months.reduce((sum, month) => sum + month.weeks, 0)
  const availW = width - LEFT_PAD - 4
  const availH = height - TOP_PAD - 4

  // 月份折成几行：单行铺开时 10 个月就是 48 周 × 7 行的一条窄带（约 6.9:1），
  // 格子被宽度掐到十几 px；折成 2–3 行后周长减半，格子能到 MAX_CELL_SIZE。
  const { rows, cellSize } = chooseBlockRows(months, availW, availH)

  const gridHeight = 7 * cellSize + GAP * 6
  // 顶对齐：标签与格子都从画布顶部开始排。早先这里是垂直居中
  // （`TOP_PAD + max(0, (availH - gridHeight) / 2)`），但窗口一高格子就浮在中间、
  // 画布上下各留一大片空白，导出报告时还按比例把格子压扁，所以改成顶对齐 + 裁画布。
  const offsetY = TOP_PAD
  const blockRows = rows.length
  const blockRowTops = rows.map((_, index) => TOP_PAD + index * (gridHeight + BLOCK_ROW_GAP))
  const maxWeeksPerRow = rows.reduce((max, row) => Math.max(max, row.weeks), 0)
  const contentHeight = TOP_PAD + blockRows * gridHeight + (blockRows - 1) * BLOCK_ROW_GAP + BOTTOM_PAD

  const dayMap = new Map(days.map((day) => [day.date, day]))
  const blocks: MonthBlock[] = []
  const cells: GridCell[] = []

  for (let blockRow = 0; blockRow < blockRows; blockRow++) {
    const rowTop = blockRowTops[blockRow]
    let x = LEFT_PAD
    // 列号在每个块行内重新从 0 开始 —— ARIA 的行/列坐标要跟视觉一致
    let weekStart = 0
    for (const month of rows[blockRow].months) {
      const blockWidth = month.weeks * (cellSize + GAP) - GAP
      const monthIndex = month.month + 1
      blocks.push({
        key: `${month.year}-${String(monthIndex).padStart(2, '0')}`,
        short: `${monthIndex}月`,
        full: `${month.year}年${monthIndex}月`,
        month: month.month,
        x,
        weekStart,
        weeks: month.weeks,
        blockRow,
        y: rowTop,
        width: blockWidth,
      })

      const offset = mondayIndex(new Date(month.year, month.month, 1))
      const total = daysInMonth(month.year, month.month)
      for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth++) {
        const index = offset + dayOfMonth - 1
        const date = new Date(month.year, month.month, dayOfMonth)
        const key = toDateKey(date)
        const row = index % 7
        cells.push({
          key,
          row,
          week: weekStart + Math.floor(index / 7),
          blockRow,
          month: month.month,
          x: x + Math.floor(index / 7) * (cellSize + GAP),
          y: rowTop + row * (cellSize + GAP),
          size: cellSize,
          day: dayMap.get(key) ?? null,
        })
      }

      x += blockWidth + BLOCK_GAP
      weekStart += month.weeks
    }
  }

  return {
    blocks,
    cells,
    cellSize,
    offsetY,
    totalWeeks,
    blockRows,
    blockRowTops,
    maxWeeksPerRow,
    contentHeight,
  }
}

/**
 * 月份标签的纵坐标（配合 `textBaseline = 'bottom'`）。
 * 由所在块的 `y` 派生，不能钉死在 `TOP_PAD` 上：曾经写死过一次，
 * 而当时格子区是垂直居中的，窗口一高标签就留在顶部、格子沉到中间，两者脱节。
 * 折成多块行后每个块行都有自己的标签行，所以这里必须按块算。
 */
export function monthLabelY(block: MonthBlock): number {
  return block.y - MONTH_LABEL_GAP
}

/**
 * 画布实际该用的高度：容器比内容高就裁到内容高度，否则跟随容器。
 * 用它同时替换掉 `size.height`，才能让画布、命中测试、悬浮提示的坐标系统一。
 */
export function canvasHeightFor(layout: HeatmapLayout, containerHeight: number): number {
  if (layout.contentHeight <= 0) return containerHeight
  return Math.min(containerHeight, layout.contentHeight)
}

/** 坐标 → 格子。先按 Y 定位块行，再由块行内的行列反算（O(块行数)） */
export function cellAt(layout: HeatmapLayout, offsetX: number, offsetY: number): GridCell | null {
  if (layout.cells.length === 0 || layout.cellSize <= 0) return null
  const step = layout.cellSize + GAP
  const gridHeight = 7 * layout.cellSize + GAP * 6
  const blockRow = layout.blockRowTops.findIndex((top) => offsetY >= top && offsetY < top + gridHeight)
  if (blockRow < 0) return null
  const row = Math.floor((offsetY - layout.blockRowTops[blockRow]) / step)
  if (row < 0 || row > 6) return null
  for (const block of layout.blocks) {
    if (block.blockRow !== blockRow) continue
    if (offsetX < block.x || offsetX >= block.x + block.width + GAP) continue
    const week = Math.floor((offsetX - block.x) / step)
    if (week < 0 || week >= block.weeks) return null
    const target = block.weekStart + week
    // 每个块行里只可能命中一个格子，线性找够快；格子总数上限也只有几千
    return layout.cells.find((cell) => cell.blockRow === blockRow && cell.row === row && cell.week === target) ?? null
  }
  return null
}

export type NavDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'pageup' | 'pagedown'

const DAY_STEP: Partial<Record<NavDirection, number>> = { left: -1, right: 1, up: -7, down: 7 }

/** 二分查找日期 key 的下标；保证 keys 已按日期升序 */
function locate(keys: string[], target: string): number {
  let low = 0
  let high = keys.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (keys[mid] === target) return mid
    if (keys[mid] < target) low = mid + 1
    else high = mid - 1
  }
  return -1
}

/** 按目标月实际天数收口地偏移月份，避免 31 号回溯溢出到下个月 */
export function shiftMonthKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const target = new Date(year, month - 1 + delta, 1)
  const lastDay = daysInMonth(target.getFullYear(), target.getMonth())
  return toDateKey(new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay)))
}

/**
 * 键盘导航：返回移动后的日期 key。
 * 边界处不回绕（保持位置），避免用户按住方向键时从年初瞬移到年末。
 */
export function moveCursor(layout: HeatmapLayout, currentKey: string | null, direction: NavDirection): string | null {
  const keys = layout.cells.map((cell) => cell.key)
  if (keys.length === 0) return null
  if (direction === 'home') return keys[0]
  if (direction === 'end') return keys[keys.length - 1]

  const current = currentKey === null ? -1 : locate(keys, currentKey)
  if (current < 0) return keys[0]

  if (direction === 'pageup' || direction === 'pagedown') {
    const target = shiftMonthKey(keys[current], direction === 'pageup' ? -1 : 1)
    const index = locate(keys, target)
    if (index >= 0) return target
    return target < keys[0] ? keys[0] : keys[keys.length - 1]
  }

  const step = DAY_STEP[direction]
  if (step === undefined) return keys[current]
  const next = current + step
  if (next < 0 || next >= keys.length) return keys[current]
  return keys[next]
}

/** 单元格的无障碍播报文案（同时作为 aria-activedescendant 目标的文本） */
export function describeCell(cell: GridCell): string {
  const [year, month, day] = cell.key.split('-').map(Number)
  const date = formatShortDate(new Date(year, month - 1, day))
  const weekday = `周${WEEKDAY_LABELS[cell.row]}`
  if (!cell.day) return `${date} ${weekday}，无记录`
  return `${date} ${weekday}，情绪 ${formatScore(cell.day.score)}（${moodLabel(cell.day.score)}），${cell.day.messageCount} 条记录`
}

/** 整块热力图的无障碍摘要 */
export function describeLayout(layout: HeatmapLayout, rangeLabel: string): string {
  const recorded = layout.cells.filter((cell) => cell.day).length
  const span = layout.cells.length
  return `情绪日历热力图，${rangeLabel}，共 ${span} 天，其中 ${recorded} 天有记录`
}
