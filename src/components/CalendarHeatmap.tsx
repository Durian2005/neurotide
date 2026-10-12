import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, RefObject } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import Tooltip from './Tooltip'
import { MOOD_HEX, MOOD_HEX_HIGH_CONTRAST, moodGlyph } from '../utils/sentiment'
import { moodColor } from '../utils/moodColor'
import {
  BLOCK_GAP,
  CANVAS_BG,
  GAP,
  LEFT_PAD,
  NO_DATA_HEX,
  TOOLTIP_WIDTH,
  WEEKDAY_LABELS,
  WEEKDAY_SHOWN,
  buildHeatmapLayout,
  canvasHeightFor,
  cellAt,
  describeCell,
  describeLayout,
  monthLabelY,
  moveCursor,
} from '../utils/heatmapGrid'
import type { GridCell, NavDirection } from '../utils/heatmapGrid'
import type { DailyMood } from '../utils/parser'

interface CalendarHeatmapProps {
  days: DailyMood[]
  selectedDate: string | null
  rangeLabel: string
  /** 交由上层用于导出 PNG */
  canvasRef: RefObject<HTMLCanvasElement | null>
  onSelect: (day: DailyMood) => void
  /** 色觉辅助：方向字形 + 强度条 + 高对比配色 */
  colorSafe?: boolean
  /** 高对比：改用高对比配色（同样需要强度条来承载幅度信息） */
  highContrast?: boolean
}

interface HoverState {
  day: DailyMood
  left: number
  top: number
}

const NAV_KEYS: Record<string, NavDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
}

