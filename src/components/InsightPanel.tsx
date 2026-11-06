import { useMemo } from 'react'
import { motion } from 'framer-motion'
import TrendChart from './TrendChart'
import WeekdayHourHeatmap from './WeekdayHourHeatmap'
import RangeCompareCard from './RangeCompareCard'
import WordCloud from './WordCloud'
import { DEFAULT_ROLLING_WINDOW, analyzeStreaks, buildDenseSeries, linearTrend, moodRatios } from '../utils/analysis'
import { PALETTE } from '../utils/palette'
import { formatScore } from '../utils/format'
import type { DailyMood } from '../utils/parser'

interface InsightPanelProps {
  /** 当前筛选区间 */
  days: DailyMood[]
  /** 全量日数据，供区间对比切窗口 */
  allDays: DailyMood[]
  rangeLabel: string
  /** 点击趋势图上的某天时回调 */
  onSelect?: (day: DailyMood) => void
  /** 高对比：图表改用高对比配色 */
  highContrast?: boolean
}

const CARD = 'rounded-2xl border border-line bg-card p-4'

interface KpiCard {
  label: string
  value: string
  note: string
  color: string
}

export default function InsightPanel({ days, allDays, rangeLabel, onSelect, highContrast = false }: InsightPanelProps) {
  const series = useMemo(() => buildDenseSeries(days), [days])
  const trend = useMemo(() => linearTrend(series), [series])
  const streaks = useMemo(() => analyzeStreaks(days), [days])
  const ratios = useMemo(() => moodRatios(days), [days])
  const messages = useMemo(() => days.flatMap((day) => day.messages), [days])

  if (days.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-line bg-sunken">
        <p className="text-xs text-ink-muted">载入数据后展示趋势与洞察</p>
      </div>
    )
  }

  const gapDays = Math.max(0, series.length - days.length)
  const trendColor =
    trend.direction === 'up' ? PALETTE.clayInk : trend.direction === 'down' ? PALETTE.negativeInk : PALETTE.inkMuted
  const trendArrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'
  const lastColor =
    trend.last === null
      ? PALETTE.inkMuted
      : trend.last >= 0.12
        ? PALETTE.clayInk
        : trend.last <= -0.12
          ? PALETTE.negativeInk
          : PALETTE.inkMuted
  const low = streaks.low
  const positiveRatio = ratios.total > 0 ? ratios.positive / ratios.total : 0

  const kpis: KpiCard[] = [
    {
      label: '趋势（每 30 天）',
      value: `${trendArrow} ${trend.slopePer30Days >= 0 ? '+' : ''}${trend.slopePer30Days.toFixed(3)}`,
      note: trend.points >= 2 ? `最小二乘拟合，基于 ${trend.points} 个记录日` : '记录不足 2 天，无法拟合',
      color: trendColor,
    },
    {
      label: '当前连续低落',
      value: low.current ? `${low.current.length} 天` : '无',
      note: low.current ? `${low.current.start} ~ ${low.current.end}` : '最后一个记录日不处于低落区间',
      color: low.current ? PALETTE.negativeInk : PALETTE.inkMuted,
    },
    {
      label: '最长连续低落',
      value: low.longest ? `${low.longest.length} 天` : '无',
      note: low.longest ? `${low.longest.start} ~ ${low.longest.end}` : '区间内没有连续低落',
      color: low.longest ? PALETTE.negativeInk : PALETTE.inkMuted,
    },
    {
      label: '积极天数占比',
      value: `${Math.round(positiveRatio * 100)}%`,
      note: `${ratios.positive} / ${ratios.total} 个记录日`,
      color: positiveRatio >= 0.5 ? PALETTE.clayInk : PALETTE.inkMuted,
    },
  ]

  return (
    <motion.div
      key={rangeLabel}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full space-y-4 overflow-y-auto pb-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-semibold text-ink">趋势与洞察</h2>
        <span className="text-[11px] text-ink-muted">{rangeLabel}</span>
        <span className="text-[11px] text-ink-muted">
          {days.length} 个记录日 · 跨度 {series.length} 天{gapDays > 0 && ` · 其中 ${gapDays} 天无记录`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={CARD}>
            <p className="text-[10px] text-ink-muted">{kpi.label}</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums" style={{ color: kpi.color }}>
              {kpi.value}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-ink-muted">{kpi.note}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className={`${CARD} xl:col-span-3`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold text-ink-soft">情绪走势</h3>
            <span className="text-[10px] text-ink-muted">
              区间均值 {formatScore(ratios.total > 0 ? days.reduce((sum, day) => sum + day.score, 0) / days.length : 0)}
              {' · '}
              <span style={{ color: lastColor }}>末日 {trend.last === null ? '—' : formatScore(trend.last)}</span>
            </span>
          </div>
          <TrendChart days={days} onSelect={onSelect} highContrast={highContrast} />
        </section>

        <section className={`${CARD} xl:col-span-2`}>
          <h3 className="mb-3 text-xs font-semibold text-ink-soft">星期 × 时段分布</h3>
          <WeekdayHourHeatmap messages={messages} highContrast={highContrast} />
        </section>

        <section className={CARD}>
          <h3 className="mb-3 text-xs font-semibold text-ink-soft">情绪词云</h3>
          <WordCloud messages={messages} />
        </section>

        <section className={`${CARD} xl:col-span-3`}>
          <h3 className="mb-3 text-xs font-semibold text-ink-soft">区间对比</h3>
          <RangeCompareCard allDays={allDays} />
        </section>
      </div>

      <p className="text-[10px] leading-relaxed text-ink-muted">
        {DEFAULT_ROLLING_WINDOW} 日均线按日历窗口滑动，窗口内只统计有记录的天；连续天数要求相邻两天日期正好相差 1
        天，中间断更即断开——两者都刻意不把「没有记录」当作「情绪中性」。
      </p>
    </motion.div>
  )
}
