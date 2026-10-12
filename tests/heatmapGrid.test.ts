import { describe, expect, it } from 'vitest'
import {
  BLOCK_ROW_GAP,
  BOTTOM_PAD,
  EMPTY_LAYOUT,
  GAP,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
  MONTH_LABEL_GAP,
  TOP_PAD,
  WEEKDAY_LABELS,
  buildHeatmapLayout,
  canvasHeightFor,
  cellAt,
  describeCell,
  describeLayout,
  monthLabelY,
  moveCursor,
  shiftMonthKey,
} from '../src/utils/heatmapGrid'
import type { HeatmapLayout } from '../src/utils/heatmapGrid'
import type { DailyMood } from '../src/utils/parser'

// ⑥ 可访问性与响应式：日历网格的几何与键盘导航回归测试。
// 这些是「键盘能不能走到每一天」的依据，抽成纯函数就是为了能在这里钉住。

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function keyOf(year: number, month: number, date: number): string {
  return `${year}-${pad2(month)}-${pad2(date)}`
}

function day(date: string, score = 0.2, messageCount = 1): DailyMood {
  const [y, m, d] = date.split('-').map(Number)
  return {
    date,
    day: new Date(y, m - 1, d),
    raw: 0,
    score,
    messageCount,
    positiveHits: 0,
    negativeHits: 0,
    topWords: [],
    messages: [],
  }
}

/** 生成 [from, to] 闭区间内每天一条的记录，用于构造跨月布局 */
function range(from: string, to: string, score = 0.2): DailyMood[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = new Date(fy, fm - 1, fd)
  const end = new Date(ty, tm - 1, td)
  const total = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  return Array.from({ length: total }, (_, offset) => {
    const cursor = new Date(fy, fm - 1, fd + offset)
    return day(keyOf(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()), score)
  })
}

const SIZE = { width: 900, height: 300 }
const LAYOUT: HeatmapLayout = buildHeatmapLayout(range('2026-01-01', '2026-03-31'), SIZE.width, SIZE.height)

describe('buildHeatmapLayout', () => {
  it('空输入或尺寸为零时返回空布局', () => {
    expect(buildHeatmapLayout([], 900, 300)).toBe(EMPTY_LAYOUT)
    expect(buildHeatmapLayout(range('2026-01-01', '2026-01-31'), 0, 300)).toBe(EMPTY_LAYOUT)
    expect(buildHeatmapLayout(range('2026-01-01', '2026-01-31'), 900, 0)).toBe(EMPTY_LAYOUT)
  })

  it('覆盖首月 1 号到末月最后一天的全部日期，且空白日也在格子里（保持日期连续）', () => {
    const layout = buildHeatmapLayout(range('2026-01-15', '2026-02-03'), SIZE.width, SIZE.height)
    expect(layout.cells[0].key).toBe('2026-01-01')
    expect(layout.cells[layout.cells.length - 1].key).toBe('2026-02-28')
    expect(layout.cells).toHaveLength(31 + 28)
  })

  it('格子按日期严格连续排列（±1 格 = ±1 天，键盘上下键才能等距）', () => {
    for (let i = 1; i < LAYOUT.cells.length; i++) {
      const previous = new Date(LAYOUT.cells[i - 1].key)
      const current = new Date(LAYOUT.cells[i].key)
      expect(current.getTime() - previous.getTime()).toBe(24 * 60 * 60 * 1000)
    }
  })

  it('row 是真实星期（0 = 周一），与 Date 的星期一致', () => {
    for (const cell of LAYOUT.cells) {
      const [y, m, d] = cell.key.split('-').map(Number)
      expect(cell.row).toBe((new Date(y, m - 1, d).getDay() + 6) % 7)
    }
  })

  it('week 是所在块行内的列号，逐块递增且不重叠', () => {
    expect(LAYOUT.blocks).toHaveLength(3)
    expect(LAYOUT.blockRows).toBe(1)
    expect(LAYOUT.blocks[0].weekStart).toBe(0)
    for (let i = 1; i < LAYOUT.blocks.length; i++) {
      expect(LAYOUT.blocks[i].weekStart).toBe(LAYOUT.blocks[i - 1].weekStart + LAYOUT.blocks[i - 1].weeks)
    }
    expect(LAYOUT.totalWeeks).toBe(
      LAYOUT.blocks[LAYOUT.blocks.length - 1].weekStart + LAYOUT.blocks[LAYOUT.blocks.length - 1].weeks,
    )
    for (const cell of LAYOUT.cells) {
      const block = LAYOUT.blocks.find((item) => item.month === cell.month)
      expect(cell.week).toBeGreaterThanOrEqual(block!.weekStart)
      expect(cell.week).toBeLessThan(block!.weekStart + block!.weeks)
    }
  })

  it('空白日的 day 为 null，有记录的日子带上原始数据', () => {
    const sparse = buildHeatmapLayout([day('2026-01-10', 0.5, 3)], SIZE.width, SIZE.height)
    const filled = sparse.cells.find((cell) => cell.key === '2026-01-10')
    const empty = sparse.cells.find((cell) => cell.key === '2026-01-11')
    expect(filled?.day?.messageCount).toBe(3)
    expect(empty?.day).toBeNull()
  })

  it('格子边长被钳在可读区间内', () => {
    expect(buildHeatmapLayout(range('2026-01-01', '2026-01-31'), 60, 60).cellSize).toBe(MIN_CELL_SIZE)
    expect(buildHeatmapLayout(range('2026-01-01', '2026-01-31'), 5000, 5000).cellSize).toBe(MAX_CELL_SIZE)
  })
})

