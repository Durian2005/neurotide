import { motion } from 'framer-motion'
import { MOOD_DOT_CLASS, MOOD_TEXT_CLASS, moodLabel, moodLevel } from '../utils/sentiment'
import { formatFullDate, formatScore } from '../utils/format'
import type { DailyMood } from '../utils/parser'

interface TooltipProps {
  day: DailyMood
  /** 相对画布容器的定位 */
  left: number
  top: number
}

export default function Tooltip({ day, left, top }: TooltipProps) {
  const level = moodLevel(day.score)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      style={{ left, top }}
      className="pointer-events-none absolute z-30 w-56 rounded-xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-200">{formatFullDate(day.day)}</span>
        <span className={`text-xs font-semibold tabular-nums ${MOOD_TEXT_CLASS[level]}`}>
          {formatScore(day.score)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${MOOD_DOT_CLASS[level]}`} />
        <span className={`text-xs ${MOOD_TEXT_CLASS[level]}`}>{moodLabel(day.score)}</span>
        <span className="ml-auto text-[11px] text-slate-500">{day.messageCount} 条记录</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {day.topWords.length > 0 ? (
          day.topWords.slice(0, 4).map((item) => (
            <span
              key={item.word}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                item.positive ? 'bg-cyan-400/15 text-cyan-300' : 'bg-blue-500/20 text-blue-300'
              }`}
            >
              {item.word}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-slate-500">无命中情绪词</span>
        )}
      </div>

      <p className="mt-2 border-t border-white/5 pt-1.5 text-[11px] text-slate-500">点击查看当日详情</p>
    </motion.div>
  )
}