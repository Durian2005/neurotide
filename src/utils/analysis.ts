// 分析深度：趋势、连续区间、星期×时段分布、区间对比、词云。
//
// 全部为纯函数（不触碰 DOM），因此可被单元测试完整覆盖；
// 渲染在 components/InsightPanel.tsx 及其子组件里。
//
// 三个定义需要先说清，否则数字会被误读：
// 1. 稠密序列（buildDenseSeries）会把没有记录的日子补成 score=null。
//    统计时 null 既不参与均值也不当作 0，因此「不聊天」不会被算成「心情中性」。
// 2. 滚动均值按「日历窗口」滑窗，窗口内只看有记录的天，窗口内全无记录则为 null。
//    这样 7 日均线表示的是「这一周里记录下来的情绪的平均」，而不是被空白日稀释过的值。
// 3. 连续天数按「日历相邻」判定：相邻两个低落日之间必须正好差 1 天，缺一天即断链。
//    这是最严格也最不容易自欺的口径——中间断更说明那几天没有记录，而不是情绪好转。

import { NEUTRAL_BAND } from './sentiment'
import { toDateKey } from './parser'
import type { AnalyzedMessage, DailyMood } from './parser'

/** 滑动平均默认窗口（天） */
export const DEFAULT_ROLLING_WINDOW = 7
/** 每天斜率绝对值小于此值视为「持平」（约合每 30 天 0.06） */
export const FLAT_SLOPE = 0.002
/** 单元格参与「最好/最差」评选所需的最少记录数，避免 1 条记录就下结论 */
export const MIN_CELL_SAMPLES = 3
/** 稠密序列上限：跨度超过该值（多半是年份写错）时退回稀疏序列 */
const MAX_DENSE_DAYS = 4000
const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function shiftDays(timestamp: number, days: number): Date {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/* -------------------------------------------------------------------------- */
/* 稠密序列与滚动均值                                                          */
/* -------------------------------------------------------------------------- */

export interface SeriesPoint {
  /** YYYY-MM-DD */
  date: string
  day: Date
  /** null 表示当日无记录 */
  score: number | null
  messageCount: number
}

/** 把稀疏的日数据补成连续的日历序列，缺口处 score=null */
export function buildDenseSeries(days: DailyMood[]): SeriesPoint[] {
  if (days.length === 0) return []

  const byDate = new Map(days.map((day) => [day.date, day]))
  const start = startOfDay(days[0].day)
  const end = startOfDay(days[days.length - 1].day)
  const span = Math.round((end - start) / DAY_MS) + 1

  if (span > MAX_DENSE_DAYS) {
    return days.map((day) => ({
      date: day.date,
      day: new Date(day.day),
      score: day.score,
      messageCount: day.messageCount,
    }))
  }

  const series: SeriesPoint[] = []
  for (let offset = 0; offset < span; offset++) {
    const cursor = shiftDays(start, offset)
    const key = toDateKey(cursor)
    const found = byDate.get(key)
    series.push({
      date: key,
      day: cursor,
      score: found ? found.score : null,
      messageCount: found ? found.messageCount : 0,
    })
  }
  return series
}

/** 滚动均值；窗口内无任何记录时为 null（不把空白日当 0） */
export function rollingMean(series: SeriesPoint[], window = DEFAULT_ROLLING_WINDOW): Array<number | null> {
  const size = Math.max(1, Math.floor(window))
  const result: Array<number | null> = []
  const queue: Array<number | null> = []
  let sum = 0
  let count = 0

  for (const point of series) {
    queue.push(point.score)
    if (typeof point.score === 'number') {
      sum += point.score
      count++
    }
    if (queue.length > size) {
      const dropped = queue.shift()
      if (typeof dropped === 'number') {
        sum -= dropped
        count--
      }
    }
    result.push(count > 0 ? sum / count : null)
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* 趋势（最小二乘）                                                            */
/* -------------------------------------------------------------------------- */

export interface TrendResult {
  /** 每天的变化量（情绪值单位） */
  slopePerDay: number
  /** 折算成 30 天的变化量，便于阅读 */
  slopePer30Days: number
  /** 拟合线在 x=0（区间首日）处的取值 */
  intercept: number
  /** 区间内有记录的第一天 / 最后一天的日值 */
  first: number | null
  last: number | null
  /** 参与拟合的点数 */
  points: number
  direction: 'up' | 'down' | 'flat'
}

/** 拟合线在任意一天（距首日天数）处的取值 */
export function trendAt(trend: TrendResult, dayIndex: number): number {
  return trend.intercept + trend.slopePerDay * dayIndex
}

/** 对稠密序列做最小二乘线性拟合，x 取「距首日的天数」 */
export function linearTrend(series: SeriesPoint[]): TrendResult {
  const xs: number[] = []
  const ys: number[] = []
  series.forEach((point, index) => {
    if (typeof point.score === 'number') {
      xs.push(index)
      ys.push(point.score)
    }
  })

  const n = xs.length
  if (n === 0) {
    return { slopePerDay: 0, slopePer30Days: 0, intercept: 0, first: null, last: null, points: 0, direction: 'flat' }
  }
  if (n === 1) {
    return {
      slopePerDay: 0,
      slopePer30Days: 0,
      intercept: ys[0],
      first: ys[0],
      last: ys[0],
      points: 1,
      direction: 'flat',
    }
  }

  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += xs[i]
    sumY += ys[i]
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    numerator += dx * (ys[i] - meanY)
    denominator += dx * dx
  }

  const slope = denominator === 0 ? 0 : numerator / denominator
  return {
    slopePerDay: slope,
    slopePer30Days: slope * 30,
    intercept: meanY - slope * meanX,
    first: ys[0],
    last: ys[n - 1],
    points: n,
    direction: slope > FLAT_SLOPE ? 'up' : slope < -FLAT_SLOPE ? 'down' : 'flat',
  }
}

/* -------------------------------------------------------------------------- */
/* 连续区间                                                                    */
/* -------------------------------------------------------------------------- */

export interface StreakRun {
  /** 连续天数 */
  length: number
  /** 起止日期 YYYY-MM-DD */
  start: string
  end: string
}

export interface StreakInfo {
  longest: StreakRun | null
  /** 截至最后一个记录日仍在延续的区间 */
  current: StreakRun | null
}

/** 找出满足条件、且日期日历相邻的最长连续段 */
function collectRuns(days: DailyMood[], isHit: (day: DailyMood) => boolean): StreakRun[] {
  const runs: StreakRun[] = []
  let buffer: DailyMood[] = []
  let previousTime = 0

  const flush = () => {
    if (buffer.length === 0) return
    runs.push({ length: buffer.length, start: buffer[0].date, end: buffer[buffer.length - 1].date })
    buffer = []
  }

  for (const day of days) {
    const time = startOfDay(day.day)
    if (!isHit(day)) {
      flush()
      previousTime = time
      continue
    }
    // 与上一段是否日历相邻；缺一天即断链
    const adjacent = buffer.length > 0 && Math.round((time - previousTime) / DAY_MS) === 1
    if (buffer.length > 0 && !adjacent) flush()
    buffer.push(day)
    previousTime = time
  }
  flush()
  return runs
}

function pickStreak(runs: StreakRun[], lastDate: string | null): StreakInfo {
  if (runs.length === 0) return { longest: null, current: null }
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best))
  const last = runs[runs.length - 1]
  return { longest, current: lastDate !== null && last.end === lastDate ? last : null }
}

