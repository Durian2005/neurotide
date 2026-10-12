import { useMemo } from 'react'
import { buildWordCloud } from '../utils/analysis'
import type { AnalyzedMessage } from '../utils/parser'

interface WordCloudProps {
  messages: AnalyzedMessage[]
  limit?: number
}

const MIN_SIZE = 12
const MAX_SIZE = 30

export default function WordCloud({ messages, limit = 40 }: WordCloudProps) {
  const words = useMemo(() => buildWordCloud(messages, limit), [messages, limit])

  if (words.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-500">当前区间没有命中任何情绪词</p>
  }

  const counts = words.map((item) => item.count)
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const positiveTotal = words.filter((item) => item.positive).reduce((sum, item) => sum + item.count, 0)
  const negativeTotal = words.reduce((sum, item) => sum + item.count, 0) - positiveTotal

  // 用平方根压缩频次差：否则最高频词会压倒性变大，长尾全部挤成一行
  const sizeOf = (count: number): number => {
    if (max <= min) return (MIN_SIZE + MAX_SIZE) / 2
    const ratio = (count - min) / (max - min)
    return MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.sqrt(ratio)
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        {words.map((item) => {
          const size = sizeOf(item.count)
          const strong = size > (MIN_SIZE + MAX_SIZE) / 2
          return (
            <span
              key={item.word}
              title={`${item.word} · 出现 ${item.count} 次`}
              className={`cursor-default leading-tight transition-opacity hover:opacity-80 ${
                item.positive ? 'text-cyan-300' : 'text-blue-300'
              }`}
              style={{ fontSize: `${size.toFixed(1)}px`, fontWeight: strong ? 600 : 400 }}
            >
              {item.word}
            </span>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[10px] text-slate-500">
        <span className="text-cyan-300/80">积极命中 {positiveTotal} 次</span>
        <span className="text-blue-300/80">消极命中 {negativeTotal} 次</span>
        <span className="ml-auto">字号 = 出现频次（平方根压缩） · 颜色 = 极性</span>
      </div>
    </div>
  )
}
