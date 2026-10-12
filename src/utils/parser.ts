// 聊天记录 TXT 解析器 + 按天聚合
//
// 相比 v1 的四处修正：
// 1. 支持 4 种常见导出格式并自动嗅探（方括号/行首时间 × 行内内容/换行内容）；
// 2. 日期做回环校验，非法日期（如 2026-02-30）不再静默进位；
// 3. 返回解析报告（格式、命中行、续行、跳过行、未识别行、非法日期）；
// 4. 当日情绪值改为绝对量纲（aggregateScore），不再随筛选区间变化。

import { aggregateScore, analyzeText, messageScore } from './sentiment'
import type { TextSpan } from './sentiment'

export interface AnalyzedMessage {
  date: Date
  /** 时间戳，便于排序与定位 */
  timestamp: number
  nickname: string
  content: string
  positiveWords: string[]
  negativeWords: string[]
  /** 命中片段（含否定前缀），用于原文高亮 */
  spans: TextSpan[]
  /** 加权计分：Σ(极性 × 生效权重) */
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
  /** 该日加权计分总和 */
  raw: number
  /** 当日情绪值 [-1, 1]：等于该日各条记录分值的平均 */
  score: number
  messageCount: number
  positiveHits: number
  negativeHits: number
  /** 主导词，按出现次数降序取前 5 个 */
  topWords: DayWord[]
  messages: AnalyzedMessage[]
}

// ---------------------------------------------------------------------------
// 格式识别
// ---------------------------------------------------------------------------

export type ChatLogFormat = 'bracket-inline' | 'plain-inline' | 'bracket-block' | 'plain-block'

export const FORMAT_LABEL: Record<ChatLogFormat, string> = {
  'bracket-inline': '[时间] 昵称: 内容',
  'plain-inline': '时间 昵称: 内容',
  'bracket-block': '[时间] 昵称 + 换行内容',
  'plain-block': '时间 昵称 + 换行内容',
}

export interface ParseReport {
  format: ChatLogFormat
  formatLabel: string
  totalLines: number
  /** 识别为记录首行的行数 */
  matchedLines: number
  /** 并入上一条记录的续行数 */
  continuationLines: number
  /** 被识别为分隔符 / 日期标题并跳过的行数 */
  skippedLines: number
  /** 既不是记录首行也不是续行的行数 */
  unmatchedLines: number
  /** 时间戳格式正确但日期非法（如 2026-02-30）的行数 */
  invalidDateLines: number
  /** 时间合法但内容为空的记录数 */
  emptyRecords: number
  /** 未识别行的样例，便于用户自查 */
  samples: string[]
}

