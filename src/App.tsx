import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import UploadPanel from './components/UploadPanel'
import DatasetPanel from './components/DatasetPanel'
import CalendarHeatmap from './components/CalendarHeatmap'
import DayDetail from './components/DayDetail'
import InsightPanel from './components/InsightPanel'
import ScreenshotMode from './components/ScreenshotMode'
import {
  CHUNK_THRESHOLD_CHARS,
  RANGE_LABEL,
  buildOverview,
  filterByRange,
  parseChatLog,
  parseChatLogAsync,
} from './utils/parser'
import type { DailyMood, ParseReport, ParseResult, TimeRange } from './utils/parser'
import { buildSampleChatLog } from './utils/sampleData'
import { formatFullDate, formatScore } from './utils/format'
import { DICTIONARY_SIZE, MOOD_TEXT_CLASS, moodLabel, moodLevel } from './utils/sentiment'
import { BACKEND_LABEL, resolveDatasetStore } from './utils/browserStorage'
import { StorageError, buildDatasetMeta, createDatasetId } from './utils/datasetStore'
import type { DatasetMeta, DatasetStore } from './utils/datasetStore'
import { buildBackupJson, buildDailyCsv, parseBackupJson, safeFileName } from './utils/exportReport'
import { downloadCanvasPng, downloadText, renderReportCanvas } from './utils/browserExport'

function describeStorageError(error: unknown): string {
  if (error instanceof StorageError) return error.message
  return '本地保存失败，本次数据仍可正常查看。'
}

const RANGES: TimeRange[] = ['3m', '6m', 'all']
type AppMode = 'timeline' | 'screenshot'
type MainView = 'heatmap' | 'insights'

const VIEWS: Array<{ key: MainView; label: string; hint: string }> = [
  { key: 'heatmap', label: '日历热力图', hint: '按日期看每一天' },
  { key: 'insights', label: '趋势与洞察', hint: '趋势 / 时段 / 对比 / 词云' },
]

/** 侧栏在 lg 以下折叠为抽屉 */
const PANEL_MEDIA = '(min-width: 1024px)'

