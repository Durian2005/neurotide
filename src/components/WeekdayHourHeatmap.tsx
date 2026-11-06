import { useMemo } from 'react'
import { HOUR_BAND_LABELS, MIN_CELL_SAMPLES, WEEKDAY_LABELS, buildWeekdayHourMatrix } from '../utils/analysis'
import { moodColor, moodTextColor } from '../utils/moodColor'
import { moodGlyph } from '../utils/sentiment'
import { formatScore } from '../utils/format'
import { PALETTE } from '../utils/palette'
import type { AnalyzedMessage } from '../utils/parser'

interface WeekdayHourHeatmapProps {
  messages: AnalyzedMessage[]
  /** 高对比：单元格改用高对比配色 */
  highContrast?: boolean
}

const EMPTY_CELL = PALETTE.noData

export default function WeekdayHourHeatmap({ messages, highContrast = false }: WeekdayHourHeatmapProps) {
  const matrix = useMemo(() => buildWeekdayHourMatrix(messages), [messages])

  if (matrix.totalCount === 0) {
    return <p className="py-6 text-center text-xs text-ink-muted">当前区间没有可统计的记录</p>
  }

  const describe = (weekday: number, band: number): string => {
    const cell = matrix.grid[weekday][band]
    if (!cell) return `${WEEKDAY_LABELS[weekday]} ${HOUR_BAND_LABELS[band]} 点：无记录`
    return `${WEEKDAY_LABELS[weekday]} ${HOUR_BAND_LABELS[band]} 点：${cell.count} 条，平均 ${formatScore(cell.score)}（积极 ${cell.positive} / 消极 ${cell.negative}）`
  }

  return (
    <div>
      <table className="w-full border-separate border-spacing-[3px]">
        <caption className="sr-only">星期与时段交叉统计，颜色表示平均情绪值，数字表示记录条数</caption>
        <thead>
          <tr>
            <th scope="col" className="w-10" />
            {HOUR_BAND_LABELS.map((label) => (
              <th key={label} scope="col" className="pb-1 text-[10px] font-normal text-ink-muted">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAY_LABELS.map((weekdayLabel, weekday) => (
            <tr key={weekdayLabel}>
              <th scope="row" className="pr-1 text-right text-[10px] font-normal text-ink-muted">
                {weekdayLabel}
              </th>
              {HOUR_BAND_LABELS.map((hourLabel, band) => {
                const cell = matrix.grid[weekday][band]
                const isBest = matrix.best?.weekday === weekday && matrix.best?.band === band
                const isWorst = matrix.worst?.weekday === weekday && matrix.worst?.band === band
                return (
                  <td key={hourLabel} className="p-0">
                    <div
                      title={describe(weekday, band)}
                      className={`flex aspect-square w-full flex-col items-center justify-center rounded text-[10px] leading-none tabular-nums transition-transform hover:scale-[1.06] ${
                        cell ? '' : 'text-transparent'
                      } ${isBest ? 'ring-1 ring-clay' : ''} ${isWorst ? 'ring-1 ring-negative-ink' : ''}`}
                      style={{
                        backgroundColor: cell ? moodColor(cell.score, highContrast) : EMPTY_CELL,
                        // 格子亮度随分值变化，前景自动在深墨 / 奶油白之间切换，保证 10px 数字可读
                        color: cell ? moodTextColor(cell.score, highContrast) : undefined,
                      }}
                    >
                      {cell ? (
                        <>
                          <span>{cell.count}</span>
                          {/* 方向字形：颜色之外的第二通道 */}
                          <span aria-hidden="true" className="mt-0.5 text-[8px]">
                            {moodGlyph(cell.score)}
                          </span>
                        </>
                      ) : (
                        '·'
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-[10px] leading-relaxed text-ink-muted">
        <p className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: moodColor(-0.6, highContrast) }} />
            消极 ▼
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: moodColor(0, highContrast) }} />
            中性 ·
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: moodColor(0.6, highContrast) }} />
            积极 ▲
          </span>
          <span className="ml-auto">色 = 平均情绪值 · 数字 = 条数 · 字形 = 方向</span>
        </p>
        {matrix.best && (
          <p className="text-clay-ink">
            最好时段：{WEEKDAY_LABELS[matrix.best.weekday]} {HOUR_BAND_LABELS[matrix.best.band]} 点（
            {formatScore(matrix.best.cell.score)}，{matrix.best.cell.count} 条）
          </p>
        )}
        {matrix.worst && (
          <p className="text-negative-ink">
            最差时段：{WEEKDAY_LABELS[matrix.worst.weekday]} {HOUR_BAND_LABELS[matrix.worst.band]} 点（
            {formatScore(matrix.worst.cell.score)}，{matrix.worst.cell.count} 条）
          </p>
        )}
        <p>最好 / 最差时段要求该格至少 {MIN_CELL_SAMPLES} 条记录，避免单条记录就下结论。</p>
      </div>
    </div>
  )
}
