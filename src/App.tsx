import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import UploadPanel from './components/UploadPanel'
import CalendarHeatmap from './components/CalendarHeatmap'
import DayDetail from './components/DayDetail'
import ScreenshotMode from './components/ScreenshotMode'
import { RANGE_LABEL, buildOverview, filterByRange, parseChatLog } from './utils/parser'
import type { DailyMood, ParseResult, TimeRange } from './utils/parser'
import { buildSampleChatLog } from './utils/sampleData'
import { formatFullDate, formatScore } from './utils/format'
import { DICTIONARY_SIZE, MOOD_TEXT_CLASS, moodLabel, moodLevel } from './utils/sentiment'

const RANGES: TimeRange[] = ['3m', '6m', 'all']
type AppMode = 'timeline' | 'screenshot'

export default function App() {
  const [mode, setMode] = useState<AppMode>('timeline')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<ParseResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<TimeRange>('all')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const handleText = useCallback((text: string, name: string) => {
    const result = parseChatLog(text)
    if (result.days.length === 0) {
      setError('未识别到符合格式的记录，请确认每行形如 [YYYY-MM-DD HH:mm:ss] 昵称: 内容')
      return
    }
    setError('')
    setData(result)
    setFileName(name)
    setSelectedDate(null)
  }, [])

  const handleLoadSample = useCallback(() => {
    handleText(buildSampleChatLog(), '示例数据（自动生成 10 个月）')
  }, [handleText])

  const filteredDays = useMemo(
    () => (data ? filterByRange(data.days, range) : []),
    [data, range],
  )

  const overview = useMemo(() => buildOverview(filteredDays), [filteredDays])

  const selectedDay = useMemo(
    () => filteredDays.find((day) => day.date === selectedDate) ?? null,
    [filteredDays, selectedDate],
  )

  const handleSelect = useCallback((day: DailyMood) => {
    setSelectedDate((current) => (current === day.date ? null : day.date))
  }, [])

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `neurotide-${RANGE_LABEL[range].replace(/\s/g, '')}.png`
    link.click()
  }, [range])

  const hasData = filteredDays.length > 0

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900 text-slate-200">
      {/* 左侧 30% 控制面板 */}
      <aside className="flex h-full w-[30%] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-slate-900 p-4">
        <header className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-700">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#0f172a" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l2.5-6 3 12 2.5-8 1.5 4h5.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight text-slate-100">NeuroTide</h1>
            <p className="truncate text-[11px] text-slate-500">个人数据情绪地图 · 纯本地分析</p>
          </div>
        </header>

        <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-3">
          <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-slate-400">分析模式</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="选择分析模式">
            <button
              type="button"
              aria-pressed={mode === 'timeline'}
              onClick={() => setMode('timeline')}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${mode === 'timeline' ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
            >
              <span className="block text-xs font-semibold">聊天记录 TXT</span>
              <span className="mt-1 block text-[10px] opacity-70">按日期生成情绪日历</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'screenshot'}
              onClick={() => setMode('screenshot')}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${mode === 'screenshot' ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
            >
              <span className="block text-xs font-semibold">聊天截图</span>
              <span className="mt-1 block text-[10px] opacity-70">单图 OCR 与情绪分析</span>
            </button>
          </div>
        </section>

        {mode === 'timeline' && (
          <>
            <UploadPanel
              onText={handleText}
              onLoadSample={handleLoadSample}
              fileName={fileName}
              error={error}
            />

        <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
          <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400">时间筛选</h2>
          <div className="grid grid-cols-3 gap-2">
            {RANGES.map((item) => {
              const active = item === range
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRange(item)}
                  disabled={!data}
                  className={`rounded-lg border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-300'
                      : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {RANGE_LABEL[item]}
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
          <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400">数据概览</h2>
          {hasData ? (
            <motion.dl
              key={range}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs">
                <dt className="text-slate-400">总天数</dt>
                <dd className="font-semibold tabular-nums text-slate-100">{overview.totalDays} 天</dd>
              </div>
              <div className="flex items-center justify-between text-xs">
                <dt className="text-slate-400">记录条数</dt>
                <dd className="font-semibold tabular-nums text-slate-100">{overview.messageCount} 条</dd>
              </div>
              <div className="flex items-center justify-between text-xs">
                <dt className="text-slate-400">平均情绪值</dt>
                <dd className={`font-semibold tabular-nums ${MOOD_TEXT_CLASS[moodLevel(overview.averageScore)]}`}>
                  {formatScore(overview.averageScore)}
                  <span className="ml-1 font-normal text-slate-500">{moodLabel(overview.averageScore)}</span>
                </dd>
              </div>
              <div className="border-t border-white/5 pt-2.5">
                <div className="flex items-center justify-between text-xs">
                  <dt className="text-slate-400">最积极的一天</dt>
                  <dd className="text-right">
                    {overview.bestDay ? (
                      <>
                        <span className="text-slate-200">{formatFullDate(overview.bestDay.day)}</span>
                        <span className="ml-1 tabular-nums text-cyan-300">
                          {formatScore(overview.bestDay.score)}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </dd>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <dt className="text-slate-400">最消极的一天</dt>
                  <dd className="text-right">
                    {overview.worstDay ? (
                      <>
                        <span className="text-slate-200">{formatFullDate(overview.worstDay.day)}</span>
                        <span className="ml-1 tabular-nums text-blue-300">
                          {formatScore(overview.worstDay.score)}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </dd>
                </div>
              </div>
            </motion.dl>
          ) : (
            <p className="text-xs text-slate-500">载入数据后展示统计结果</p>
          )}
        </section>

        <button
          type="button"
          onClick={handleExport}
          disabled={!hasData}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          导出当前视图 PNG
        </button>

        <div className="mt-auto space-y-1.5 pt-2 text-[11px] leading-relaxed text-slate-500">
          <p>
            本地词典：积极 {DICTIONARY_SIZE.positive} 词 / 消极 {DICTIONARY_SIZE.negative} 词，命中计
            +1 / -1，按天归一化至 [-1, 1]。
          </p>
          <p>所有解析与计算均在浏览器完成，文件不会离开本机。</p>
        </div>
          </>
        )}
        {mode === 'screenshot' && (
          <div className="mt-auto pt-2 text-[10px] leading-relaxed text-slate-600">
            截图 OCR 完全在本地执行，不调用外部 API；词典情绪结果仅供参考。
          </div>
        )}
      </aside>

      <main className={`relative h-full min-w-0 flex-1 p-4 ${mode === 'screenshot' ? 'overflow-hidden' : ''}`}>
        {mode === 'screenshot' ? (
          <ScreenshotMode />
        ) : (
          <>
            <CalendarHeatmap
              days={filteredDays}
              selectedDate={selectedDate}
              rangeLabel={RANGE_LABEL[range]}
              canvasRef={canvasRef}
              onSelect={handleSelect}
            />
            <AnimatePresence>
              {selectedDay && <DayDetail day={selectedDay} onClose={() => setSelectedDate(null)} />}
            </AnimatePresence>
          </>
        )}
      </main>
    </div>
  )
}