describe('月份折成多块行', () => {
  // 10 个月排成一行就是 52 周 × 7 行的一条窄带（约 7.4:1），格子被宽度掐到 12px。
  // 折成 5+5 两行后周长减半，格子能到 15px，画布高度也从 110 涨到 288。
  const TEN_MONTHS = range('2025-12-01', '2026-09-30')
  const WRAPPED = buildHeatmapLayout(TEN_MONTHS, SIZE.width, SIZE.height)

  it('窄画布上折行，格子比单行更大', () => {
    expect(WRAPPED.blockRows).toBe(2)
    // 单行时同一画布只能到 12px；把 15 钉住，动 MAX_CELL_SIZE / BLOCK_ROW_GAP 会立刻报出来
    expect(WRAPPED.cellSize).toBe(15)
    expect(WRAPPED.cellSize).toBeGreaterThan(12)
  })

  it('月份被尽量均匀地分成两段，而不是 8 + 2', () => {
    const perRow = [0, 1].map((row) => WRAPPED.blocks.filter((block) => block.blockRow === row).length)
    expect(perRow).toEqual([5, 5])
    // 月份仍然按时间顺序排，只是换了行
    expect(WRAPPED.blocks.map((block) => block.month)).toEqual([11, 0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('列号在每个块行内重新从 0 开始（ARIA 的列坐标要跟视觉一致）', () => {
    const first = WRAPPED.blocks.filter((block) => block.blockRow === 0)
    const second = WRAPPED.blocks.filter((block) => block.blockRow === 1)
    expect(first[0].weekStart).toBe(0)
    expect(second[0].weekStart).toBe(0)
    // 第一行 12月(5)+1月(5)+2月(5)+3月(6)+4月(5) = 26 列
    expect(second[0].weekStart).toBe(0)
    expect(first.reduce((sum, block) => sum + block.weeks, 0)).toBe(26)
    expect(WRAPPED.maxWeeksPerRow).toBe(26)
    expect(WRAPPED.totalWeeks).toBe(52)
    for (const cell of WRAPPED.cells) {
      expect(cell.week).toBeLessThan(WRAPPED.maxWeeksPerRow)
    }
  })

  it('块行自上而下排布，行间距 = 格子区高 + BLOCK_ROW_GAP', () => {
    const gridHeight = 7 * WRAPPED.cellSize + GAP * 6
    expect(WRAPPED.blockRowTops).toHaveLength(2)
    expect(WRAPPED.blockRowTops[0]).toBe(TOP_PAD)
    expect(WRAPPED.blockRowTops[1] - WRAPPED.blockRowTops[0]).toBe(gridHeight + BLOCK_ROW_GAP)
    expect(WRAPPED.contentHeight).toBe(TOP_PAD + 2 * gridHeight + BLOCK_ROW_GAP + BOTTOM_PAD)
    // 第二块行的月份标签落在上一行的行间空隙里，不能压到格子
    const secondRowLabels = WRAPPED.blocks.filter((b) => b.blockRow === 1).map((b) => monthLabelY(b))
    expect(secondRowLabels[0]).toBe(WRAPPED.blockRowTops[1] - MONTH_LABEL_GAP)
    expect(secondRowLabels[0]).toBeGreaterThan(WRAPPED.blockRowTops[0] + gridHeight - MONTH_LABEL_GAP - 1)
  })

  it('折行后格子依旧按日期严格连续（键盘 ±1 格仍然是 ±1 天）', () => {
    for (let i = 1; i < WRAPPED.cells.length; i++) {
      const previous = new Date(WRAPPED.cells[i - 1].key)
      const current = new Date(WRAPPED.cells[i].key)
      expect(current.getTime() - previous.getTime()).toBe(24 * 60 * 60 * 1000)
    }
    expect(WRAPPED.cells).toHaveLength(31 + 31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30)
  })

  it('cellAt 能命中第二块行的格子，落在块行间隙里返回 null', () => {
    const second = WRAPPED.cells.find((cell) => cell.blockRow === 1 && cell.day)
    expect(second).toBeDefined()
    const hit = cellAt(WRAPPED, second!.x + second!.size / 2, second!.y + second!.size / 2)
    expect(hit?.key).toBe(second!.key)
    const gridHeight = 7 * WRAPPED.cellSize + GAP * 6
    const gapY = WRAPPED.blockRowTops[0] + gridHeight + 4
    expect(cellAt(WRAPPED, second!.x + 2, gapY)).toBeNull()
  })
})

describe('monthLabelY（月份标签纵坐标）', () => {
  // 回归：标签曾经写死在 TOP_PAD 上，而当时格子区是垂直居中的，
  // 于是窗口一高标签就留在顶部、格子沉到中间，中间空出一大条。
  const days = range('2026-01-01', '2026-03-31')

  it('始终贴在所在块行上沿之上', () => {
    const layout = buildHeatmapLayout(days, SIZE.width, SIZE.height)
    const block = layout.blocks[0]
    expect(monthLabelY(block)).toBeLessThan(block.y)
    expect(block.y - monthLabelY(block)).toBe(MONTH_LABEL_GAP)
  })

  it('顶对齐：画布变高不再把格子与标签拉开', () => {
    for (const height of [200, 300, 900]) {
      const layout = buildHeatmapLayout(days, SIZE.width, height)
      expect(layout.offsetY).toBe(TOP_PAD)
      expect(layout.blockRowTops[0]).toBe(TOP_PAD)
      expect(monthLabelY(layout.blocks[0])).toBe(TOP_PAD - MONTH_LABEL_GAP)
    }
  })

  it('不会把自己算到画布顶部之外', () => {
    for (const height of [1, 40, 120, 300, 900]) {
      for (const block of buildHeatmapLayout(days, SIZE.width, height).blocks) {
        expect(monthLabelY(block)).toBeGreaterThanOrEqual(TOP_PAD - MONTH_LABEL_GAP)
      }
    }
  })
})

describe('contentHeight 与 canvasHeightFor（把多余高度收掉）', () => {
  const days = range('2026-01-01', '2026-03-31')

  it('内容高度 = 顶部留白 + 各块行 + 底部收尾', () => {
    const layout = buildHeatmapLayout(days, SIZE.width, 900)
    const gridHeight = 7 * layout.cellSize + GAP * 6
    expect(layout.contentHeight).toBe(
      TOP_PAD + layout.blockRows * gridHeight + (layout.blockRows - 1) * BLOCK_ROW_GAP + BOTTOM_PAD,
    )
  })

  it('容器比内容高时裁到内容高度', () => {
    const layout = buildHeatmapLayout(days, SIZE.width, 900)
    expect(layout.contentHeight).toBeLessThan(900)
    expect(canvasHeightFor(layout, 900)).toBe(layout.contentHeight)
  })

  it('内容高度总是容得下全部块行，且装得进容器', () => {
    const ranges = [days, range('2025-12-01', '2026-09-30')]
    for (const source of ranges) {
      for (const height of [96, 200, 300, 900]) {
        const layout = buildHeatmapLayout(source, SIZE.width, height)
        const gridHeight = 7 * layout.cellSize + GAP * 6
        expect(layout.contentHeight).toBeGreaterThanOrEqual(
          TOP_PAD + 7 * layout.cellSize + GAP * 6 + (layout.blockRows - 1) * BLOCK_ROW_GAP,
        )
        expect(layout.contentHeight).toBeLessThanOrEqual(height)
        expect(gridHeight).toBeGreaterThan(0)
      }
    }
  })

  it('容器极矮时以容器为准兜底，不把画布撑到容器之外', () => {
    // 40px 高时 heightBased 已经是 0，靠 MIN_CELL_SIZE 兜底 → 内容反而比容器高
    const tiny = buildHeatmapLayout(days, SIZE.width, 40)
    expect(tiny.cellSize).toBe(MIN_CELL_SIZE)
    expect(tiny.contentHeight).toBeGreaterThan(40)
    expect(canvasHeightFor(tiny, 40)).toBe(40)
  })

  it('空布局不做裁剪（空状态要能铺满容器）', () => {
    expect(canvasHeightFor(EMPTY_LAYOUT, 640)).toBe(640)
  })
})

describe('cellAt（坐标 → 格子）', () => {
  it('命中格子中心时返回同一个 key', () => {
    for (const cell of LAYOUT.cells) {
      const hit = cellAt(LAYOUT, cell.x + cell.size / 2, cell.y + cell.size / 2)
      expect(hit?.key).toBe(cell.key)
    }
  })

  it('落在网格之外或块间空隙时返回 null', () => {
    expect(cellAt(LAYOUT, -50, 0)).toBeNull()
    expect(cellAt(LAYOUT, 5, 5)).toBeNull()
    expect(cellAt(LAYOUT, 5000, 5000)).toBeNull()
    // 块间距（BLOCK_GAP = 18）内部不应对应任何格子
    const first = LAYOUT.blocks[0]
    expect(cellAt(LAYOUT, first.x + first.width + 9, LAYOUT.offsetY + 5)).toBeNull()
  })

  it('空布局不抛错', () => {
    expect(cellAt(EMPTY_LAYOUT, 10, 10)).toBeNull()
  })
})

describe('shiftMonthKey', () => {
  it('按目标月实际天数收口，不回溢到下个月', () => {
    expect(shiftMonthKey('2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftMonthKey('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonthKey('2026-07-31', 1)).toBe('2026-08-31')
    expect(shiftMonthKey('2026-03-15', -1)).toBe('2026-02-15')
  })

  it('跨年正确', () => {
    expect(shiftMonthKey('2026-01-15', -1)).toBe('2025-12-15')
    expect(shiftMonthKey('2025-12-15', 1)).toBe('2026-01-15')
  })
})

describe('moveCursor（键盘导航）', () => {
  const first = LAYOUT.cells[0].key
  const last = LAYOUT.cells[LAYOUT.cells.length - 1].key

  it('空布局返回 null', () => {
    expect(moveCursor(EMPTY_LAYOUT, null, 'right')).toBeNull()
  })

  it('未设置游标时落到第一天', () => {
    expect(moveCursor(LAYOUT, null, 'right')).toBe(first)
  })

  it('左右按天、上下按周', () => {
    expect(moveCursor(LAYOUT, '2026-02-10', 'left')).toBe('2026-02-09')
    expect(moveCursor(LAYOUT, '2026-02-10', 'right')).toBe('2026-02-11')
    expect(moveCursor(LAYOUT, '2026-02-10', 'up')).toBe('2026-02-03')
    expect(moveCursor(LAYOUT, '2026-02-10', 'down')).toBe('2026-02-17')
  })

  it('跨越月份块仍然按天/按周移动', () => {
    expect(moveCursor(LAYOUT, '2026-02-28', 'right')).toBe('2026-03-01')
    expect(moveCursor(LAYOUT, '2026-03-01', 'left')).toBe('2026-02-28')
  })

  it('边界处不回绕，停在原地', () => {
    expect(moveCursor(LAYOUT, first, 'left')).toBe(first)
    expect(moveCursor(LAYOUT, first, 'up')).toBe(first)
    expect(moveCursor(LAYOUT, last, 'right')).toBe(last)
    expect(moveCursor(LAYOUT, last, 'down')).toBe(last)
  })

  it('Home / End 跳到首尾', () => {
    expect(moveCursor(LAYOUT, '2026-02-10', 'home')).toBe(first)
    expect(moveCursor(LAYOUT, '2026-02-10', 'end')).toBe(last)
  })

  it('PageUp / PageDown 翻月，并按目标月天数收口', () => {
    expect(moveCursor(LAYOUT, '2026-03-31', 'pageup')).toBe('2026-02-28')
    expect(moveCursor(LAYOUT, '2026-02-15', 'pagedown')).toBe('2026-03-15')
  })

  it('翻月越界时钳到首尾，不会跳到不存在的日期', () => {
    expect(moveCursor(LAYOUT, '2026-01-10', 'pageup')).toBe(first)
    expect(moveCursor(LAYOUT, '2026-03-10', 'pagedown')).toBe(last)
  })
})

describe('无障碍播报文案', () => {
  it('有记录的格子包含日期、星期、情绪值与记录数', () => {
    const cell = LAYOUT.cells.find((item) => item.key === '2026-02-10')!
    const text = describeCell({ ...cell, day: day('2026-02-10', -0.42, 7) })
    expect(text).toContain('02-10')
    expect(text).toContain(`周${WEEKDAY_LABELS[cell.row]}`)
    expect(text).toContain('-0.42')
    expect(text).toContain('偏消极')
    expect(text).toContain('7 条记录')
  })

  it('空白格播报「无记录」', () => {
    const cell = LAYOUT.cells.find((item) => item.key === '2026-01-01')!
    expect(describeCell({ ...cell, day: null })).toContain('无记录')
  })

  it('整体摘要给出跨度与有记录天数', () => {
    const layout = buildHeatmapLayout([day('2026-01-10'), day('2026-01-11')], SIZE.width, SIZE.height)
    const summary = describeLayout(layout, '全部')
    expect(summary).toContain('情绪日历热力图')
    expect(summary).toContain('全部')
    expect(summary).toContain('其中 2 天有记录')
  })
})
