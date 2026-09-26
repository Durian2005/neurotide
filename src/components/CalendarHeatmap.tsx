import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import { motion } from 'framer-motion'
import Tooltip from './Tooltip'
import { MOOD_HEX, NEUTRAL_BAND, moodLevel } from '../utils/sentiment'
import { toDateKey } from '../utils/parser'
import type { DailyMood } from '../utils/parser'

interface CalendarHeatmapProps {
  days: DailyMood[]
  selectedDate: string | null
  rangeLabel: string
  /** 交由上层用于导出 PNG */
  canvasRef: RefObject<HTMLCanvasElement | null>
  onSelect: (day: DailyMood) => void
}

interface GridCell {
  key: string
  month: number
  x: number
  y: number
  size: number
  day: DailyMood | null
}

interface MonthBlock {
  key: string
  short: string
  full: string
  month: number
  x: number
  width: number
}

interface HeatmapLayout {
  blocks: MonthBlock[]
  cells: GridCell[]
  cellSize: number
  offsetY: number
}

interface HoverState {
  day: DailyMood
  left: number
  top: number
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_SHOWN = [0, 2, 4, 6]
const GAP = 2
const BLOCK_GAP = 18
const LEFT_PAD = 24
const TOP_PAD = 24
const NO_DATA_HEX = '#16203a'
const CANVAS_BG = '#0f172a'
const TOOLTIP_WIDTH = 224

const EMPTY_LAYOUT: HeatmapLayout = { blocks: [], cells: [], cellSize: 0, offsetY: 0 }

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

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function toRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

const NEUTRAL_RGB: [number, number, number] = [51, 65, 85]
const POSITIVE_RGB: [number, number, number] = [34, 211, 238]
const NEGATIVE_RGB: [number, number, number] = [30, 58, 138]

// 情绪值 -> 格子颜色：深蓝=消极、灰=中性、亮青=积极
function scoreToColor(score: number): string {
  const level = moodLevel(score)
  if (level === 'neutral') return toRgb(NEUTRAL_RGB)
  const t = Math.min(1, (Math.abs(score) - NEUTRAL_BAND) / (1 - NEUTRAL_BAND))
  const target = level === 'positive' ? POSITIVE_RGB : NEGATIVE_RGB
  const k = 0.42 + 0.58 * t
  return toRgb([
    mixChannel(NEUTRAL_RGB[0], target[0], k),
    mixChannel(NEUTRAL_RGB[1], target[1], k),
    mixChannel(NEUTRAL_RGB[2], target[2], k),
  ])
}

// 构建「X 轴=月 / Y 轴=星期」的日历网格
function buildLayout(days: DailyMood[], width: number, height: number): HeatmapLayout {
  if (days.length === 0 || width <= 0 || height <= 0) return EMPTY_LAYOUT

  const first = days[0].day
  const last = days[days.length - 1].day

  const months: Array<{ year: number; month: number; weeks: number }> = []
  let cursor = new Date(first.getFullYear(), first.getMonth(), 1)
  while (cursor.getTime() <= last.getTime()) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const offset = (new Date(year, month, 1).getDay() + 6) % 7 // 0 = 周一
    months.push({ year, month, weeks: Math.ceil((offset + daysInMonth) / 7) })
    cursor = new Date(year, month + 1, 1)
  }
  if (months.length === 0) return EMPTY_LAYOUT

  const totalWeeks = months.reduce((sum, m) => sum + m.weeks, 0)
  const availW = width - LEFT_PAD - 4
  const availH = height - TOP_PAD - 4
  const widthBased =
    (availW - BLOCK_GAP * (months.length - 1) - GAP * (totalWeeks - months.length)) / totalWeeks
  const heightBased = (availH - GAP * 6) / 7
  const cellSize = Math.max(5, Math.min(34, Math.floor(Math.min(widthBased, heightBased))))

  const gridHeight = 7 * cellSize + GAP * 6
  const offsetY = TOP_PAD + Math.max(0, (availH - gridHeight) / 2)

  const dayMap = new Map(days.map((day) => [day.date, day]))
  const blocks: MonthBlock[] = []
  const cells: GridCell[] = []

  let x = LEFT_PAD
  for (const month of months) {
    const blockWidth = month.weeks * (cellSize + GAP) - GAP
    const monthIndex = month.month + 1
    blocks.push({
      key: `${month.year}-${String(monthIndex).padStart(2, '0')}`,
      short: `${monthIndex}月`,
      full: `${month.year}年${monthIndex}月`,
      month: month.month,
      x,
      width: blockWidth,
    })

    const offset = (new Date(month.year, month.month, 1).getDay() + 6) % 7
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate()
    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth++) {
      const index = offset + dayOfMonth - 1
      const date = new Date(month.year, month.month, dayOfMonth)
      const key = toDateKey(date)
      cells.push({
        key,
        month: month.month,
        x: x + Math.floor(index / 7) * (cellSize + GAP),
        y: offsetY + (index % 7) * (cellSize + GAP),
        size: cellSize,
        day: dayMap.get(key) ?? null,
      })
    }

