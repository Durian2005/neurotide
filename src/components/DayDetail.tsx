import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { MOOD_DOT_CLASS, MOOD_TEXT_CLASS, moodLabel, moodLevel } from '../utils/sentiment'
import { formatFullDate, formatScore } from '../utils/format'
import type { DailyMood } from '../utils/parser'

interface DayDetailProps {
  day: DailyMood
  onClose: () => void
}

type SegmentKind = 'plain' | 'positive' | 'negative'

interface Segment {
  text: string
  kind: SegmentKind
}

const CHART_HEIGHT = 120

// 找出命中情绪词的位置区间，用于原文高亮
function buildSegments(content: string, positiveWords: string[], negativeWords: string[]): Segment[] {
  const marks: Array<{ start: number; end: number; kind: SegmentKind }> = []

  const collect = (words: string[], kind: SegmentKind) => {
    for (const word of words) {
      let from = 0
      while (true) {
        const index = content.indexOf(word, from)
        if (index === -1) break
        marks.push({ start: index, end: index + word.length, kind })
        from = index + word.length
      }
    }
  }
  collect(positiveWords, 'positive')
  collect(negativeWords, 'negative')
  marks.sort((a, b) => a.start - b.start || b.end - a.end)

  const segments: Segment[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor) continue
    if (mark.start > cursor) segments.push({ text: content.slice(cursor, mark.start), kind: 'plain' })
    segments.push({ text: content.slice(mark.start, mark.end), kind: mark.kind })
    cursor = mark.end
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), kind: 'plain' })
  return segments
}

function segmentClass(kind: SegmentKind): string {
  if (kind === 'positive') return 'rounded bg-cyan-400/20 px-0.5 text-cyan-200'
  if (kind === 'negative') return 'rounded bg-blue-500/25 px-0.5 text-blue-200'
  return 'text-slate-300'
}

// 当日情绪折线微缩图（原生 Canvas）
function MiniTrendChart({ day }: { day: DailyMood }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  const values = useMemo(() => {
    let running = 0
    const runningValues = day.messages.map((message) => (running += message.raw))
    const maxAbs = Math.max(1, ...runningValues.map((value) => Math.abs(value)))
    return runningValues.map((value) => value / maxAbs)
  }, [day])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(CHART_HEIGHT * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${CHART_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, CHART_HEIGHT)

    const padX = 10
    const padY = 12
    const innerW = width - padX * 2
    const innerH = CHART_HEIGHT - padY * 2
    const toY = (value: number) => padY + ((1 - value) / 2) * innerH

    // 零线
    ctx.strokeStyle = 'rgba(148,163,184,0.35)'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(padX, toY(0))
    ctx.lineTo(width - padX, toY(0))
    ctx.stroke()
    ctx.setLineDash([])

    if (values.length === 0) return

    const toX = (index: number) =>
      values.length === 1 ? padX + innerW / 2 : padX + (index / (values.length - 1)) * innerW

    // 走势填充
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(values[0]))
    for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]))
    ctx.lineTo(toX(values.length - 1), toY(0))
    ctx.lineTo(toX(0), toY(0))
    ctx.closePath()
    ctx.fillStyle = 'rgba(34,211,238,0.12)'
    ctx.fill()

    // 折线
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(values[0]))
    for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]))
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    // 数据点
    for (let i = 0; i < values.length; i++) {
      ctx.beginPath()
      ctx.arc(toX(i), toY(values[i]), values.length > 40 ? 1.6 : 3, 0, Math.PI * 2)
      ctx.fillStyle = values[i] > 0 ? '#22d3ee' : values[i] < 0 ? '#3b82f6' : '#94a3b8'
      ctx.fill()
    }
  }, [values, width])

  return (
    <div ref={wrapRef} className="relative h-[120px] w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {day.messages.length === 1 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[10px] text-slate-500">
          当日仅 1 条记录
        </p>
      )}
    </div>
  )
}

export default function DayDetail({ day, onClose }: DayDetailProps) {
  const level = moodLevel(day.score)

  return (
    <motion.aside
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 48 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="absolute inset-y-3 right-3 z-20 flex w-[360px] max-w-[80%] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{formatFullDate(day.day)}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${MOOD_DOT_CLASS[level]}`} />
            <span className={MOOD_TEXT_CLASS[level]}>{moodLabel(day.score)}</span>
            <span className="tabular-nums text-slate-400">{formatScore(day.score)}</span>
            <span className="text-slate-500">· {day.messageCount} 条</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭当日详情"
          className="rounded-lg border border-white/10 p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="shrink-0 border-b border-white/10 px-4 py-3">
        <p className="mb-1 text-[11px] text-slate-500">当日情绪折线</p>
        <MiniTrendChart day={day} />
      </div>

      {day.topWords.length > 0 && (
        <div className="shrink-0 border-b border-white/10 px-4 py-2.5">
          <p className="mb-1.5 text-[11px] text-slate-500">主导情绪词</p>
          <div className="flex flex-wrap gap-1.5">
            {day.topWords.map((item) => (
              <span
                key={item.word}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  item.positive ? 'bg-cyan-400/15 text-cyan-300' : 'bg-blue-500/20 text-blue-300'
                }`}
              >
                {item.word} ×{item.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-[11px] text-slate-500">原始记录（命中词已高亮）</p>
        <ul className="space-y-2.5">
          {day.messages.map((message, index) => (
            <li key={`${message.timestamp}-${index}`} className="rounded-xl bg-slate-800/50 p-2.5">
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                <span className="text-slate-400">{message.nickname}</span>
                <span className="tabular-nums">
                  {String(message.date.getHours()).padStart(2, '0')}:
                  {String(message.date.getMinutes()).padStart(2, '0')}
                </span>
              </div>
              <p className="text-xs leading-relaxed">
                {buildSegments(message.content, message.positiveWords, message.negativeWords).map(
                  (segment, segmentIndex) => (
                    <span key={segmentIndex} className={segmentClass(segment.kind)}>
                      {segment.text}
                    </span>
                  ),
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </motion.aside>
  )
}