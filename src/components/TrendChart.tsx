import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { NEUTRAL_BAND } from '../utils/sentiment'
import { moodColor } from '../utils/moodColor'
import { buildDenseSeries, linearTrend, rollingMean, trendAt, DEFAULT_ROLLING_WINDOW } from '../utils/analysis'
import { formatScore } from '../utils/format'
import type { DailyMood } from '../utils/parser'

interface TrendChartProps {
  days: DailyMood[]
  /** 点击某天时回调（该天有记录才会触发） */
  onSelect?: (day: DailyMood) => void
  /** 高对比：散点与刻度改用高对比配色 */
  highContrast?: boolean
}

const HEIGHT = 240
const PAD = { left: 46, right: 18, top: 16, bottom: 30 }
const TREND_COLOR = '#fbbf24'
const ROLLING_COLOR = '#22d3ee'
const AXIS_COLOR = 'rgba(148,163,184,0.28)'
const GRID_LINES: Array<{ value: number; label: string }> = [
  { value: 1, label: '+1.0' },
  { value: 0.5, label: '+0.5' },
  { value: 0, label: '0' },
  { value: -0.5, label: '-0.5' },
  { value: -1, label: '-1.0' },
]

export default function TrendChart({ days, onSelect, highContrast = false }: TrendChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const series = useMemo(() => buildDenseSeries(days), [days])
  const rolling = useMemo(() => rollingMean(series, DEFAULT_ROLLING_WINDOW), [series])
  const trend = useMemo(() => linearTrend(series), [series])
  const dayByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days])

  const count = series.length
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom

  const xAt = useCallback(
    (index: number) => (count <= 1 ? PAD.left + plotW / 2 : PAD.left + (index / (count - 1)) * plotW),
    [count, plotW],
  )
  const yAt = useCallback((value: number) => PAD.top + ((1 - Math.max(-1, Math.min(1, value))) / 2) * plotH, [plotH])

  /**
   * 7 日均线（缺口处分段）。
   * 刻意不为「每日情绪值」画连线：日与日之间本来就抖动，
   * 把 257 天逐点连起来会形成一把盖住均线的锯齿梳子，反而看不出趋势。
   */
  const rollingSegments = useMemo(() => {
    const segments: Array<Array<{ x: number; y: number }>> = []
    let current: Array<{ x: number; y: number }> = []
    rolling.forEach((value, index) => {
      if (typeof value === 'number') current.push({ x: xAt(index), y: yAt(value) })
      else if (current.length > 0) {
        segments.push(current)
        current = []
      }
    })
    if (current.length > 0) segments.push(current)
    return segments
  }, [rolling, xAt, yAt])

  /** X 轴月份刻度：按月切换处打点，太密时抽稀 */
  const ticks = useMemo(() => {
    const raw: Array<{ index: number; label: string }> = []
    series.forEach((point, index) => {
      const month = point.day.getMonth()
      const previous = index > 0 ? series[index - 1].day.getMonth() : -1
      if (index === 0 || month !== previous) {
        raw.push({
          index,
          label:
            month === 0 || index === 0 ? `${String(point.day.getFullYear()).slice(2)}/${month + 1}` : `${month + 1}月`,
        })
      }
    })
    const step = Math.max(1, Math.ceil(raw.length / 10))
    return raw.filter((_, index) => index % step === 0 || index === raw.length - 1)
  }, [series])

  const handleMove = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      if (count === 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const localX = event.clientX - rect.left - PAD.left
      const ratio = plotW <= 0 ? 0 : localX / plotW
      const index = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
      setHover(series[index] && typeof series[index].score === 'number' ? index : null)
    },
    [count, plotW, series],
  )

  const handleClick = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      if (count === 0 || !onSelect) return
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = plotW <= 0 ? 0 : (event.clientX - rect.left - PAD.left) / plotW
      // 点击处若落在缺口上，就近找两侧最近的记录日
      const start = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
      for (let offset = 0; offset < count; offset++) {
        for (const index of [start - offset, start + offset]) {
          if (index < 0 || index >= count) continue
          if (typeof series[index].score !== 'number') continue
          const day = dayByDate.get(series[index].date)
          if (day) onSelect(day)
          return
        }
      }
    },
    [count, dayByDate, onSelect, plotW, series],
  )

  const hasPoints = trend.points > 0

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 && hasPoints && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`情绪趋势折线图，共 ${count} 天，其中 ${trend.points} 天有记录，${DEFAULT_ROLLING_WINDOW} 日均线与线性趋势线`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          onClick={handleClick}
          className={onSelect ? 'cursor-crosshair' : undefined}
        >
          {/* 中性带 */}
          <rect
            x={PAD.left}
            y={yAt(NEUTRAL_BAND)}
            width={plotW}
            height={Math.max(1, yAt(-NEUTRAL_BAND) - yAt(NEUTRAL_BAND))}
            fill="rgba(148,163,184,0.07)"
          />

          {/* 积极 / 消极区底色：颜色之外的第二通道，色觉受限时也能看出点落在零线哪一侧 */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={Math.max(1, yAt(NEUTRAL_BAND) - PAD.top)}
            fill="rgba(34,211,238,0.07)"
          />
          <rect
            x={PAD.left}
            y={yAt(-NEUTRAL_BAND)}
            width={plotW}
            height={Math.max(1, PAD.top + plotH - yAt(-NEUTRAL_BAND))}
            fill="rgba(59,130,246,0.1)"
          />
          <text x={PAD.left + 4} y={PAD.top + 10} fontSize={9} fill="rgba(34,211,238,0.6)">
            积极区
          </text>
          <text x={PAD.left + 4} y={PAD.top + plotH - 4} fontSize={9} fill="rgba(96,165,250,0.7)">
            消极区
          </text>

          {/* 水平参考线 */}
          {GRID_LINES.map(({ value, label }) => (
            <g key={label}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAt(value)}
                y2={yAt(value)}
                stroke={value === 0 ? 'rgba(148,163,184,0.45)' : AXIS_COLOR}
                strokeDasharray={value === 0 ? '4 4' : undefined}
              />
              <text
                x={PAD.left - 8}
                y={yAt(value)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill={highContrast ? '#cbd5e1' : '#64748b'}
              >
                {label}
              </text>
            </g>
          ))}

          {/* 有记录的日值散点 */}
          {series.map((point, index) =>
            typeof point.score === 'number' ? (
              <circle
                key={`dot-${point.date}`}
                cx={xAt(index)}
                cy={yAt(point.score)}
                r={count > 120 ? 1.6 : 2.6}
                fill={moodColor(point.score, highContrast)}
                opacity={0.85}
              />
            ) : null,
          )}

          {/* 7 日均线 */}
          {rollingSegments.map((segment, index) => (
            <polyline
              key={`roll-${index}`}
              points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={ROLLING_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* 线性趋势线 */}
          {trend.points >= 2 && (
            <line
              x1={xAt(0)}
              x2={xAt(count - 1)}
              y1={yAt(trendAt(trend, 0))}
              y2={yAt(trendAt(trend, count - 1))}
              stroke={TREND_COLOR}
              strokeWidth={1.6}
              strokeDasharray="7 5"
              opacity={0.9}
            />
          )}

          {/* X 轴月份刻度 */}
          {ticks.map((tick) => (
            <text
              key={`tick-${tick.index}`}
              x={xAt(tick.index)}
              y={HEIGHT - PAD.bottom + 14}
              textAnchor={tick.index === 0 ? 'start' : 'middle'}
              fontSize={10}
              fill="#64748b"
            >
              {tick.label}
            </text>
          ))}

          {/* 悬停指示 */}
          {hover !== null && series[hover] && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="rgba(226,232,240,0.5)"
              strokeWidth={1}
            />
          )}
        </svg>
      )}

      {width > 0 && !hasPoints && (
        <p className="flex h-[240px] items-center justify-center text-xs text-slate-500">当前区间没有可绘制的记录</p>
      )}

      {hover !== null && series[hover] && typeof series[hover].score === 'number' && (
        <div
          className="pointer-events-none absolute z-10 w-40 rounded-lg border border-white/10 bg-slate-900/95 px-2.5 py-2 text-[11px] shadow-xl backdrop-blur"
          style={{
            left: Math.max(4, Math.min(xAt(hover) + 12, width - 168)),
            top: 8,
          }}
        >
          <p className="font-medium text-slate-200">{series[hover].date}</p>
          <p className="mt-1 flex justify-between text-slate-400">
            <span>当日情绪</span>
            <span className="tabular-nums" style={{ color: moodColor(series[hover].score as number, highContrast) }}>
              {formatScore(series[hover].score as number)}
            </span>
          </p>
          <p className="mt-0.5 flex justify-between text-slate-400">
            <span>{DEFAULT_ROLLING_WINDOW} 日均值</span>
            <span className="tabular-nums text-cyan-300">
              {typeof rolling[hover] === 'number' ? formatScore(rolling[hover] as number) : '—'}
            </span>
          </p>
          <p className="mt-0.5 flex justify-between text-slate-500">
            <span>记录条数</span>
            <span className="tabular-nums">{series[hover].messageCount} 条</span>
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="flex -space-x-0.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: moodColor(-0.6, highContrast) }} />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: moodColor(0, highContrast) }} />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: moodColor(0.6, highContrast) }} />
          </span>
          每日情绪值（每点一天，颜色即极性）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: ROLLING_COLOR }} />
          {DEFAULT_ROLLING_WINDOW} 日均线
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: TREND_COLOR }} />
          线性趋势
        </span>
        <span className="ml-auto text-slate-500">日为点、不连线，避免抖动盖住趋势；均线在无记录处断开</span>
      </div>
    </div>
  )
}