export default function App() {
  const [mode, setMode] = useState<AppMode>('timeline')
  const [view, setView] = useState<MainView>('heatmap')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<ParseResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [encoding, setEncoding] = useState('')
  const [report, setReport] = useState<ParseReport | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<TimeRange>('all')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // --- 本地持久化 ---
  const storeRef = useRef<DatasetStore | null>(null)
  /** 当前数据的原始文本，供 JSON 备份导出；不入 state，避免每次输入都参与渲染比较 */
  const sourceTextRef = useRef<string | null>(null)
  const [datasets, setDatasets] = useState<DatasetMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [backendLabel, setBackendLabel] = useState('检测中')
  const [backendNotice, setBackendNotice] = useState('')
  const [persistEnabled, setPersistEnabled] = useState(true)
  const [colorSafe, setColorSafe] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  /** 窄屏抽屉；lg 及以上侧栏常驻，这个状态不起作用 */
  const [panelOpen, setPanelOpen] = useState(false)
  const [storageMessage, setStorageMessage] = useState('')
  const [busy, setBusy] = useState(false)
  /** 分片解析进度 0–1；同步路径与小文件为 null */
  const [parseProgress, setParseProgress] = useState<number | null>(null)

  /**
   * 解析结果落到界面状态；未识别到记录时返回 null。
   * 与解析方式解耦，同步与分片两条路径共用同一段落状态逻辑。
   */
  const applyResult = useCallback((result: ParseResult, text: string, name: string, enc: string) => {
    sourceTextRef.current = text
    if (result.days.length === 0) {
      setData(null)
      setFileName(null)
      setEncoding(enc)
      setReport(result.report)
      setError(
        `未识别到符合条件的记录（当前判定格式：${result.report.formatLabel}）。支持 [时间] 昵称: 内容、时间 昵称: 内容，以及「时间行 + 换行内容」。`,
      )
      return null
    }
    setError('')
    setData(result)
    setFileName(name)
    setEncoding(enc)
    setReport(result.report)
    setSelectedDate(null)
    return result
  }, [])

  /** 同步导入：小文件走这条，比分片少一次让出与一次额外渲染 */
  const applyText = useCallback(
    (text: string, name: string, enc: string) => applyResult(parseChatLog(text), text, name, enc),
    [applyResult],
  )

  /**
   * 大文本分片解析，并在片间上报进度。
   * 进度按 120ms 节流：每片都 setState 会让 App 在解析期间被重渲染上百次，
   * 反而把让出主线程换来的顺滑吃回去。
   */
  const parsePayload = useCallback(
    async (payload: string, name: string, enc: string, signal?: AbortSignal) => {
      if (payload.length < CHUNK_THRESHOLD_CHARS) return applyText(payload, name, enc)

      let lastReportedAt = 0
      setParseProgress(0)
      try {
        const result = await parseChatLogAsync(payload, {
          signal,
          onProgress: ({ processed, total }) => {
            const ratio = total > 0 ? processed / total : 1
            const now = Date.now()
            if (processed < total && now - lastReportedAt < 120) return
            lastReportedAt = now
            setParseProgress(ratio)
          },
        })
        return applyResult(result, payload, name, enc)
      } catch (failure) {
        // 被取消不算失败：调用方通常已经卸载或换了一份数据
        if (failure instanceof DOMException && failure.name === 'AbortError') return null
        throw failure
      } finally {
        setParseProgress(null)
      }
    },
    [applyText, applyResult],
  )

  // 启动时探测存储后端、列出已保存数据集，并恢复上次会话
  useEffect(() => {
    let cancelled = false
    // 恢复大文件时也走分片，组件卸载/换数据时取消，避免 StrictMode 下两遍解析互相打
    const controller = new AbortController()
    void (async () => {
      setBusy(true)
      try {
        const { store, kind, notice } = await resolveDatasetStore()
        if (cancelled) return
        storeRef.current = store
        setBackendLabel(BACKEND_LABEL[kind])
        setBackendNotice(notice)

        const settings = await store.getSettings()
        const list = await store.list()
        if (cancelled) return
        setPersistEnabled(settings.persistEnabled)
        setColorSafe(settings.colorSafe)
        setHighContrast(settings.highContrast)
        setDatasets(list)

        const active = await store.getActiveId()
        if (cancelled || !active) return
        const dataset = await store.load(active)
        if (cancelled || !dataset) return
        const restored = await parsePayload(dataset.text, dataset.name, dataset.encoding, controller.signal)
        if (cancelled || !restored) return
        setActiveId(dataset.id)
        setStorageMessage(`已恢复上次会话：${dataset.name}`)
      } catch (failure) {
        if (!cancelled) setBackendNotice(describeStorageError(failure))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [parsePayload])

  const refreshDatasets = useCallback(async () => {
    const store = storeRef.current
    if (store) setDatasets(await store.list())
  }, [])

  /** 导入文本：解析 → 落界面 →（按开关）保存到本机 */
  const handleText = useCallback(
    async (text: string, name: string, enc = 'UTF-8') => {
      // 本应用导出的 JSON 备份：取出内嵌的原始文本后按普通聊天记录处理
      const backup = parseBackupJson(text)
      const payload = backup ? backup.text : text
      const datasetName = backup ? backup.name : name
      const payloadEncoding = backup ? backup.encoding : enc

      const result = await parsePayload(payload, datasetName, payloadEncoding)
      if (!result) return

      const store = storeRef.current
      if (!store || !persistEnabled) {
        setStorageMessage(persistEnabled ? '' : '「保存到本机」已关闭，本次数据仅当前会话可用。')
        return
      }

      try {
        // 同名数据集视为更新，避免反复导入同一文件堆出多份副本
        const existing = datasets.find((item) => item.name === datasetName)
        const id = existing?.id ?? createDatasetId()
        const meta = buildDatasetMeta({ id, name: datasetName, encoding: payloadEncoding, text: payload, result })
        await store.save({ ...meta, text: payload })
        await store.setActiveId(id)
        await refreshDatasets()
        setActiveId(id)
        setStorageMessage(backup ? `已从备份还原并保存：${datasetName}` : `已保存到本机：${datasetName}`)
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      }
    },
    [parsePayload, datasets, persistEnabled, refreshDatasets],
  )

  const handleLoadSample = useCallback(() => {
    void handleText(buildSampleChatLog(), '示例数据（自动生成 10 个月）', '内置生成')
  }, [handleText])

  const handleLoadDataset = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      setBusy(true)
      try {
        const dataset = await store.load(id)
        if (!dataset) {
          setStorageMessage('该数据集已不存在，列表已刷新。')
          await refreshDatasets()
          return
        }
        if (await parsePayload(dataset.text, dataset.name, dataset.encoding)) {
          await store.setActiveId(id)
          setActiveId(id)
          setStorageMessage(`已载入：${dataset.name}`)
        }
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      } finally {
        setBusy(false)
      }
    },
    [parsePayload, refreshDatasets],
  )

  const handleDeleteDataset = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      const target = datasets.find((item) => item.id === id)
      try {
        await store.remove(id)
        await refreshDatasets()
        if (activeId === id) {
          setActiveId(null)
          setData(null)
          setFileName(null)
          setReport(null)
          sourceTextRef.current = null
        }
        setStorageMessage(`已删除：${target?.name ?? id}`)
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      }
    },
    [activeId, datasets, refreshDatasets],
  )

  const handleClearAll = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    try {
      await store.clear()
      setDatasets([])
      setActiveId(null)
      setData(null)
      setFileName(null)
      setReport(null)
      sourceTextRef.current = null
      setStorageMessage('已清空本机保存的全部数据。')
    } catch (failure) {
      setStorageMessage(describeStorageError(failure))
    }
  }, [])

  const handleTogglePersist = useCallback(
    async (enabled: boolean) => {
      setPersistEnabled(enabled)
      const store = storeRef.current
      if (!store) return
      try {
        await store.setSettings({ persistEnabled: enabled, colorSafe, highContrast })
        setStorageMessage(enabled ? '之后的导入会保存到本机。' : '之后的导入不会保存到本机。')
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      }
    },
    [colorSafe, highContrast],
  )

  /** 无障碍设置：存储不可用时只改内存状态，本次会话仍然生效 */
  const handleToggleColorSafe = useCallback(
    async (enabled: boolean) => {
      setColorSafe(enabled)
      const store = storeRef.current
      if (!store) return
      try {
        await store.setSettings({ persistEnabled, colorSafe: enabled, highContrast })
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      }
    },
    [highContrast, persistEnabled],
  )

  const handleToggleHighContrast = useCallback(
    async (enabled: boolean) => {
      setHighContrast(enabled)
      const store = storeRef.current
      if (!store) return
      try {
        await store.setSettings({ persistEnabled, colorSafe, highContrast: enabled })
      } catch (failure) {
        setStorageMessage(describeStorageError(failure))
      }
    },
    [colorSafe, persistEnabled],
  )

  // 视口跨回 lg 时收起抽屉，避免常驻侧栏与抽屉同时出现
  useEffect(() => {
    const query = window.matchMedia(PANEL_MEDIA)
    const sync = () => {
      if (query.matches) setPanelOpen(false)
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // 抽屉打开时支持 Esc 关闭
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  const filteredDays = useMemo(() => (data ? filterByRange(data.days, range) : []), [data, range])

  const overview = useMemo(() => buildOverview(filteredDays), [filteredDays])

  const selectedDay = useMemo(
    () => filteredDays.find((day) => day.date === selectedDate) ?? null,
    [filteredDays, selectedDate],
  )

  const handleSelect = useCallback((day: DailyMood) => {
    setSelectedDate((current) => (current === day.date ? null : day.date))
  }, [])

  const exportBaseName = useMemo(() => safeFileName(fileName ?? 'neurotide'), [fileName])

  /** 仅导出热力图 canvas 本身 */
  const handleExportView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    downloadCanvasPng(canvas, `${exportBaseName}-${range}.png`)
  }, [exportBaseName, range])

  /** 合成完整报告：标题 + 概览 + 热力图 + 图例 */
  const handleExportReport = useCallback(() => {
    const canvas = renderReportCanvas({
      datasetName: fileName ?? '未命名数据集',
      range,
      days: filteredDays,
      heatmap: canvasRef.current,
    })
    downloadCanvasPng(canvas, `${exportBaseName}-报告-${range}.png`)
  }, [exportBaseName, fileName, filteredDays, range])

  const handleExportCsv = useCallback(() => {
    downloadText(`${exportBaseName}-${range}.csv`, buildDailyCsv(filteredDays), 'text/csv')
  }, [exportBaseName, filteredDays, range])

  /** 导出可重新导入的 JSON 备份（内嵌原始文本） */
  const handleExportBackup = useCallback(() => {
    const text = sourceTextRef.current
    if (text === null) {
      setStorageMessage('当前数据没有可用的原始文本，无法导出备份。')
      return
    }
    const active = datasets.find((item) => item.id === activeId)
    downloadText(
      `${exportBaseName}-备份.json`,
      buildBackupJson({
        meta: {
          name: fileName ?? '未命名数据集',
          encoding,
          savedAt: active?.savedAt ?? Date.now(),
          dayCount: data?.days.length ?? 0,
          messageCount: data?.messages.length ?? 0,
        },
        text,
        report: data?.report ?? null,
        days: filteredDays,
        allDays: data?.days ?? [],
      }),
      'application/json',
    )
  }, [activeId, data, datasets, encoding, exportBaseName, fileName, filteredDays])

  const hasData = filteredDays.length > 0

  // 侧栏内容：宽屏常驻、窄屏抽屉共用同一份
  const sidebarContent = (
    <>
      <header className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="#0f172a"
            className="h-5 w-5"
          >
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

      <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-3">
        <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-slate-400">无障碍</h2>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-900/50 px-2.5 py-2">
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-slate-300">色觉辅助</span>
              <span className="block text-[10px] leading-snug text-slate-500">
                热力图加方向字形与强度条，不再只靠颜色区分
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={colorSafe}
              onChange={(event) => void handleToggleColorSafe(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-cyan-400"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-900/50 px-2.5 py-2">
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-slate-300">高对比</span>
              <span className="block text-[10px] leading-snug text-slate-500">提升文字与图表的对比度</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={highContrast}
              onChange={(event) => void handleToggleHighContrast(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-cyan-400"
            />
          </label>
        </div>
      </section>

      {mode === 'timeline' && (
        <>
          <UploadPanel
            onText={handleText}
            onLoadSample={handleLoadSample}
            fileName={fileName}
            encoding={encoding}
            report={report}
            error={error}
            progress={parseProgress}
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
                          <span className="ml-1 tabular-nums text-cyan-300">{formatScore(overview.bestDay.score)}</span>
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

          <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
            <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400">导出</h2>
            <button
              type="button"
              onClick={handleExportReport}
              disabled={!hasData}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            >
              导出完整报告 PNG
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleExportView}
                disabled={!hasData}
                className="rounded-lg border border-white/10 py-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                热力图 PNG
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={!hasData}
                className="rounded-lg border border-white/10 py-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                日粒度 CSV
              </button>
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={!hasData}
                className="rounded-lg border border-white/10 py-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                JSON 备份
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              报告图为重新绘制，含标题与概览；CSV 为当前筛选范围的日粒度数据；JSON 备份内嵌原始文本，可重新导入。
            </p>
          </section>

          <DatasetPanel
            datasets={datasets}
            activeId={activeId}
            backendLabel={backendLabel}
            backendNotice={backendNotice}
            persistEnabled={persistEnabled}
            busy={busy}
            message={storageMessage}
            onTogglePersist={handleTogglePersist}
            onLoad={handleLoadDataset}
            onDelete={handleDeleteDataset}
            onClearAll={handleClearAll}
          />

          <div className="mt-auto space-y-1.5 pt-2 text-[11px] leading-relaxed text-slate-500">
            <p>
              本地词典：积极 {DICTIONARY_SIZE.positive} 词 / 消极 {DICTIONARY_SIZE.negative} 词，每个词条带强度权重，
              并识别「不 / 没」等否定词与「非常 / 有点」等程度副词。
            </p>
            <p>单条记录分值压缩到 [-1, 1]，当日分值为该日记录分值的平均，因此切换筛选区间不会改变历史数值。</p>
            <p>解析与计算全部在浏览器完成；已保存的数据集存放在本机，可随时「清空本地数据」。</p>
          </div>
        </>
      )}
      {mode === 'screenshot' && (
        <div className="mt-auto pt-2 text-[10px] leading-relaxed text-slate-600">
          截图 OCR 完全在本地执行，不调用外部 API；词典情绪结果仅供参考。
        </div>
      )}
    </>
  )

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="flex h-screen overflow-hidden bg-slate-900 text-slate-200"
        data-contrast={highContrast ? 'high' : undefined}
      >
        {/* 宽屏常驻侧栏 */}
        <aside className="hidden h-full w-[30%] max-w-[460px] min-w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-slate-900 p-4 lg:flex">
          {sidebarContent}
        </aside>

        {/* 窄屏抽屉 */}
        <AnimatePresence>
          {panelOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="absolute inset-0 bg-slate-950/70"
                onClick={() => setPanelOpen(false)}
                aria-hidden="true"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 360, damping: 36 }}
                aria-label="控制面板"
                className="absolute inset-y-0 left-0 flex w-[88%] max-w-[420px] flex-col gap-4 overflow-y-auto border-r border-white/10 bg-slate-900 p-4 shadow-2xl"
              >
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="self-end rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10"
                >
                  收起面板
                </button>
                {sidebarContent}
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <main
          className={`relative flex h-full min-w-0 flex-1 flex-col p-4 ${mode === 'screenshot' ? 'overflow-hidden' : ''}`}
        >
          {/* 窄屏顶部条：这里才有进入控制面板的入口 */}
          <div className="mb-3 flex shrink-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-expanded={panelOpen}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/5"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              控制面板
            </button>
            <span className="truncate text-xs text-slate-500">
              {mode === 'timeline' ? (fileName ?? '未载入数据') : '聊天截图分析'}
            </span>
          </div>
          {mode === 'screenshot' ? (
            <ScreenshotMode />
          ) : (
            <>
              <div className="mb-3 flex shrink-0 items-center gap-2" role="group" aria-label="选择主视图">
                {VIEWS.map((item) => {
                  const active = item.key === view
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setView(item.key)}
                      className={`rounded-lg border px-3 py-1.5 text-left transition-colors ${
                        active
                          ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200'
                          : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      <span className="block text-xs font-medium">{item.label}</span>
                      <span className="mt-0.5 block text-[10px] opacity-70">{item.hint}</span>
                    </button>
                  )
                })}
              </div>

              <div className="relative min-h-0 flex-1">
                {/*
                热力图始终保持挂载：切到洞察视图时只做视觉隐藏（visibility 不改布局尺寸），
                这样「导出完整报告 PNG」在任一视图下都能取到热力图 canvas。
              */}
                <div className={view === 'heatmap' ? 'h-full' : 'invisible absolute inset-0'}>
                  <CalendarHeatmap
                    days={filteredDays}
                    selectedDate={selectedDate}
                    rangeLabel={RANGE_LABEL[range]}
                    canvasRef={canvasRef}
                    onSelect={handleSelect}
                    colorSafe={colorSafe}
                    highContrast={highContrast}
                  />
                </div>

                {view === 'insights' && (
                  <div className="absolute inset-0">
                    <InsightPanel
                      days={filteredDays}
                      allDays={data?.days ?? []}
                      rangeLabel={RANGE_LABEL[range]}
                      onSelect={handleSelect}
                      highContrast={highContrast}
                    />
                  </div>
                )}
              </div>

              <AnimatePresence>
                {selectedDay && <DayDetail day={selectedDay} onClose={() => setSelectedDate(null)} />}
              </AnimatePresence>
            </>
          )}
        </main>
      </div>
    </MotionConfig>
  )
}
