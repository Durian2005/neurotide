import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { motion } from 'framer-motion'

interface UploadPanelProps {
  /** 读取到 TXT 文本后回调（文件不离本机，无任何网络请求） */
  onText: (text: string, fileName: string) => void
  onLoadSample: () => void
  fileName: string | null
  error: string
}

export default function UploadPanel({ onText, onLoadSample, fileName, error }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      setReading(true)
      try {
        const text = await file.text()
        onText(text, file.name)
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
        </motion.svg>

        <p className="mt-2 text-sm font-medium text-slate-200">
          {reading ? '正在解析…' : dragging ? '松开即可导入' : '拖拽 TXT 到此处'}
        </p>
        <p className="mt-1 text-xs text-slate-500">或点击选择文件</p>
      </motion.div>

      <input ref={inputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleChange} />

      <button
        type="button"
        onClick={onLoadSample}
        className="mt-3 w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/20"
      >
        载入示例数据体验
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        格式：<span className="text-slate-400">[YYYY-MM-DD HH:mm:ss] 昵称: 内容</span>
      </p>

      {fileName && (
        <p className="mt-2 truncate rounded-lg bg-slate-900/60 px-2.5 py-1.5 text-[11px] text-slate-400">
          已加载：<span className="text-slate-300">{fileName}</span>
        </p>
      )}

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300"
        >
          {error}
        </motion.p>
      )}
    </section>
  )
}