import { useMemo } from 'react'
import { comparePeriods, suggestCompareWindow } from '../utils/analysis'
import { moodColor } from '../utils/moodColor'
import { formatScore } from '../utils/format'
import type { PeriodStats } from '../utils/analysis'
import type { DailyMood } from '../utils/parser'

interface RangeCompareCardProps {
  /** 全量日数据；对比窗口从这里切 */
  allDays: DailyMood[]
}

/** 变化方向 → 文案与配色。「更积极」一律用青色，与全局口径一致 */
function deltaView(value: number, options: { unit?: string; betterWhenPositive?: boolean; digits?: number } = {}) {
  const digits = options.digits ?? 2
  const betterWhenPositive = options.betterWhenPositive ?? true
  const flat = Math.abs(value) < 1e-9
  const good = betterWhenPositive ? value > 0 : value < 0
  const color = flat ? 'text-slate-400' : good ? 'text-cyan-300' : 'text-blue-300'
  const arrow = flat ? '→' : value > 0 ? '↑' : '↓'
  const sign = value > 0 ? '+' : ''
  const shown = options.unit === '%' ? `${sign}${(value * 100).toFixed(1)}%` : `${sign}${value.toFixed(digits)}`
  return { color, arrow, shown }
}

function ScoreBar({ score }: { score: number }) {
  const magnitude = Math.min(1, Math.abs(score)) * 50
  return (
    <div className="relative h-2 w-full rounded bg-slate-900/70">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
      <div
        className="absolute inset-y-0 rounded"
        style={{
          left: score >= 0 ? '50%' : `${50 - magnitude}%`,
          width: `${Math.max(magnitude, 1)}%`,
          backgroundColor: moodColor(score),
        }}
      />
    </div>
  )
}

function periodLabel(prefix: string, period: PeriodStats): string {
  return `${prefix} ${period.start} ~ ${period.end}`
}

export default function RangeCompareCard({ allDays }: RangeCompareCardProps) {
  const comparison = useMemo(() => {
    const window = suggestCompareWindow(allDays)
    return window === null ? null : comparePeriods(allDays, window)
  }, [allDays])

  if (!comparison) {
    return (
      <p className="text-xs leading-relaxed text-slate-500">
        数据跨度不足以做区间对比：需要至少 14 天的记录，才能切出「最近一段」与「之前一段」两个等长窗口。
      </p>
    )
  }

  const { current, previous, delta, windowDays } = comparison
  const rows: Array<{ label: string; a: string; b: string; delta: ReturnType<typeof deltaView> }> = [
    {
      label: '平均情绪值',
      a: formatScore(previous.averageScore),
      b: formatScore(current.averageScore),
      delta: deltaView(delta.averageScore),
    },
    {
      label: '积极天数占比',
      a: `${Math.round(previous.positiveRatio * 100)}%`,
      b: `${Math.round(current.positiveRatio * 100)}%`,
      delta: deltaView(delta.positiveRatio, { unit: '%' }),
    },
    {
      label: '消极天数占比',
      a: `${Math.round(previous.negativeRatio * 100)}%`,
      b: `${Math.round(current.negativeRatio * 100)}%`,
      // 消极占比下降 = 变好，故颜色方向取反
      delta: deltaView(delta.negativeRatio, { unit: '%', betterWhenPositive: false }),
    },
    {
      label: '记录条数',
      a: `${previous.messageCount} 条`,
      b: `${current.messageCount} 条`,
      delta: deltaView(delta.messageCount, { digits: 0 }),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { key: 'A', prefix: '更早', period: previous },
          { key: 'B', prefix: '最近', period: current },
        ].map(({ key, prefix, period }) => (
          <div key={key} className="rounded-xl border border-white/10 bg-slate-900/50 p-2.5">
            <p className="flex items-baseline justify-between text-[10px] text-slate-500">
              <span className="font-semibold text-slate-400">{key}</span>
              <span className="tabular-nums">{periodLabel(prefix, period)}</span>
            </p>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-lg font-semibold tabular-nums" style={{ color: moodColor(period.averageScore) }}>
                {formatScore(period.averageScore)}
              </span>
              <span className="text-[10px] text-slate-500">
                {period.days} 个记录日 · {period.messageCount} 条
              </span>
            </p>
            <div className="mt-2">
              <ScoreBar score={period.averageScore} />
            </div>
          </div>
        ))}
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th scope="col" className="pb-1 text-left font-normal">
              指标
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              A（更早）
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              B（最近）
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              变化
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/5">
              <th scope="row" className="py-1.5 text-left font-normal text-slate-400">
                {row.label}
              </th>
              <td className="py-1.5 text-right text-slate-300">{row.a}</td>
              <td className="py-1.5 text-right text-slate-100">{row.b}</td>
              <td className={`py-1.5 text-right ${row.delta.color}`}>
                {row.delta.arrow} {row.delta.shown}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[10px] leading-relaxed text-slate-500">
        窗口长度 {windowDays} 天：B 为最近 {windowDays} 天，A 为紧邻其前的 {windowDays}{' '}
        天。任一侧完全没有记录时不显示对比 ——否则「从无到有」会被误读成情绪突变。
      </p>
    </div>
  )
}