/** 小于这个边长时字形与强度条会糊成一团，只在够大的格子里画 */
const DECOR_MIN_CELL = 10

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export default function CalendarHeatmap({
  days,
  selectedDate,
  rangeLabel,
  canvasRef,
  onSelect,
  colorSafe = false,
  highContrast = false,
}: CalendarHeatmapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  /**
   * 两个开关刻意正交，各管一件事：
   * - 色觉辅助（colorSafe）：给格子加方向字形 + 强度条，情绪方向不再只由色相承担，配色不动。
   * - 高对比（highContrast）：换成高对比配色。该配色把混合下限抬到 0.78，颜色因此不再承载
   *   「幅度」，所以强度条必须同时出现，否则会丢掉信息。
   */
  const showGlyph = colorSafe
  const showBar = colorSafe || highContrast
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<HoverState | null>(null)
  /**
   * 键盘游标与 selectedDate 刻意分开：「移到哪里」和「打开哪一天」是两件事。
   * 同时记下来源的 days 引用，换区间/换数据集后游标自动失效，不必用 effect 清理
   * （在 effect 里 setState 会触发级联渲染，本项目 lint 明确禁止）。
   */
  const [cursorOverride, setCursorOverride] = useState<{ days: DailyMood[]; key: string } | null>(null)
  const fadeControls = useAnimationControls()
  const hoverKeyRef = useRef<string | null>(null)

  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gridId = `heatmap-grid-${reactId}`
  const helpId = `heatmap-help-${reactId}`
  const cellId = useCallback((key: string) => `${gridId}-cell-${key}`, [gridId])

  // 容器尺寸变化时重绘
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => buildHeatmapLayout(days, size.width, size.height), [days, size.width, size.height])

  /**
   * 画布高度 = min(容器高度, 内容高度)。容器多余的高度不再画进画布，
   * 否则格子顶对齐后下方会拖着一整片空白，导出的报告 PNG 也会按这个比例被压扁。
   */
  const canvasHeight = useMemo(() => canvasHeightFor(layout, size.height), [layout, size.height])

  const cellsByKey = useMemo(() => new Map(layout.cells.map((cell) => [cell.key, cell])), [layout])

  /**
   * 语义行 = 「第几个月份块行」× 7 个星期。月份折成多块行后视觉行是 7 * blockRows，
   * 语义层必须跟着走 —— 否则读屏读到的行列会和眼睛看到的位置对不上。
   */
  const rows = useMemo(() => {
    const grouped: GridCell[][] = Array.from({ length: layout.blockRows * 7 }, () => [])
    for (const cell of layout.cells) grouped[cell.blockRow * 7 + cell.row].push(cell)
    return grouped
  }, [layout])

  // 键盘游标：优先用键盘/点击留下的位置，失效或未设置时落到第一个有记录的日
  const cursorKey = useMemo(() => {
    const stillValid = cursorOverride?.days === days && cellsByKey.has(cursorOverride.key)
    if (stillValid && cursorOverride) return cursorOverride.key
    return layout.cells.find((cell) => cell.day)?.key ?? layout.cells[0]?.key ?? null
  }, [cursorOverride, days, cellsByKey, layout])

  const moveCursorTo = useCallback(
    (key: string | null) => {
      if (key) setCursorOverride({ days, key })
    },
    [days],
  )

  // 时间筛选切换后触发一次淡入，形成平滑过渡。
  // 直接由动画控制器驱动，不经过 React state，避免 effect 内同步 setState 引发级联渲染。
  useEffect(() => {
    fadeControls.set({ opacity: 0.3 })
    void fadeControls.start({ opacity: 1, transition: { duration: 0.32, ease: 'easeOut' } })
  }, [rangeLabel, fadeControls])

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || canvasHeight === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(canvasHeight * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${canvasHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(0, 0, size.width, canvasHeight)

    if (layout.cells.length === 0) return

    const { cellSize, blocks, cells } = layout
    const radius = Math.max(2, Math.min(5, cellSize / 4))
    const decorate = cellSize >= DECOR_MIN_CELL

    // 月份标签
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const full = block.full
      // 每个块行的首个块、以及每年 1 月，优先写全年份，避免整屏都是「1月 / 2月」
      const preferFull = block.weekStart === 0 || block.month === 0
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      const fullWidth = ctx.measureText(full).width
      const shortWidth = ctx.measureText(block.short).width
      let label = ''
      if (preferFull && fullWidth <= block.width + BLOCK_GAP - 4) label = full
      else if (shortWidth <= block.width + BLOCK_GAP - 4) label = block.short
      if (label) {
        ctx.fillStyle = highContrast ? 'rgba(203,213,225,0.95)' : 'rgba(148,163,184,0.85)'
        ctx.fillText(label, block.x, monthLabelY(block))
      }
    }

    // 星期标签：每个月份块行都要标一遍，否则下面的块行没有行标签
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = highContrast ? 'rgba(148,163,184,1)' : 'rgba(100,116,139,0.9)'
    for (const rowTop of layout.blockRowTops) {
      for (const row of WEEKDAY_SHOWN) {
        const y = rowTop + row * (cellSize + GAP) + cellSize / 2
        ctx.fillText(WEEKDAY_LABELS[row], LEFT_PAD - 6, y)
      }
    }

    // 日期格子
    for (const cell of cells) {
      if (!cell.day) {
        ctx.fillStyle = NO_DATA_HEX
      } else {
        ctx.fillStyle = moodColor(cell.day.score, highContrast)
      }
      roundRectPath(ctx, cell.x, cell.y, cellSize, cellSize, radius)
      ctx.fill()

      if (decorate && cell.day) {
        const inset = Math.max(1, Math.round(cellSize * 0.16))
        const magnitude = Math.min(1, Math.abs(cell.day.score))
        if (showBar && magnitude > 0) {
          // 强度条：长度 = 超出中性带的绝对幅度，颜色之外的第二通道
          const barH = Math.max(1, Math.round(cellSize * 0.16))
          const barW = Math.max(1, Math.round((cellSize - inset * 2) * magnitude))
          ctx.fillStyle = 'rgba(15,23,42,0.85)'
          roundRectPath(ctx, cell.x + inset, cell.y + cellSize - inset - barH, barW, barH, Math.max(1, barH / 2))
          ctx.fill()
        }
        if (showGlyph) {
          // 方向字形：与色相冗余，方向不再只靠颜色传达
          ctx.font = `${Math.max(7, Math.round(cellSize * 0.46))}px ui-sans-serif, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = 'rgba(15,23,42,0.9)'
          ctx.fillText(moodGlyph(cell.day.score), cell.x + cellSize / 2, cell.y + cellSize / 2 - inset * 0.4)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'bottom'
        }
      }

      if (cell.key === selectedDate) {
        ctx.strokeStyle = highContrast ? 'rgba(248,250,252,1)' : 'rgba(226,232,240,0.95)'
        ctx.lineWidth = 1.5
        roundRectPath(ctx, cell.x + 0.75, cell.y + 0.75, cellSize - 1.5, cellSize - 1.5, radius)
        ctx.stroke()
      }

      if (cell.key === cursorKey) {
        // 键盘游标：虚线框，与实线的「已选中」区分开
        ctx.save()
        ctx.setLineDash([3, 2])
        ctx.strokeStyle = '#22d3ee'
        ctx.lineWidth = 1.5
        roundRectPath(ctx, cell.x + 1, cell.y + 1, cellSize - 2, cellSize - 2, radius)
        ctx.stroke()
        ctx.restore()
      }
    }
  }, [layout, size.width, canvasHeight, selectedDate, cursorKey, highContrast, showBar, showGlyph, canvasRef])

  /** 坐标 → 格子：由行列反算，不再线性扫描全部格子 */
  const hitTest = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): GridCell | null =>
      cellAt(layout, clientX - rect.left, clientY - rect.top),
    [layout],
  )

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const cell = hitTest(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
      if (!cell || !cell.day) {
        hoverKeyRef.current = null
        setHover(null)
        return
      }
      if (hoverKeyRef.current === cell.key) return
      hoverKeyRef.current = cell.key
      const left = Math.max(8, Math.min(cell.x + cell.size + 12, size.width - TOOLTIP_WIDTH - 8))
      const top = Math.max(8, Math.min(cell.y + cell.size + 8, canvasHeight - 150))
      setHover({ day: cell.day, left, top })
    },
    [hitTest, size.width, canvasHeight],
  )

  const handleMouseLeave = useCallback(() => {
    hoverKeyRef.current = null
    setHover(null)
  }, [])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const cell = hitTest(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
      if (!cell?.day) return
      moveCursorTo(cell.key)
      onSelect(cell.day)
    },
    [hitTest, moveCursorTo, onSelect],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const direction = NAV_KEYS[event.key]
      if (direction) {
        event.preventDefault()
        moveCursorTo(moveCursor(layout, cursorKey, direction))
        return
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        const cell = cursorKey ? cellsByKey.get(cursorKey) : undefined
        if (cell?.day) onSelect(cell.day)
      }
      // 不处理 Escape：它由当日详情面板与窄屏抽屉接管，避免一次按键触发两个动作
    },
    [cellsByKey, cursorKey, layout, moveCursorTo, onSelect],
  )

  const hasData = days.length > 0
  const legend = highContrast ? MOOD_HEX_HIGH_CONTRAST : MOOD_HEX

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-slate-200">情绪日历热力图</h2>
          <span className="text-[11px] text-slate-500">{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="hidden text-[11px] text-slate-500 sm:inline">
            X 轴=月 · Y 轴=星期 · Tab 聚焦后方向键移动、回车查看
          </span>
          <div className="flex items-center gap-2">
            {(
              [
                ['消极', legend.negative],
                ['中性', legend.neutral],
                ['积极', legend.positive],
              ] as const
            ).map(([label, hex]) => (
              <span key={label} className="flex items-center gap-1 text-[11px] text-slate-400">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: hex }} />
                {colorSafe && (
                  <span className="text-slate-500">{moodGlyph(label === '积极' ? 1 : label === '消极' ? -1 : 0)}</span>
                )}
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <motion.div ref={wrapRef} animate={fadeControls} className="relative min-h-0 flex-1">
        {/* 画布是纯视觉层，语义由下层的 role=grid 承载。
            高度由内联样式主导（= 内容高度），所以这里不写 h-full，避免首帧被拉伸。 */}
        <canvas ref={canvasRef} aria-hidden="true" className="block w-full" />

        <div
          id={gridId}
          role="grid"
          tabIndex={hasData ? 0 : -1}
          aria-label={describeLayout(layout, rangeLabel)}
          aria-describedby={helpId}
          aria-rowcount={Math.max(1, layout.blockRows * 7)}
          aria-colcount={Math.max(1, layout.maxWeeksPerRow)}
          aria-activedescendant={cursorKey ? cellId(cursorKey) : undefined}
          onKeyDown={handleKeyDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-0"
        >
          {/* 无障碍镜像：与画布同一份布局数据，逐格给出日期、情绪值与记录数。
              role=none 让这一层在无障碍树里透明，grid 的直接子节点才是 row。 */}
          <div className="sr-only" role="none">
            {rows.map((rowCells, index) => (
              <div
                key={`${Math.floor(index / 7)}-${WEEKDAY_LABELS[index % 7]}`}
                role="row"
                aria-label={`星期${WEEKDAY_LABELS[index % 7]}`}
              >
                {rowCells.map((cell) => (
                  <div
                    key={cell.key}
                    id={cellId(cell.key)}
                    role="gridcell"
                    aria-selected={cell.key === selectedDate}
                    aria-colindex={cell.week + 1}
                  >
                    {describeCell(cell)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <p id={helpId} className="sr-only">
          情绪日历：用左右方向键按天移动，上下方向键按周移动，Home / End 跳到首尾，PageUp / PageDown
          翻月，回车打开当日详情。
        </p>

        {hover && <Tooltip day={hover.day} left={hover.left} top={hover.top} />}

        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <p className="text-sm text-slate-500">尚未载入数据</p>
            <p className="text-xs text-slate-600">在左侧上传聊天记录 TXT，或载入示例数据</p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
