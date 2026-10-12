import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROLLING_WINDOW,
  analyzeStreaks,
  buildDenseSeries,
  buildInsightSummary,
  buildWeekdayHourMatrix,
  buildWordCloud,
  comparePeriods,
  linearTrend,
  MIN_CELL_SAMPLES,
  moodRatios,
  rollingMean,
  suggestCompareWindow,
  trendAt,
} from '../src/utils/analysis'
import { moodColor, moodRgb } from '../src/utils/moodColor'
import type { AnalyzedMessage, DailyMood } from '../src/utils/parser'

function day(date: string, score: number, messageCount = 1): DailyMood {
  const [y, m, d] = date.split('-').map(Number)
  const when = new Date(y, m - 1, d)
  return {
    date,
    day: when,
    raw: 0,
    score,
    messageCount,
    positiveHits: 0,
    negativeHits: 0,
    topWords: [],
    messages: [],
  }
}

function message(date: string, hour: number, score: number, positive: string[] = [], negative: string[] = []) {
  const [y, m, d] = date.split('-').map(Number)
  const when = new Date(y, m - 1, d, hour, 0, 0)
  const analyzed: AnalyzedMessage = {
    date: when,
    timestamp: when.getTime(),
    nickname: '我',
    content: '测试内容',
    positiveWords: positive,
    negativeWords: negative,
    spans: [],
    raw: 0,
    score,
  }
  return analyzed
}

/** 生成连续 N 天、每天一条记录的数据 */
function series(endDate: string, days: number, scoreAt: (index: number) => number): DailyMood[] {
  const [y, m, d] = endDate.split('-').map(Number)
  const end = new Date(y, m - 1, d)
  const out: DailyMood[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate() - offset)
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    out.push(day(key, scoreAt(days - 1 - offset)))
  }
  return out
}

