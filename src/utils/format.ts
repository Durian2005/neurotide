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