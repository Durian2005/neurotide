import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { analyzeScreenshotText } from '../utils/sentiment'
import type { ScreenshotSentiment } from '../utils/sentiment'
import { recognizeChineseScreenshot } from '../utils/ocr'
import type { OcrProgress } from '../utils/ocr'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function scoreLabel(label: ScreenshotSentiment['label']): string {
  if (label === 'positive') return '整体偏积极'
  if (label === 'negative') return '整体偏消极'
  return '整体中性'
}

function wordFrequency(words: string[]): Array<{ word: string; count: number }> {
  const counter = new Map<string, number>()
  for (const word of words) counter.set(word, (counter.get(word) ?? 0) + 1)
  return [...counter.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}

export default function ScreenshotMode() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const result = useMemo(() => (text.trim() ? analyzeScreenshotText(text) : null), [text])
  const positiveWords = useMemo(() => wordFrequency(result?.positiveWords ?? []), [result])
  const negativeWords = useMemo(() => wordFrequency(result?.negativeWords ?? []), [result])

  const chooseImage = (file: File) => {
    setError('')
    setNotice('')
    setText('')
    setProgress(null)
    if (!file.type.startsWith('image/')) {
      setError('请选择 PNG、JPG 或 WebP 图片。')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('图片不能超过 12 MB。可先裁剪或压缩后再试。')
      return
    }
    setImage(file)
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(file)
    })
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) chooseImage(file)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) chooseImage(file)
  }

  const runRecognition = async () => {
    if (!image || busy) return
    setBusy(true)
    setText('')
    setError('')
    setProgress({ status: '启动本地 OCR', progress: 0 })
    try {
      const recognized = await recognizeChineseScreenshot(image, setProgress)
      setText(recognized)
      if (!recognized.trim()) {
        setNotice('未识别到文字。可以换一张更清晰、文字更大的截图后重试。')
      } else {
        setNotice('识别完成。请先校对文字；下方分析仅依据当前截图中的识别结果。')
      }
    } catch (cause) {
      console.error('Local screenshot OCR failed', cause)
      setError('本地识别失败。请使用本地预览服务打开页面，并确认项目中的 OCR 资源完整。')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setImage(null)
    setText('')
    setProgress(null)
    setError('')
    setNotice('')
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
  }

  const statClass = result?.label === 'positive'
    ? 'text-cyan-300'
    : result?.label === 'negative'
      ? 'text-blue-300'
      : 'text-slate-200'

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300/80">单张图片 · 本地 OCR</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">聊天截图分析</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            只识别当前选择的截图，不导入日期或坐标，也不调用外部 API。首次加载本地识别引擎和中文模型需要一点时间。
          </p>
        </div>
        {image && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            清除当前图片
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(240px,0.85fr)_minmax(360px,1.15fr)]">
        <div className="flex min-h-[300px] flex-col gap-3 rounded-2xl border border-white/10 bg-slate-800/35 p-4">
          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-label="选择聊天截图"
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(event) => {
              if (!busy && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`relative flex min-h-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
              dragging ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/15 bg-slate-950/40 hover:border-cyan-400/50'
            } ${busy ? 'cursor-wait opacity-75' : ''}`}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="当前待分析的聊天截图" className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="px-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2.5M12 15V4m0 0L8 8m4-4 4 4M4 14v2.5M20 14v2.5" />
                  </svg>
                </div>
                <p className="mt-4 text-sm font-medium text-slate-200">拖入截图，或点击选择</p>
                <p className="mt-1 text-xs text-slate-500">PNG / JPG / WebP · 最大 12 MB</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleChange}
              disabled={busy}
            />
          </div>
          {image && (
            <p className="truncate text-[11px] text-slate-500" title={image.name}>
              当前图片：<span className="text-slate-300">{image.name}</span> · {(image.size / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
          <button
            type="button"
            onClick={() => void runRecognition()}
            disabled={!image || busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/25 border-t-slate-900" />}
            {busy ? '正在本地识别…' : text ? '重新识别当前截图' : '识别并分析当前截图'}
          </button>
          {busy && progress && (
            <div aria-live="polite" className="space-y-1.5">
              <div className="flex justify-between gap-3 text-[11px] text-slate-400">
                <span>{progress.status}</span>
                <span>{Math.round(progress.progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                <motion.div
                  className="h-full rounded-full bg-cyan-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-slate-500">
            图片仅在当前浏览器内存中处理，不会上传。OCR 会尽量读取可见文字；模糊、遮挡或界面元素可能导致误识别。
          </p>
        </div>

        <div className="flex min-h-[400px] flex-col gap-3">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex min-h-0 flex-1 flex-col gap-3"
              >
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-white/10 bg-slate-800/50 p-3">
                    <p className="text-[10px] text-slate-500">截图文本长度</p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-slate-100">{result.text.length}<span className="ml-1 text-[10px] font-normal text-slate-500">字</span></p>
                  </div>
                  <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-3">
                    <p className="text-[10px] text-slate-500">积极词命中</p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-cyan-300">{result.positiveHitCount}<span className="ml-1 text-[10px] font-normal text-slate-500">次</span></p>
                  </div>
                  <div className="rounded-xl border border-blue-300/15 bg-blue-300/5 p-3">
                    <p className="text-[10px] text-slate-500">消极词命中</p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-blue-300">{result.negativeHitCount}<span className="ml-1 text-[10px] font-normal text-slate-500">次</span></p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-200">当前截图的词典情绪概览</h3>
                    <span className={`text-xs font-semibold ${statClass}`}>{scoreLabel(result.label)} · {result.score >= 0 ? '+' : ''}{result.score.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">这是基于本地情绪词典的文本统计，不是对聊天对象或心理状态的诊断。</p>
                  {(positiveWords.length > 0 || negativeWords.length > 0) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {positiveWords.map(({ word, count }) => (
                        <span key={`p-${word}`} className="rounded-lg border border-cyan-300/15 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-200">{word}{count > 1 ? ` ×${count}` : ''}</span>
                      ))}
                      {negativeWords.map(({ word, count }) => (
                        <span key={`n-${word}`} className="rounded-lg border border-blue-300/15 bg-blue-300/10 px-2 py-1 text-[11px] text-blue-200">{word}{count > 1 ? ` ×${count}` : ''}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">当前截图文本中没有命中内置情绪词典。</p>
                  )}
                </div>

                <label className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-slate-800/40 p-4">
                  <span className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-slate-300">
                    OCR 识别文本（可校对）
                    <span className="text-[10px] font-normal text-slate-500">修改后分析自动更新</span>
                  </span>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    aria-label="OCR 识别文本，可编辑校对"
                    className="min-h-[160px] flex-1 resize-y rounded-xl border border-white/10 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10"
                    placeholder="识别出的聊天文字会显示在这里。可以先修正误识别，再查看更新后的结果。"
                  />
                </label>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-white/10 bg-slate-800/20 px-6 text-center"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-800/70 text-slate-500">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2M4 17v2a1 1 0 0 0 1 1h2m10 0h2a1 1 0 0 0 1-1v-2M7 9h10M7 12h7m-7 3h9" />
                  </svg>
                </div>
                <h3 className="mt-4 text-sm font-medium text-slate-300">识别结果会显示在这里</h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">选择一张聊天截图后点击“识别并分析当前截图”。此模式只处理该图片，不依赖已有 TXT 或日历数据。</p>
              </motion.div>
            )}
          </AnimatePresence>
          {(error || notice) && (
            <div
              role={error ? 'alert' : 'status'}
              aria-live={error ? 'assertive' : 'polite'}
              className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${error ? 'border-red-400/20 bg-red-400/5 text-red-300' : 'border-cyan-300/15 bg-cyan-300/5 text-slate-300'}`}
            >
              {error || notice}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
