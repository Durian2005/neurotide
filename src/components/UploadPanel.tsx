import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { readTextFile } from '../utils/textEncoding'
import type { ParseReport } from '../utils/parser'

/** 超过该大小给出耗时提醒 */
const LARGE_FILE_BYTES = 5 * 1024 * 1024
/** 超过该大小直接拒绝，避免浏览器长时间无响应 */
const MAX_FILE_BYTES = 20 * 1024 * 1024

interface UploadPanelProps {
  /** 读取到 TXT 文本后回调（文件不离本机，无任何网络请求） */
  onText: (text: string, fileName: string, encoding: string) => void | Promise<void>
  onLoadSample: () => void
  fileName: string | null
  encoding: string
  report: ParseReport | null
  error: string
  /** 分片解析进度 0–1；小文件同步解析时为 null */
  progress: number | null
}

export default function UploadPanel({
  onText,
  onLoadSample,
  fileName,
  encoding,
  report,
  error,
  progress,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  const percent = progress === null ? 0 : Math.max(0, Math.min(100, Math.round(progress * 100)))

  const handleFile = useCallback(
    async (file: File) => {
      setNotice('')
      if (file.size > MAX_FILE_BYTES) {
        setNotice(`文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB，请先按时间段拆分后再导入。`)
        return
      }
      if (file.size > LARGE_FILE_BYTES) {
        setNotice('文件较大，将分片解析并显示进度。')
      }
      setReading(true)
      try {
        const decoded = await readTextFile(file)
        // 等待上层完成解析与本地保存，避免「正在解析…」提前消失
        await onText(decoded.text, file.name, decoded.encoding)
      } catch {
        setNotice('文件读取失败，请确认文件未被其他程序占用。')
      } finally {
        setReading(false)
      }
    },
    [onText],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) void handleFile(file)
      event.target.value = ''
    },
    [handleFile],
  )

  const openPicker = useCallback(() => inputRef.current?.click(), [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openPicker()
      }
    },
    [openPicker],
  )

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400">数据导入</h2>

      <motion.div
        role="button"
        tabIndex={0}
        aria-label="上传聊天记录 TXT 文件"
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        animate={{
          scale: dragging ? 1.02 : 1,
          borderColor: dragging ? 'rgba(34,211,238,0.8)' : 'rgba(148,163,184,0.25)',
          backgroundColor: dragging ? 'rgba(34,211,238,0.08)' : 'rgba(15,23,42,0.5)',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.6}
          stroke="currentColor"
          className="h-7 w-7 text-cyan-300"
          animate={{ y: dragging ? -4 : 0, color: dragging ? '#22d3ee' : '#67e8f9' }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V9m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
          />
        </motion.svg>

        <p className="mt-2 text-sm font-medium text-slate-200">
          {reading
            ? progress === null
              ? '正在解析…'
              : `正在解析… ${percent}%`
            : dragging
              ? '松开即可导入'
              : '拖拽 TXT 到此处'}
        </p>
        <p className="mt-1 text-xs text-slate-500">或点击选择文件</p>

        {reading && progress !== null && (
          <div
            role="progressbar"
            aria-label="解析进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-slate-700/60"
          >
            <div
              className="h-full rounded-full bg-cyan-400 transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </motion.div>

      <input
        ref={inputRef}
        type="file"
        accept=".txt,.log,.md,.json,text/plain,application/json"
        className="hidden"
        onChange={handleChange}
      />

      <button
        type="button"
        onClick={onLoadSample}
        className="mt-3 w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/20"
      >
        载入示例数据体验
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        支持 <span className="text-slate-400">[时间] 昵称: 内容</span>、
        <span className="text-slate-400">时间 昵称: 内容</span>， 以及「时间行 + 换行内容」；自动识别 UTF-8 / UTF-16 /
        GBK 编码。也可直接导入本应用导出的 <span className="text-slate-400">JSON 备份</span> 还原数据。
      </p>

      {fileName && (
        <p className="mt-2 truncate rounded-lg bg-slate-900/60 px-2.5 py-1.5 text-[11px] text-slate-400">
          已加载：<span className="text-slate-300">{fileName}</span>
        </p>
      )}

      {report && report.matchedLines > 0 && (
        <dl className="mt-2 space-y-1 rounded-lg border border-white/10 bg-slate-900/50 px-2.5 py-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">识别格式</dt>
            <dd className="truncate text-slate-300">{report.formatLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">文本编码</dt>
            <dd className="text-slate-300">{encoding || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">记录 / 续行</dt>
            <dd className="tabular-nums text-slate-300">
              {report.matchedLines} 条 / {report.continuationLines} 行
            </dd>
          </div>
          {report.skippedLines > 0 && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">分隔行已跳过</dt>
              <dd className="tabular-nums text-slate-400">{report.skippedLines} 行</dd>
            </div>
          )}
        </dl>
      )}

      {(report?.invalidDateLines ?? 0) > 0 && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200"
        >
          有 {report?.invalidDateLines} 行日期不合法（例如 2 月 30 日），已跳过且不会计入统计。
        </p>
      )}

      {(report?.unmatchedLines ?? 0) > 0 && (
        <div
          role="status"
          className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200"
        >
          <p>有 {report?.unmatchedLines} 行未能识别为记录，未计入统计。</p>
          {report && report.samples.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-amber-200/70">
              {report.samples.map((sample) => (
                <li key={sample} className="truncate" title={sample}>
                  · {sample}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notice && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-cyan-200"
        >
          {notice}
        </p>
      )}

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-300"
        >
          {error}
        </motion.p>
      )}
    </section>
  )
}
