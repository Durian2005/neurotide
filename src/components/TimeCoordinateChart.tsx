import type { TimeCoordinate } from '../utils/timeCoordinates'

interface TimeCoordinateChartProps {
  points: TimeCoordinate[]
  date: Date
}

const WIDTH = 760
const HEIGHT = 250
const PAD = { top: 24, right: 24, bottom: 42, left: 46 }

function xFor(minutes: number): number {
  const innerWidth = WIDTH - PAD.left - PAD.right
  return PAD.left + (minutes / 1440) * innerWidth
}

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:00`
}

function yFor(score: number): number {
  const innerHeight = HEIGHT - PAD.top - PAD.bottom
  return PAD.top + ((1 - score) / 2) * innerHeight
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export default function TimeCoordinateChart({ points, date }: TimeCoordinateChartProps) {
  if (points.length === 0) return null
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(point.minutes)} ${yFor(point.score)}`).join(' ')

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">时间坐标系</h3>
          <p className="mt-1 text-[11px] text-slate-500">{formatDate(date)} · {points.length} 个坐标点 · 横轴为当天时间</p>
        </div>
        <span className="text-[10px] text-slate-500">情绪分值 [-1, 1]</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-white/5 bg-slate-950/45 p-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${formatDate(date)}的时间情绪坐标图`}
          className="h-auto min-w-[560px] w-full"
        >
          {[1, 0, -1].map((score) => (
            <g key={score}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={yFor(score)}
                y2={yFor(score)}
                stroke={score === 0 ? 'rgba(148,163,184,0.42)' : 'rgba(148,163,184,0.16)'}
                strokeDasharray={score === 0 ? undefined : '4 5'}
              />
              <text x={PAD.left - 10} y={yFor(score) + 4} textAnchor="end" fill="#94a3b8" fontSize="11">
                {score > 0 ? '+1' : score < 0 ? '-1' : '0'}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} stroke="rgba(148,163,184,0.38)" />
          {[0, 6, 12, 18, 24].map((hour) => {
            const x = PAD.left + (hour / 24) * (WIDTH - PAD.left - PAD.right)
            return (
              <g key={hour}>
                <line x1={x} x2={x} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="rgba(148,163,184,0.1)" />
                <text x={x} y={HEIGHT - 14} textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'} fill="#64748b" fontSize="11">
                  {formatClock(hour * 60)}
                </text>
              </g>
            )
          })}
          <path d={path} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point) => {
            const x = xFor(point.minutes)
            const y = yFor(point.score)
            const fill = point.level === 'positive' ? '#22d3ee' : point.level === 'negative' ? '#3b82f6' : '#94a3b8'
            return (
              <g key={point.id}>
                <circle cx={x} cy={y} r="5" fill={fill} stroke="#0f172a" strokeWidth="2" />
                <title>{`${point.time} · ${point.score >= 0 ? '+' : ''}${point.score.toFixed(2)} · ${point.text}`}</title>
              </g>
            )
          })}
          <text x={WIDTH / 2} y={HEIGHT - 2} textAnchor="middle" fill="#475569" fontSize="10">时间坐标（当天 00:00–24:00）</text>
        </svg>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">将鼠标悬停在坐标点上可查看时间、分值和对应文本。坐标文本只在当前浏览器内处理。</p>
    </section>
  )
}
