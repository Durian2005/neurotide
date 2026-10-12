// 日期与数值格式化工具

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 2026年9月26日
export function formatFullDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

// 2026-09-26 08:12
export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

// 09-26
export function formatShortDate(date: Date): string {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// 情绪值带符号显示：+0.42 / -0.18 / 0.00
export function formatScore(score: number): string {
  const fixed = score.toFixed(2)
  return score > 0 ? `+${fixed}` : fixed
}

// 文件大小：512 B / 1.4 KB / 12 MB
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

// 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前，超过 30 天回退为日期
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp
  if (!Number.isFinite(timestamp)) return '—'
  if (diff < 0) return '刚刚'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days <= 30) return `${days} 天前`
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
