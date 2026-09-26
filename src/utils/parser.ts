// 聊天记录 TXT 解析器 + 按天聚合
// 目标格式：[YYYY-MM-DD HH:mm:ss] 昵称: 内容

import { analyzeText, messageScore } from './sentiment'

export interface AnalyzedMessage {
  date: Date
  /** 时间戳，便于排序与定位 */
  timestamp: number
  nickname: string
  content: string
  positiveWords: string[]
  negativeWords: string[]
  /** 命中计分：+1 / -1 / 0 的累加 */
  raw: number
  /** 展示用分值 [-1, 1] */
  score: number
}

export interface DayWord {
  word: string
  count: number
  positive: boolean
}

export interface DailyMood {
  /** YYYY-MM-DD */
  date: string
  day: Date
  /** 该日命中计分总和 */
  raw: number
  /** 按天归一化后的情绪值 [-1, 1] */
  score: number
  messageCount: number
  positiveHits: number
  negativeHits: number
  /** 主导词，按出现次数降序取前 5 个 */
  topWords: DayWord[]
  messages: AnalyzedMessage[]
}

// 时间行：[2026-09-26 08:12:00] 昵称: 内容
const LINE_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\]\s*([^:：]{0,40})[:：]\s*(.*)$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// 解析 TXT 文本为消息列表；支持消息内容换行（后续行不带时间戳时并入上一条）
export function parseChatText(text: string): AnalyzedMessage[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const messages: AnalyzedMessage[] = []

  const push = (nickname: string, content: string, date: Date) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const sentiment = analyzeText(trimmed)
    messages.push({
      date,
      timestamp: date.getTime(),
      nickname,
      content: trimmed,
      positiveWords: sentiment.positiveWords,
      negativeWords: sentiment.negativeWords,
      raw: sentiment.raw,
      score: messageScore(sentiment.raw),
    })
  }

  let pending: { nickname: string; date: Date; buffer: string[] } | null = null

  for (const line of lines) {
    const matched = LINE_PATTERN.exec(line.trim())
    if (matched) {
      if (pending) push(pending.nickname, pending.buffer.join(' '), pending.date)
      const date = new Date(
        Number(matched[1]),
        Number(matched[2]) - 1,
        Number(matched[3]),
        Number(matched[4]),
        Number(matched[5]),
        Number(matched[6]),
      )
      pending = { nickname: matched[7].trim() || '未知', date, buffer: [matched[8]] }
    } else if (pending && line.trim()) {
      // 续行：并入上一条消息
      pending.buffer.push(line.trim())
    }
  }
  if (pending) push(pending.nickname, pending.buffer.join(' '), pending.date)

  messages.sort((a, b) => a.timestamp - b.timestamp)
  return messages
}

// 按天聚合，并把每日情绪值归一化到 [-1, 1]
export function aggregateByDay(messages: AnalyzedMessage[]): DailyMood[] {
  const buckets = new Map<string, AnalyzedMessage[]>()

  for (const message of messages) {
    const key = toDateKey(message.date)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(message)
    else buckets.set(key, [message])
  }

  const days: DailyMood[] = []
  for (const [key, list] of buckets) {
    const wordCounter = new Map<string, DayWord>()
    let raw = 0
    let positiveHits = 0
    let negativeHits = 0

    for (const message of list) {
      raw += message.raw
      for (const word of message.positiveWords) {
        positiveHits++
        const item = wordCounter.get(word) ?? { word, count: 0, positive: true }
        item.count++
        wordCounter.set(word, item)
      }
      for (const word of message.negativeWords) {
        negativeHits++
        const item = wordCounter.get(word) ?? { word, count: 0, positive: false }
        item.count++
        wordCounter.set(word, item)
      }
    }

    const [y, m, d] = key.split('-').map(Number)
    days.push({
      date: key,
      day: new Date(y, m - 1, d),
      raw,
      score: 0,
      messageCount: list.length,
      positiveHits,
      negativeHits,
      topWords: [...wordCounter.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      messages: list,
    })
  }

  days.sort((a, b) => a.day.getTime() - b.day.getTime())

  // 归一化：以绝对值最大的那天为 ±1
  const maxAbs = days.reduce((max, day) => Math.max(max, Math.abs(day.raw)), 0)
  for (const day of days) {
    day.score = maxAbs === 0 ? 0 : day.raw / maxAbs
  }

  return days
}

export interface ParseResult {
  days: DailyMood[]
  messages: AnalyzedMessage[]
}

// 一站式入口：文本 -> 消息 + 按天聚合
export function parseChatLog(text: string): ParseResult {
  const messages = parseChatText(text)
  return { days: aggregateByDay(messages), messages }
}

export type TimeRange = '3m' | '6m' | 'all'

export const RANGE_LABEL: Record<TimeRange, string> = {
  '3m': '近 3 月',
  '6m': '近半年',
  all: '全部',
}

// 按时间范围筛选（以数据中最新一天为基准回溯）
export function filterByRange(days: DailyMood[], range: TimeRange): DailyMood[] {
  if (range === 'all' || days.length === 0) return days

  const latest = days[days.length - 1].day
  const months = range === '3m' ? 3 : 6
  const threshold = new Date(latest.getFullYear(), latest.getMonth() - months, latest.getDate())
  const cutoff = threshold.getTime()

  const filtered = days.filter((day) => day.day.getTime() >= cutoff)
  return filtered.length > 0 ? filtered : days
}

export interface Overview {
  totalDays: number
  averageScore: number
  bestDay: DailyMood | null
  worstDay: DailyMood | null
  messageCount: number
}

// 数据概览统计
export function buildOverview(days: DailyMood[]): Overview {
  if (days.length === 0) {
    return { totalDays: 0, averageScore: 0, bestDay: null, worstDay: null, messageCount: 0 }
  }

  let sum = 0
  let best = days[0]
  let worst = days[0]
  let messageCount = 0
  for (const day of days) {
    sum += day.score
    messageCount += day.messageCount
    if (day.score > best.score) best = day
    if (day.score < worst.score) worst = day
  }

  return {
    totalDays: days.length,
    averageScore: sum / days.length,
    bestDay: best,
    worstDay: worst,
    messageCount,
  }
}