export interface StreakAnalysis {
  /** 连续低落（score ≤ -中性带） */
  low: StreakInfo
  /** 连续积极（score ≥ 中性带） */
  positive: StreakInfo
}

/** 连续低落 / 连续积极区间；按日历相邻判定，缺记录日会断开 */
export function analyzeStreaks(days: DailyMood[], band = NEUTRAL_BAND): StreakAnalysis {
  const lastDate = days.length > 0 ? days[days.length - 1].date : null
  return {
    low: pickStreak(
      collectRuns(days, (day) => day.score <= -band),
      lastDate,
    ),
    positive: pickStreak(
      collectRuns(days, (day) => day.score >= band),
      lastDate,
    ),
  }
}

/* -------------------------------------------------------------------------- */
/* 星期 × 时段分布                                                             */
/* -------------------------------------------------------------------------- */

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
/** 每 4 小时一个时段，共 6 段（00–04 / 04–08 / … / 20–24） */
export const HOUR_BAND_SIZE = 4
export const HOUR_BANDS = 6
export const HOUR_BAND_LABELS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'] as const

export interface HourCell {
  count: number
  /** 该单元格内所有记录分值的平均 */
  score: number
  positive: number
  negative: number
}

export interface CellRef {
  weekday: number
  band: number
  cell: HourCell
}

export interface WeekdayHourMatrix {
  /** grid[weekday][band]，无记录为 null */
  grid: Array<Array<HourCell | null>>
  maxCount: number
  totalCount: number
  /** 均分最高 / 最低的格子（要求至少 MIN_CELL_SAMPLES 条记录） */
  best: CellRef | null
  worst: CellRef | null
}

