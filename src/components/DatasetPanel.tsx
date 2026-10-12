import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DatasetMeta } from '../utils/datasetStore'
import { formatBytes, formatRelativeTime, formatScore } from '../utils/format'

interface DatasetPanelProps {
  datasets: DatasetMeta[]
  activeId: string | null
  backendLabel: string
  /** 存储降级说明，为空表示一切正常 */
  backendNotice: string
  persistEnabled: boolean
  busy: boolean
  message: string
  onTogglePersist: (enabled: boolean) => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
}

export default function DatasetPanel({
  datasets,
  activeId,
  backendLabel,
  backendNotice,
  persistEnabled,
  busy,
  message,
  onTogglePersist,
  onLoad,
  onDelete,
  onClearAll,
}: DatasetPanelProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const totalBytes = datasets.reduce((sum, item) => sum + item.sizeBytes, 0)

  const handleDelete = useCallback(
    (id: string) => {
      if (confirmDeleteId === id) {
        setConfirmDeleteId(null)
        onDelete(id)
      } else {
        setConfirmClear(false)
        setConfirmDeleteId(id)
      }
    },
    [confirmDeleteId, onDelete],
  )

  const handleClear = useCallback(() => {
    if (confirmClear) {
      setConfirmClear(false)
      setConfirmDeleteId(null)
      onClearAll()
    } else {
      setConfirmDeleteId(null)
      setConfirmClear(true)
    }
  }, [confirmClear, onClearAll])

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-slate-400">本地数据集</h2>
        <span
          className="rounded-md border border-white/10 bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-slate-400"
          title={`存储后端：${backendLabel}`}
        >
          {backendLabel}
        </span>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-900/50 px-2.5 py-2">
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-slate-300">保存到本机</span>
          <span className="block text-[10px] leading-snug text-slate-500">关闭后导入的数据仅在当前会话可用</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={persistEnabled}
          onChange={(event) => onTogglePersist(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-cyan-400"
        />
      </label>

      {backendNotice && (
        <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
          {backendNotice}
        </p>
      )}

      {datasets.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {persistEnabled ? '导入的聊天记录会自动保存在本机浏览器中，下次打开可继续。' : '当前未保存任何数据集。'}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            <AnimatePresence initial={false}>
              {datasets.map((dataset) => {
                const active = dataset.id === activeId
                const pending = confirmDeleteId === dataset.id
                return (
                  <motion.li
                    key={dataset.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`overflow-hidden rounded-xl border ${
                      active ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-start gap-2 p-2.5">
                      <button
                        type="button"
                        onClick={() => onLoad(dataset.id)}
                        disabled={busy}
                        aria-current={active}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex items-center gap-1.5">
                          {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />}
                          <span className="truncate text-[11px] font-medium text-slate-200">{dataset.name}</span>
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-slate-500">
                          {dataset.firstDate && dataset.lastDate
                            ? `${dataset.firstDate} ~ ${dataset.lastDate}`
                            : '无有效记录'}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {dataset.dayCount} 天 / {dataset.messageCount} 条 · 均 {formatScore(dataset.averageScore)} ·{' '}
                          {formatBytes(dataset.sizeBytes)} · {formatRelativeTime(dataset.savedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(dataset.id)}
                        aria-label={pending ? `确认删除 ${dataset.name}` : `删除 ${dataset.name}`}
                        className={`shrink-0 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
                          pending
                            ? 'border-red-400/50 bg-red-500/20 text-red-200'
                            : 'border-white/10 text-slate-500 hover:border-red-400/40 hover:text-red-300'
                        }`}
                      >
                        {pending ? '确认删除' : '删除'}
                      </button>
                    </div>
                    {pending && (
                      <p className="border-t border-white/5 px-2.5 py-1.5 text-[10px] leading-snug text-red-300/90">
                        将删除该数据集的原始文本与统计结果，本机不可恢复。再点一次「确认删除」执行。
                      </p>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2.5">
            <span className="text-[10px] text-slate-500">
              共 {datasets.length} 份 · {formatBytes(totalBytes)}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                confirmClear
                  ? 'border-red-400/50 bg-red-500/20 text-red-200'
                  : 'border-white/10 text-slate-500 hover:border-red-400/40 hover:text-red-300'
              }`}
            >
              {confirmClear ? '确认清空全部' : '清空本地数据'}
            </button>
          </div>
          {confirmClear && (
            <p className="mt-1.5 rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-snug text-red-300">
              将删除本机保存的全部 {datasets.length} 份数据集（{formatBytes(totalBytes)}），
              并清空当前视图，此操作不可撤销。
            </p>
          )}
        </>
      )}

      {message && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-cyan-200"
        >
          {message}
        </p>
      )}
    </section>
  )
}