describe('buildDenseSeries', () => {
  it('把缺口补成 null，且不把缺口当作 0', () => {
    const dense = buildDenseSeries([day('2026-03-01', 0.5), day('2026-03-04', -0.3)])
    expect(dense).toHaveLength(4)
    expect(dense.map((point) => point.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'])
    expect(dense.map((point) => point.score)).toEqual([0.5, null, null, -0.3])
    expect(dense[1].messageCount).toBe(0)
  })

  it('单日数据只产生一个点', () => {
    expect(buildDenseSeries([day('2026-03-01', 0.5)])).toHaveLength(1)
  })

  it('空输入返回空数组', () => {
    expect(buildDenseSeries([])).toEqual([])
  })

  it('跨度异常（年份写错）时退回稀疏序列，不生成上万个点', () => {
    const dense = buildDenseSeries([day('1900-01-01', 0.2), day('2026-01-01', 0.4)])
    expect(dense).toHaveLength(2)
    expect(dense.every((point) => typeof point.score === 'number')).toBe(true)
  })
})

describe('rollingMean', () => {
  const dense = buildDenseSeries([day('2026-03-01', 0.5), day('2026-03-04', -0.3)])

  it('窗口内只统计有记录的天', () => {
    expect(rollingMean(dense, 7)).toEqual([0.5, 0.5, 0.5, 0.1])
  })

  it('窗口为 1 时等于原始日值', () => {
    expect(rollingMean(dense, 1)).toEqual([0.5, null, null, -0.3])
  })

  it('窗口内全无记录时为 null', () => {
    const sparse = buildDenseSeries([day('2026-01-01', 0.4), day('2026-01-04', 0.5)])
    const values = rollingMean(sparse, 2)
    expect(values[0]).toBeCloseTo(0.4, 6)
    expect(values[2]).toBeNull()
    expect(values[3]).toBeCloseTo(0.5, 6)
  })

  it('默认窗口为 7 天', () => {
    expect(DEFAULT_ROLLING_WINDOW).toBe(7)
  })
})

describe('linearTrend', () => {
  it('完全线性时斜率与截距都精确', () => {
    const dense = buildDenseSeries([day('2026-01-01', 0.2), day('2026-01-02', 0.4), day('2026-01-03', 0.6)])
    const trend = linearTrend(dense)
    expect(trend.slopePerDay).toBeCloseTo(0.2, 10)
    expect(trend.intercept).toBeCloseTo(0.2, 10)
    expect(trend.slopePer30Days).toBeCloseTo(6, 10)
    expect(trend.points).toBe(3)
    expect(trend.direction).toBe('up')
    expect(trendAt(trend, 2)).toBeCloseTo(0.6, 10)
  })

  it('下降趋势方向为 down', () => {
    const dense = buildDenseSeries([day('2026-01-01', 0.6), day('2026-01-02', 0.2)])
    expect(linearTrend(dense).direction).toBe('down')
  })

  it('斜率为 0 视为持平', () => {
    const dense = buildDenseSeries([day('2026-01-01', 0.3), day('2026-01-02', 0.3)])
    const trend = linearTrend(dense)
    expect(trend.slopePerDay).toBe(0)
    expect(trend.direction).toBe('flat')
  })

  it('斜率小于阈值也视为持平', () => {
    const dense = buildDenseSeries([day('2026-01-01', 0.3), day('2026-01-02', 0.301)])
    expect(linearTrend(dense).direction).toBe('flat')
  })

  it('只有一个点时斜率为 0', () => {
    const trend = linearTrend(buildDenseSeries([day('2026-01-01', 0.3)]))
    expect(trend.points).toBe(1)
    expect(trend.slopePerDay).toBe(0)
    expect(trend.first).toBe(0.3)
  })

  it('空序列返回中性结果', () => {
    const trend = linearTrend([])
    expect(trend.points).toBe(0)
    expect(trend.first).toBeNull()
    expect(trend.last).toBeNull()
    expect(trend.direction).toBe('flat')
  })

  it('缺口不参与拟合但占据时间轴', () => {
    // 01-01 与 01-03 各一条，中点为空缺口
    const dense = buildDenseSeries([day('2026-01-01', 0.2), day('2026-01-03', 0.6)])
    const trend = linearTrend(dense)
    expect(trend.points).toBe(2)
    // x 取 0 与 2，故斜率是每天 0.2 而不是 0.4
    expect(trend.slopePerDay).toBeCloseTo(0.2, 10)
  })
})

describe('analyzeStreaks', () => {
  it('相邻日才连成一段', () => {
    const days = [day('2026-01-01', -0.5), day('2026-01-02', -0.3), day('2026-01-03', 0.5), day('2026-01-04', -0.4)]
    const { low } = analyzeStreaks(days)
    expect(low.longest).toEqual({ length: 2, start: '2026-01-01', end: '2026-01-02' })
    expect(low.current).toEqual({ length: 1, start: '2026-01-04', end: '2026-01-04' })
  })

  it('中间断更即断开，不把缺记录日算作连续', () => {
    const { low } = analyzeStreaks([day('2026-01-01', -0.5), day('2026-01-03', -0.5)])
    // 01-02 没有记录，两天不构成「连续两天低落」，因此是两个长度为 1 的段
    expect(low.longest?.length).toBe(1)
    expect(low.longest?.start).toBe('2026-01-01')
    // 最后一个记录日（01-03）本身低落，故仍存在「截至当前的 1 天低落」
    expect(low.current).toEqual({ length: 1, start: '2026-01-03', end: '2026-01-03' })
  })

  it('最后一个记录日继续低落时 current 才非空', () => {
    const ending = analyzeStreaks([day('2026-01-01', -0.5), day('2026-01-02', -0.4)])
    expect(ending.low.current).toEqual({ length: 2, start: '2026-01-01', end: '2026-01-02' })

    const notEnding = analyzeStreaks([day('2026-01-01', -0.5), day('2026-01-02', 0.4)])
    expect(notEnding.low.current).toBeNull()
    expect(notEnding.low.longest?.length).toBe(1)
  })

  it('积极区间独立统计', () => {
    const { positive } = analyzeStreaks([day('2026-01-01', 0.5), day('2026-01-02', 0.4)])
    expect(positive.longest).toEqual({ length: 2, start: '2026-01-01', end: '2026-01-02' })
  })

  it('恰好落在中性带边界上算作对应极性', () => {
    const onBand = analyzeStreaks([day('2026-01-01', -0.12), day('2026-01-02', 0.12)])
    expect(onBand.low.longest?.length).toBe(1)
    expect(onBand.positive.longest?.length).toBe(1)
  })

  it('空输入返回空区间', () => {
    const { low, positive } = analyzeStreaks([])
    expect(low.longest).toBeNull()
    expect(low.current).toBeNull()
    expect(positive.longest).toBeNull()
  })
})

describe('buildWeekdayHourMatrix', () => {
  it('星期以周一为第一行，时段按 4 小时切分', () => {
    // 2026-03-01 是周日，2026-03-02 是周一
    const matrix = buildWeekdayHourMatrix([message('2026-03-02', 9, 0.4), message('2026-03-01', 22, -0.5)])
    expect(matrix.grid[0][2]?.score).toBeCloseTo(0.4, 6)
    expect(matrix.grid[6][5]?.score).toBeCloseTo(-0.5, 6)
    expect(matrix.grid[1][0]).toBeNull()
    expect(matrix.totalCount).toBe(2)
    expect(matrix.maxCount).toBe(1)
  })

  it('无记录为 null，均分取单元格内平均', () => {
    const matrix = buildWeekdayHourMatrix([
      message('2026-03-02', 9, 0.4),
      message('2026-03-02', 10, 0.6),
      message('2026-03-02', 11, 0.8),
    ])
    expect(matrix.grid[0][2]?.count).toBe(3)
    expect(matrix.grid[0][2]?.score).toBeCloseTo(0.6, 6)
  })

  it('样本不足的格子不参与最好 / 最差评选', () => {
    const few = buildWeekdayHourMatrix([message('2026-03-02', 9, 0.9)])
    expect(few.best).toBeNull()
    expect(few.worst).toBeNull()
  })

  it('样本达标后给出最好与最差时段', () => {
    const messages = [
      message('2026-03-02', 9, 0.4),
      message('2026-03-02', 9, 0.6),
      message('2026-03-02', 9, 0.8),
      message('2026-03-03', 8, -0.5),
      message('2026-03-03', 8, -0.5),
      message('2026-03-03', 8, -0.5),
    ]
    const matrix = buildWeekdayHourMatrix(messages)
    expect(matrix.best?.weekday).toBe(0)
    expect(matrix.best?.band).toBe(2)
    expect(matrix.worst?.weekday).toBe(1)
    expect(matrix.worst?.band).toBe(2)
    expect(matrix.grid[0][2]?.count).toBe(MIN_CELL_SAMPLES)
  })

  it('命中数按中性带区分积极与消极', () => {
    const matrix = buildWeekdayHourMatrix([
      message('2026-03-02', 9, 0.5),
      message('2026-03-02', 10, -0.5),
      message('2026-03-02', 11, 0.05),
    ])
    const cell = matrix.grid[0][2]
    expect(cell?.positive).toBe(1)
    expect(cell?.negative).toBe(1)
    expect(cell?.count).toBe(3)
  })

  it('深夜落在最后一个时段', () => {
    const matrix = buildWeekdayHourMatrix([message('2026-03-02', 23, 0.2)])
    expect(matrix.grid[0][5]?.count).toBe(1)
  })

  it('空输入时全部为 null', () => {
    const matrix = buildWeekdayHourMatrix([])
    expect(matrix.totalCount).toBe(0)
    expect(matrix.best).toBeNull()
    expect(matrix.grid.flat().every((cell) => cell === null)).toBe(true)
  })
})

describe('moodRatios', () => {
  it('按中性带划分三类天数', () => {
    const ratios = moodRatios([day('2026-01-01', 0.5), day('2026-01-02', 0), day('2026-01-03', -0.5)])
    expect(ratios).toEqual({ total: 3, positive: 1, neutral: 1, negative: 1 })
  })

  it('空输入占比为 0', () => {
    expect(moodRatios([])).toEqual({ total: 0, positive: 0, neutral: 0, negative: 0 })
  })
})

describe('comparePeriods', () => {
  /** 前 10 天 -0.5，后 10 天 +0.5 */
  const basis = series('2026-01-20', 20, (index) => (index < 10 ? -0.5 : 0.5))

  it('切成两个等长窗口并给出变化量', () => {
    const comparison = comparePeriods(basis, 10)
    expect(comparison).not.toBeNull()
    expect(comparison?.windowDays).toBe(10)
    expect(comparison?.previous.start).toBe('2026-01-01')
    expect(comparison?.previous.end).toBe('2026-01-10')
    expect(comparison?.current.start).toBe('2026-01-11')
    expect(comparison?.current.end).toBe('2026-01-20')
    expect(comparison?.previous.averageScore).toBeCloseTo(-0.5, 6)
    expect(comparison?.current.averageScore).toBeCloseTo(0.5, 6)
    expect(comparison?.delta.averageScore).toBeCloseTo(1, 6)
    expect(comparison?.delta.positiveRatio).toBeCloseTo(1, 6)
    expect(comparison?.delta.negativeRatio).toBeCloseTo(-1, 6)
  })

  it('前一个窗口完全没有记录时返回 null', () => {
    expect(
      comparePeriods(
        series('2026-01-06', 6, () => 0.5),
        10,
      ),
    ).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(comparePeriods([], 30)).toBeNull()
  })

  it('记录条数差异也被带上', () => {
    const withCounts = [
      ...series('2026-01-10', 10, () => 0.2),
      ...series('2026-01-20', 10, () => 0.2).map((d) => day(d.date, d.score, 3)),
    ]
    const comparison = comparePeriods(withCounts, 10)
    expect(comparison?.previous.messageCount).toBe(10)
    expect(comparison?.current.messageCount).toBe(30)
    expect(comparison?.delta.messageCount).toBe(20)
  })
})

describe('suggestCompareWindow', () => {
  it('取总跨度的一半', () => {
    expect(suggestCompareWindow(series('2026-01-20', 20, () => 0.1))).toBe(10)
  })

  it('跨度不足 14 天时无法对比', () => {
    expect(suggestCompareWindow(series('2026-01-13', 13, () => 0.1))).toBeNull()
    expect(suggestCompareWindow(series('2026-01-14', 14, () => 0.1))).toBe(7)
  })

  it('窗口上限 90 天、下限 7 天', () => {
    expect(suggestCompareWindow(series('2026-12-31', 400, () => 0.1))).toBe(90)
    expect(suggestCompareWindow(series('2026-01-20', 16, () => 0.1))).toBe(8)
  })

  it('不足两天时返回 null', () => {
    expect(suggestCompareWindow([])).toBeNull()
    expect(suggestCompareWindow([day('2026-01-01', 0.1)])).toBeNull()
  })
})

describe('buildWordCloud', () => {
  const messages = [
    message('2026-01-01', 9, 0.3, ['开心', '放松'], []),
    message('2026-01-02', 9, 0.3, ['开心'], ['累']),
    message('2026-01-03', 9, -0.3, [], ['累', '烦']),
  ]

  it('按频次降序并保留极性', () => {
    const words = buildWordCloud(messages)
    // 「开心」与「累」同为 2 次，平局按码点序：开 U+5F00 < 累 U+7D2F
    expect(words[0]).toEqual({ word: '开心', count: 2, positive: true })
    expect(words[1]).toEqual({ word: '累', count: 2, positive: false })
    expect(
      words
        .map((item) => item.word)
        .slice(2)
        .toSorted(),
    ).toEqual(['放松', '烦'])
  })

  it('limit 生效', () => {
    expect(buildWordCloud(messages, 2)).toHaveLength(2)
    expect(buildWordCloud(messages, 0)).toHaveLength(0)
  })

  it('同频次按码点序排列，不受运行环境语言影响', () => {
    const tied = buildWordCloud([message('2026-01-01', 9, 0.3, ['banana', 'apple'], [])])
    expect(tied.map((item) => item.word)).toEqual(['apple', 'banana'])
  })

  it('无命中返回空数组', () => {
    expect(buildWordCloud([message('2026-01-01', 9, 0)])).toEqual([])
  })
})

describe('buildInsightSummary', () => {
  const days = series('2026-01-20', 20, (index) => (index < 10 ? -0.4 : 0.4))
  const messages = days.map((entry) =>
    message(entry.date, 9, entry.score, entry.score > 0 ? ['开心'] : [], entry.score < 0 ? ['累'] : []),
  )

  it('给出跨度、缺口与分析字段', () => {
    const summary = buildInsightSummary(days, messages)
    expect(summary.span.recordedDays).toBe(20)
    expect(summary.span.calendarDays).toBe(20)
    expect(summary.span.gapDays).toBe(0)
    expect(summary.trend.direction).toBe('up')
    expect(summary.ratios.positive).toBe(10)
    expect(summary.ratios.negative).toBe(10)
    expect(summary.weekdayHour.scoreGrid).toHaveLength(7)
    expect(summary.weekdayHour.scoreGrid[0]).toHaveLength(6)
    expect(summary.weekdayHour.countGrid[0]).toHaveLength(6)
    expect(summary.topWords.length).toBeGreaterThan(0)
    expect(summary.comparison?.windowDays).toBe(10)
  })

  it('缺口天数被如实记录', () => {
    const sparse = [day('2026-01-01', 0.2), day('2026-01-05', 0.4)]
    const summary = buildInsightSummary(sparse, [])
    expect(summary.span.calendarDays).toBe(5)
    expect(summary.span.recordedDays).toBe(2)
    expect(summary.span.gapDays).toBe(3)
  })

  it('传入 allDays 时对比窗口从全量数据切', () => {
    const allDays = series('2026-03-10', 80, (index) => (index < 40 ? -0.3 : 0.3))
    const recent = allDays.slice(-20)
    const summary = buildInsightSummary(recent, [], { allDays })
    expect(summary.comparison?.windowDays).toBe(40)
    expect(summary.comparison?.current.end).toBe('2026-03-10')
  })

  it('空区间不抛异常', () => {
    const summary = buildInsightSummary([], [])
    expect(summary.trend.points).toBe(0)
    expect(summary.comparison).toBeNull()
    expect(summary.topWords).toEqual([])
  })
})

/** 三通道之和，作为「看起来有多亮」的粗略代理 */
const channelSum = (rgb: [number, number, number]): number => rgb[0] + rgb[1] + rgb[2]

describe('moodColor', () => {
  it('中性返回固定的中性灰', () => {
    expect(moodRgb(0)).toEqual([51, 65, 85])
    expect(moodColor(0)).toBe('rgb(51, 65, 85)')
  })

  it('超出中性带的幅度越大，颜色越远离中性', () => {
    const mild = moodRgb(0.2)
    const strong = moodRgb(0.9)
    expect(strong[1]).toBeGreaterThan(mild[1])
    expect(strong[1]).toBeGreaterThan(65)
  })

  it('消极一侧走蓝色通道', () => {
    const negative = moodRgb(-0.9)
    expect(negative[2]).toBeGreaterThan(negative[1])
    expect(negative[0]).toBeLessThan(51)
  })

  it('中性带内为中性灰', () => {
    expect(moodColor(0.1)).toBe('rgb(51, 65, 85)')
    expect(moodColor(-0.1)).toBe('rgb(51, 65, 85)')
  })

  it('越过中性带立刻显色：这是有意的「交通灯」设计', () => {
    // moodLevel 用 >= / <= 判定，因此恰好等于 ±0.12 已算作积极/消极。
    // 颜色映射里的 k 有 0.42 的下限，所以一过界就有可见颜色，不存在「浅到看不见」的过渡带。
    expect(moodRgb(0.12)[1]).toBeGreaterThan(65)
    const negative = moodRgb(-0.12)
    expect(negative[2]).toBeGreaterThan(negative[1])
  })

  it('高对比模式抬高亮度、压平幅度（幅度改由强度条承载）', () => {
    expect(moodRgb(0, true)).toEqual([148, 163, 184])
    expect(moodColor(0, true)).toBe('rgb(148, 163, 184)')

    // 积极/消极两侧都明显亮于默认配色（三通道之和作为粗略亮度）
    expect(channelSum(moodRgb(-0.9, true))).toBeGreaterThan(channelSum(moodRgb(-0.9)))
    expect(channelSum(moodRgb(0.9, true))).toBeGreaterThan(channelSum(moodRgb(0.9)))

    // 混合下限 0.78 → 弱信号与强信号的颜色差距被压缩，必须配合强度条使用
    const weak = moodRgb(0.15, true)
    const strong = moodRgb(0.95, true)
    expect(Math.abs(strong[1] - weak[1])).toBeLessThan(Math.abs(moodRgb(0.95)[1] - moodRgb(0.15)[1]))

    // 方向仍然分得开：积极是青系（红通道最低），消极是蓝系（蓝高于绿）
    const positive = moodRgb(0.5, true)
    expect(positive[0]).toBeLessThan(positive[1])
    expect(positive[0]).toBeLessThan(positive[2])
    const negative = moodRgb(-0.5, true)
    expect(negative[2]).toBeGreaterThan(negative[1])
    expect(negative[2]).toBeGreaterThan(negative[0])
  })
})