/** 按「星期几 × 当天时段」聚合记录，颜色看均分、数字看条数 */
export function buildWeekdayHourMatrix(messages: AnalyzedMessage[], band = NEUTRAL_BAND): WeekdayHourMatrix {
  const counts: number[][] = Array.from({ length: 7 }, () => Array.from({ length: HOUR_BANDS }, () => 0))
  const sums: number[][] = Array.from({ length: 7 }, () => Array.from({ length: HOUR_BANDS }, () => 0))
  const positives: number[][] = Array.from({ length: 7 }, () => Array.from({ length: HOUR_BANDS }, () => 0))
  const negatives: number[][] = Array.from({ length: 7 }, () => Array.from({ length: HOUR_BANDS }, () => 0))

  for (const message of messages) {
    // getDay(): 0=周日；此表按「周一为第一行」排列，与日历热力图一致
    const weekday = (message.date.getDay() + 6) % 7
    const slot = Math.min(HOUR_BANDS - 1, Math.floor(message.date.getHours() / HOUR_BAND_SIZE))
    counts[weekday][slot]++
    sums[weekday][slot] += message.score
    if (message.score >= band) positives[weekday][slot]++
    else if (message.score <= -band) negatives[weekday][slot]++
  }

  const grid: Array<Array<HourCell | null>> = Array.from({ length: 7 }, () =>
    Array.from({ length: HOUR_BANDS }, () => null),
  )
  let maxCount = 0
  let totalCount = 0
  let best: CellRef | null = null
  let worst: CellRef | null = null

  for (let weekday = 0; weekday < 7; weekday++) {
    for (let slot = 0; slot < HOUR_BANDS; slot++) {
      const count = counts[weekday][slot]
      totalCount += count
      if (count > maxCount) maxCount = count
      if (count === 0) continue
      const cell: HourCell = {
        count,
        score: sums[weekday][slot] / count,
        positive: positives[weekday][slot],
        negative: negatives[weekday][slot],
      }
      grid[weekday][slot] = cell
      if (count >= MIN_CELL_SAMPLES) {
        if (!best || cell.score > best.cell.score) best = { weekday, band: slot, cell }
        if (!worst || cell.score < worst.cell.score) worst = { weekday, band: slot, cell }
      }
    }
  }

  return { grid, maxCount, totalCount, best, worst }
}

/* -------------------------------------------------------------------------- */
/* 天数构成                                                                    */
/* -------------------------------------------------------------------------- */

export interface MoodRatios {
  total: number
  positive: number
  neutral: number
  negative: number
}

/** 记录日的情绪构成占比（分母只算有记录的天） */
export function moodRatios(days: DailyMood[], band = NEUTRAL_BAND): MoodRatios {
  let positive = 0
  let negative = 0
  for (const day of days) {
    if (day.score >= band) positive++
    else if (day.score <= -band) negative++
  }
  return { total: days.length, positive, neutral: days.length - positive - negative, negative }
}

/* -------------------------------------------------------------------------- */
/* 区间对比（A/B）                                                             */
/* -------------------------------------------------------------------------- */

export interface PeriodStats {
  start: string
  end: string
  days: number
  messageCount: number
  averageScore: number
  positiveRatio: number
  negativeRatio: number
}

export interface PeriodComparison {
  windowDays: number
  /** B：紧邻当前的窗口（较新） */
  current: PeriodStats
  /** A：更早的等长窗口 */
  previous: PeriodStats
  delta: {
    averageScore: number
    positiveRatio: number
    negativeRatio: number
    messageCount: number
  }
}

function summarizePeriod(days: DailyMood[]): PeriodStats | null {
  if (days.length === 0) return null
  const ratios = moodRatios(days)
  let sum = 0
  let messageCount = 0
  for (const day of days) {
    sum += day.score
    messageCount += day.messageCount
  }
  return {
    start: days[0].date,
    end: days[days.length - 1].date,
    days: days.length,
    messageCount,
    averageScore: sum / days.length,
    positiveRatio: ratios.positive / ratios.total,
    negativeRatio: ratios.negative / ratios.total,
  }
}

/**
 * 最近 windowDays 天 vs 紧邻其前的 windowDays 天。
 * 任一侧完全没有记录时返回 null（此时任何「改善/恶化」都是噪声）。
 */
export function comparePeriods(allDays: DailyMood[], windowDays: number): PeriodComparison | null {
  if (allDays.length === 0) return null
  const size = Math.max(1, Math.floor(windowDays))
  const endTime = startOfDay(allDays[allDays.length - 1].day)
  const currentStart = shiftDays(endTime, -(size - 1)).getTime()
  const previousEnd = shiftDays(currentStart, -1).getTime()
  const previousStart = shiftDays(previousEnd, -(size - 1)).getTime()

  const current = summarizePeriod(allDays.filter((day) => startOfDay(day.day) >= currentStart))
  const previous = summarizePeriod(
    allDays.filter((day) => {
      const time = startOfDay(day.day)
      return time >= previousStart && time <= previousEnd
    }),
  )
  if (!current || !previous) return null

  return {
    windowDays: size,
    current,
    previous,
    delta: {
      averageScore: current.averageScore - previous.averageScore,
      positiveRatio: current.positiveRatio - previous.positiveRatio,
      negativeRatio: current.negativeRatio - previous.negativeRatio,
      messageCount: current.messageCount - previous.messageCount,
    },
  }
}