    x += blockWidth + BLOCK_GAP
  }

  return { blocks, cells, cellSize, offsetY }
}

export default function CalendarHeatmap({
  days,
  selectedDate,
  rangeLabel,
  canvasRef,
  onSelect,
}: CalendarHeatmapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<HoverState | null>(null)
  const [fade, setFade] = useState(1)
  const hoverKeyRef = useRef<string | null>(null)

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

  const layout = useMemo(() => buildLayout(days, size.width, size.height), [days, size.width, size.height])

  // 时间筛选切换后触发一次淡入，形成平滑过渡
  useEffect(() => {
    setFade(0.3)
    const timer = window.setTimeout(() => setFade(1), 30)
    return () => window.clearTimeout(timer)
  }, [rangeLabel])

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(0, 0, size.width, size.height)

    if (layout.cells.length === 0) return

    const { cellSize, blocks, cells } = layout
    const radius = Math.max(2, Math.min(5, cellSize / 4))

    // 月份标签
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const full = block.full
      const preferFull = i === 0 || block.month === 0
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      const fullWidth = ctx.measureText(full).width
      const shortWidth = ctx.measureText(block.short).width
      let label = ''
      if (preferFull && fullWidth <= block.width + BLOCK_GAP - 4) label = full
      else if (shortWidth <= block.width + BLOCK_GAP - 4) label = block.short
      if (label) {
        ctx.fillStyle = 'rgba(148,163,184,0.85)'
        ctx.fillText(label, block.x, TOP_PAD - 8)
      }
    }

    // 星期标签
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(100,116,139,0.9)'
    for (const row of WEEKDAY_SHOWN) {
      const y = layout.offsetY + row * (cellSize + GAP) + cellSize / 2
      ctx.fillText(WEEKDAY_LABELS[row], LEFT_PAD - 6, y)
    }

    // 日期格子
    for (const cell of cells) {
      if (!cell.day) {
        ctx.fillStyle = NO_DATA_HEX
      } else {
        ctx.fillStyle = scoreToColor(cell.day.score)
      }
      roundRectPath(ctx, cell.x, cell.y, cellSize, cellSize, radius)
      ctx.fill()

      if (cell.key === selectedDate) {
        ctx.strokeStyle = 'rgba(226,232,240,0.95)'
        ctx.lineWidth = 1.5
        roundRectPath(ctx, cell.x + 0.75, cell.y + 0.75, cellSize - 1.5, cellSize - 1.5, radius)
        ctx.stroke()
      }
    }
  }, [layout, size.width, size.height, selectedDate, canvasRef])

  const findCell = useCallback(
    (offsetX: number, offsetY: number): GridCell | null => {
      for (const cell of layout.cells) {
        if (
          offsetX >= cell.x &&
          offsetX < cell.x + cell.size &&
          offsetY >= cell.y &&
          offsetY < cell.y + cell.size
        ) {
          return cell
        }
      }
      return null
    },
    [layout],
  )

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const cell = findCell(event.clientX - rect.left, event.clientY - rect.top)
      if (!cell || !cell.day) {
        hoverKeyRef.current = null
        setHover(null)
        return
      }
      if (hoverKeyRef.current === cell.key) return
      hoverKeyRef.current = cell.key
      const left = Math.max(8, Math.min(cell.x + cell.size + 12, size.width - TOOLTIP_WIDTH - 8))
      const top = Math.max(8, Math.min(cell.y + cell.size + 8, size.height - 150))
      setHover({ day: cell.day, left, top })
    },
    [findCell, size.width, size.height],
  )

  const handleMouseLeave = useCallback(() => {
    hoverKeyRef.current = null
    setHover(null)
  }, [])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const cell = findCell(event.clientX - rect.left, event.clientY - rect.top)
      if (cell?.day) onSelect(cell.day)
    },
    [findCell, onSelect],
  )

  const hasData = days.length > 0

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-slate-200">情绪日历热力图</h2>
          <span className="text-[11px] text-slate-500">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">X 轴=月 · Y 轴=星期 · 每格=1 天</span>
          <div className="flex items-center gap-2">
            {([
              ['消极', MOOD_HEX.negative],
              ['中性', MOOD_HEX.neutral],
              ['积极', MOOD_HEX.positive],
            ] as const).map(([label, hex]) => (
              <span key={label} className="flex items-center gap-1 text-[11px] text-slate-400">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: hex }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <motion.div
        ref={wrapRef}
        animate={{ opacity: fade }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
        className="relative min-h-0 flex-1"
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />
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