const DATE_PART = String.raw`(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})`
const TIME_PART = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`

// 行内内容：时间戳（可带方括号）+ 昵称 + 冒号 + 内容
const RE_BRACKET_INLINE = new RegExp(`^\\[${DATE_PART}[ T]${TIME_PART}\\]\\s*([^:：]{0,40})[:：]\\s*(.*)$`)
const RE_PLAIN_INLINE = new RegExp(`^${DATE_PART}[ T]${TIME_PART}\\s+([^:：]{0,40})[:：]\\s*(.*)$`)

// 换行内容：时间戳 + 可选昵称，内容在后续行（昵称内不含冒号，借此与行内格式区分）
const RE_BRACKET_BLOCK = new RegExp(`^\\[${DATE_PART}[ T]${TIME_PART}\\]\\s*([^:：]{0,40}?)\\s*$`)
const RE_PLAIN_BLOCK = new RegExp(`^${DATE_PART}[ T]${TIME_PART}\\s*([^:：]{0,40}?)\\s*$`)

/** 纯分隔线（如 ---- 或 ====） */
const RE_SEPARATOR = /^[\s\-—=_*·•~]+$/
/** 装饰性标题行（如「=== 聊天记录导出 ===」） */
const RE_DECORATION = /^[-—=_*·•~]{3,}/
/** 仅有日期的标题行（如「2026-09-26 星期六」） */
const RE_DATE_HEADING = /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(\s+\S{1,10})?$/

// 无信息行：分隔线、装饰标题、日期标题；记录行一定以 [ 或数字开头，因此不会被误吞
function isIgnorableLine(line: string): boolean {
  return RE_SEPARATOR.test(line) || RE_DECORATION.test(line) || RE_DATE_HEADING.test(line)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// 回环校验：构造出的 Date 必须与输入的年月日时分秒完全一致，否则视为非法日期
function buildDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null
  }
  return date
}

interface RawRecord {
  nickname: string
  date: Date
  content: string
}

function matchInline(line: string): { match: RegExpExecArray; bracket: boolean } | null {
  const bracket = RE_BRACKET_INLINE.exec(line)
  if (bracket) return { match: bracket, bracket: true }
  const plain = RE_PLAIN_INLINE.exec(line)
  if (plain) return { match: plain, bracket: false }
  return null
}

function matchBlock(line: string): { match: RegExpExecArray; bracket: boolean } | null {
  const bracket = RE_BRACKET_BLOCK.exec(line)
  if (bracket) return { match: bracket, bracket: true }
  const plain = RE_PLAIN_BLOCK.exec(line)
  if (plain) return { match: plain, bracket: false }
  return null
}

function pickDate(match: RegExpExecArray, hasSeconds: boolean): Date | null {
  const second = hasSeconds ? Number(match[6]) : 0
  return buildDate(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), second)
}

// 「时间戳后跟的短文本」到底是昵称还是内容：过长或含句读则判为内容
function looksLikeContent(text: string): boolean {
  return text.length >= 10 || /[。！？…～~!?]/.test(text)
}

// 嗅探格式：统计每种模式命中的行数，取最高者
function detectFormat(lines: string[]): ChatLogFormat {
  const order: ChatLogFormat[] = ['bracket-inline', 'plain-inline', 'bracket-block', 'plain-block']
  const counts: Record<ChatLogFormat, number> = {
    'bracket-inline': 0,
    'plain-inline': 0,
    'bracket-block': 0,
    'plain-block': 0,
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || isIgnorableLine(line)) continue
    const inline = matchInline(line)
    if (inline) {
      counts[inline.bracket ? 'bracket-inline' : 'plain-inline']++
      continue
    }
    const block = matchBlock(line)
    if (block) counts[block.bracket ? 'bracket-block' : 'plain-block']++
  }

  let best: ChatLogFormat = 'bracket-inline'
  for (const key of order) {
    if (counts[key] > counts[best]) best = key
  }
  return best
}

export interface ParsedChatLog {
  messages: AnalyzedMessage[]
  report: ParseReport
}

// 解析 TXT 文本为消息列表；支持消息内容换行（后续行不带时间戳时并入上一条）
/** 换行内容模式下待收尾的一条记录 */
interface PendingRecord {
  nickname: string
  date: Date
  buffer: string[]
}

/**
 * 一次解析的会话。把「逐行处理」从一次性的函数里抽出来，是为了让同一套逻辑
 * 既能一次跑完（同步），也能分片跑、片间让出主线程（异步），避免两条实现慢慢分叉。
 */
interface ParseSession {
  total: number
  /** 处理 [from, to) 行；分片调用顺序不变则结果与一次跑完完全一致 */
  processRange(from: number, to: number): void
  /** 收尾：补最后一条记录并按时间排序 */
  finish(): ParsedChatLog
}

function createParseSession(text: string): ParseSession {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const format = detectFormat(lines)
  const inline = format.endsWith('inline')

  const messages: AnalyzedMessage[] = []
  const report: ParseReport = {
    format,
    formatLabel: FORMAT_LABEL[format],
    totalLines: lines.length,
    matchedLines: 0,
    continuationLines: 0,
    skippedLines: 0,
    unmatchedLines: 0,
    invalidDateLines: 0,
    emptyRecords: 0,
    samples: [],
  }

  const push = (record: RawRecord) => {
    let nickname = record.nickname.trim() || '未知'
    let content = record.content.trim()

    // 换行内容模式下，若内容为空而尾部文本更像内容，则把它当成内容
    if (!content && !inline && looksLikeContent(nickname)) {
      content = nickname
      nickname = '未知'
    }
    if (!content) {
      report.emptyRecords++
      return
    }

    const sentiment = analyzeText(content)
    messages.push({
      date: record.date,
      timestamp: record.date.getTime(),
      nickname,
      content,
      positiveWords: sentiment.positiveWords,
      negativeWords: sentiment.negativeWords,
      spans: sentiment.hits.map((hit) => ({ start: hit.start, end: hit.end, polarity: hit.polarity })),
      raw: sentiment.raw,
      score: messageScore(sentiment.raw),
    })
  }

  // 可变状态放进对象：闭包里的 `let` 变量会被 TS 的流分析收窄，跨函数赋值很难写对
  const state: { pending: PendingRecord | null } = { pending: null }

  const processLine = (raw: string) => {
    const line = raw.trim()

    if (!line || isIgnorableLine(line)) {
      if (line) report.skippedLines++
      return
    }

    const found = inline ? matchInline(line) : matchBlock(line)
    if (found) {
      const { match } = found
      const date = pickDate(match, match[6] !== undefined)
      if (!date) {
        report.invalidDateLines++
        return
      }
      const previous = state.pending
      if (previous) push({ nickname: previous.nickname, date: previous.date, content: previous.buffer.join(' ') })
      report.matchedLines++
      state.pending = {
        nickname: match[7] ?? '',
        date,
        buffer: inline ? [match[8] ?? ''] : [],
      }
      return
    }

    const pending = state.pending
    if (pending) {
      pending.buffer.push(line)
      report.continuationLines++
    } else {
      report.unmatchedLines++
      if (report.samples.length < 3) report.samples.push(line.slice(0, 60))
    }
  }

  return {
    total: lines.length,
    processRange(from, to) {
      const end = Math.min(lines.length, to)
      for (let index = Math.max(0, from); index < end; index++) processLine(lines[index])
    },
    finish() {
      const pending = state.pending
      if (pending) push({ nickname: pending.nickname, date: pending.date, content: pending.buffer.join(' ') })
      messages.sort((a, b) => a.timestamp - b.timestamp)
      return { messages, report }
    },
  }
}

export function parseChatTextWithReport(text: string): ParsedChatLog {
  const session = createParseSession(text)
  session.processRange(0, session.total)
  return session.finish()
}

/** 分片解析时每片处理的行数。实测约 23ms/片，低于 50ms 的长任务阈值。 */
export const PARSE_CHUNK_LINES = 4000

/** 超过该行数才值得分片：分片有让出开销，小文件同步跑更快。约 0.7 MB / 120ms。 */
export const CHUNK_THRESHOLD_LINES = 20_000

/**
 * 「值得分片」的字符数门槛，与 `CHUNK_THRESHOLD_LINES` 是同一件事的两种量法
 * （一行约 40 字符，2 万行 ≈ 80 万字符）。调用方用字符数判据可以免去一次全量 split。
 */
export const CHUNK_THRESHOLD_CHARS = 800_000

export interface ParseChunkOptions {
  /** 每片处理多少行 */
  chunkLines?: number
  /** 进度回调；进入循环前会先报一次 0，便于界面立刻出反馈 */
  onProgress?: (progress: { processed: number; total: number }) => void
  /** 中断信号，abort 后抛 AbortError */
  signal?: AbortSignal
  /** 让出主线程的实现，测试可注入同步版本 */
  yieldToMain?: () => Promise<void>
}

/**
 * 让出主线程一拍，给浏览器与 React 渲染的机会。
 *
 * ⚠️ 不要改成 `scheduler.yield()`：它把续行排成 user-blocking 优先级，而 React 的渲染调度是
 * normal 优先级，连续让出时渲染任务会被一直插队 —— 实测表现为解析全程进度条一次都不出现
 * （`setParseProgress(0)` 与收尾的 `setParseProgress(null)` 被合并成同一次渲染）。
 * 宏任务（setTimeout）能让 React 的 MessageChannel 调度先跑，渲染才会真的发生。
 */
function defaultYieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 分片解析：与 `parseChatTextWithReport` 共用 `createParseSession`，
 * 只是把行切成多片、片间 await 让出主线程，使超大文件导入时界面不冻结、可显示进度。
 * 分片只改变「何时执行」，不改变处理顺序，因此结果与同步版逐字段一致。
 */
export async function parseChatTextWithReportAsync(
  text: string,
  options: ParseChunkOptions = {},
): Promise<ParsedChatLog> {
  const { chunkLines = PARSE_CHUNK_LINES, onProgress, signal, yieldToMain = defaultYieldToMain } = options
  const session = createParseSession(text)
  const size = Number.isFinite(chunkLines) ? Math.max(1, Math.trunc(chunkLines)) : PARSE_CHUNK_LINES

  onProgress?.({ processed: 0, total: session.total })
  for (let from = 0; from < session.total; from += size) {
    if (signal?.aborted) throw new DOMException('解析已取消', 'AbortError')
    const to = Math.min(from + size, session.total)
    session.processRange(from, to)
    onProgress?.({ processed: to, total: session.total })
    if (to < session.total) await yieldToMain()
  }
  return session.finish()
}

/** 兼容旧签名：只取消息列表 */
export function parseChatText(text: string): AnalyzedMessage[] {
  return parseChatTextWithReport(text).messages
}

// ---------------------------------------------------------------------------
// 按天聚合
// ---------------------------------------------------------------------------

// 按天聚合；当日情绪值 = 该日各条记录分值（已压缩到 [-1, 1]）的平均
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
      score: aggregateScore(list.map((message) => message.raw)),
      messageCount: list.length,
      positiveHits,
      negativeHits,
      topWords: [...wordCounter.values()].toSorted((a, b) => b.count - a.count).slice(0, 5),
      messages: list,
    })
  }

  days.sort((a, b) => a.day.getTime() - b.day.getTime())
  return days
}

export interface ParseResult {
  days: DailyMood[]
  messages: AnalyzedMessage[]
  report: ParseReport
}

// 一站式入口：文本 -> 消息 + 按天聚合 + 解析报告
export function parseChatLog(text: string): ParseResult {
  const { messages, report } = parseChatTextWithReport(text)
  return { days: aggregateByDay(messages), messages, report }
}

// 一站式入口（分片版）：超大文本用它导入，主线程保持可响应并能上报进度
export async function parseChatLogAsync(text: string, options: ParseChunkOptions = {}): Promise<ParseResult> {
  const { messages, report } = await parseChatTextWithReportAsync(text, options)
  return { days: aggregateByDay(messages), messages, report }
}

export type TimeRange = '3m' | '6m' | 'all'

export const RANGE_LABEL: Record<TimeRange, string> = {
  '3m': '近 3 月',
  '6m': '近半年',
  all: '全部',
}

// 月份平移：按目标月的实际天数收口，避免 31 号回溯到 30 天月份时溢出到下月初
function shiftMonths(date: Date, months: number): Date {
  const year = date.getFullYear()
  const monthIndex = date.getMonth() + months
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(date.getDate(), lastDay))
}

// 按时间范围筛选（以数据中最新一天为基准回溯）
export function filterByRange(days: DailyMood[], range: TimeRange): DailyMood[] {
  if (range === 'all' || days.length === 0) return days

  const latest = days[days.length - 1].day
  const months = range === '3m' ? 3 : 6
  const cutoff = shiftMonths(latest, -months).getTime()

  return days.filter((day) => day.day.getTime() >= cutoff)
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