/**
 * 自动挑选对比窗口：取总跨度的一半，限制在 7–90 天。
 * 跨度不足 14 天时返回 null（无法切出两个有意义的窗口）。
 */
export function suggestCompareWindow(allDays: DailyMood[]): number | null {
  if (allDays.length < 2) return null
  const start = startOfDay(allDays[0].day)
  const end = startOfDay(allDays[allDays.length - 1].day)
  const span = Math.round((end - start) / DAY_MS) + 1
  if (span < 14) return null
  return Math.max(7, Math.min(90, Math.floor(span / 2)))
}

/* -------------------------------------------------------------------------- */
/* 词云                                                                        */
/* -------------------------------------------------------------------------- */

export interface CloudWord {
  word: string
  count: number
  positive: boolean
}

/** 汇总区间内的情绪词命中次数，按频次降序取前 limit 个 */
export function buildWordCloud(messages: AnalyzedMessage[], limit = 40): CloudWord[] {
  const counter = new Map<string, CloudWord>()
  const add = (word: string, positive: boolean) => {
    const found = counter.get(word)
    if (found) found.count++
    else counter.set(word, { word, count: 1, positive })
  }

  for (const message of messages) {
    for (const word of message.positiveWords) add(word, true)
    for (const word of message.negativeWords) add(word, false)
  }

  return [...counter.values()]
    .toSorted((a, b) => b.count - a.count || compareByCodePoint(a.word, b.word))
    .slice(0, Math.max(0, limit))
}

/**
 * 频次相同时的稳定排序。
 * 这里刻意不用 localeCompare：它依赖运行环境的默认语言与 ICU 数据，
 * 同一份代码在中文 Windows 与 CI 容器里可能给出不同顺序，会让测试和导出结果不稳定。
 * 平局顺序只用于「结果可复现」，用码点序即可。
 */
function compareByCodePoint(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/* -------------------------------------------------------------------------- */
/* 汇总（供 JSON 备份与面板使用）                                              */
/* -------------------------------------------------------------------------- */

export interface InsightSummary {
  rollingWindow: number
  trend: TrendResult
  streaks: StreakAnalysis
  ratios: MoodRatios
  /** 已记录的跨度（首日 ~ 末日）与其中无记录的天数 */
  span: { first: string; last: string; calendarDays: number; recordedDays: number; gapDays: number }
  topWords: CloudWord[]
  /** grid[weekday][band] = 均分；无记录为 null */
  weekdayHour: {
    labels: { weekday: string[]; hour: string[] }
    scoreGrid: Array<Array<number | null>>
    countGrid: number[][]
  }
  comparison: PeriodComparison | null
}

/** 汇总一个区间的分析结果；weekdayHour / topWords 需要记录明细，故单独传入 messages */
export function buildInsightSummary(
  days: DailyMood[],
  messages: AnalyzedMessage[],
  options: { rollingWindow?: number; wordLimit?: number; allDays?: DailyMood[] } = {},
): InsightSummary {
  const rollingWindow = options.rollingWindow ?? DEFAULT_ROLLING_WINDOW
  const series = buildDenseSeries(days)
  const matrix = buildWeekdayHourMatrix(messages)
  // 对比优先用全量数据切窗口（更有意义）；未提供时退回本区间的前后半段对比
  const comparisonBasis = options.allDays ?? days
  const window = suggestCompareWindow(comparisonBasis)

  const first = days.length > 0 ? days[0].date : ''
  const last = days.length > 0 ? days[days.length - 1].date : ''

  return {
    rollingWindow,
    trend: linearTrend(series),
    streaks: analyzeStreaks(days),
    ratios: moodRatios(days),
    span: {
      first,
      last,
      calendarDays: series.length,
      recordedDays: days.length,
      gapDays: Math.max(0, series.length - days.length),
    },
    topWords: buildWordCloud(messages, options.wordLimit ?? 20),
    weekdayHour: {
      labels: { weekday: [...WEEKDAY_LABELS], hour: [...HOUR_BAND_LABELS] },
      scoreGrid: matrix.grid.map((row) => row.map((cell) => (cell ? Number(cell.score.toFixed(4)) : null))),
      countGrid: matrix.grid.map((row) => row.map((cell) => (cell ? cell.count : 0))),
    },
    comparison: window === null ? null : comparePeriods(comparisonBasis, window),
  }
}
