import { describe, expect, it } from 'vitest'
import {
  aggregateByDay,
  buildOverview,
  filterByRange,
  parseChatLog,
  parseChatTextWithReport,
  toDateKey,
} from '../src/utils/parser'
import type { DailyMood } from '../src/utils/parser'
import { buildSampleChatLog } from '../src/utils/sampleData'
import { messageScore } from '../src/utils/sentiment'

// ② ③ 解析器与范围运算的回归测试。

const CONTENT = '今天的天气很好，心情很轻松。'

/** 构造一个只用于范围筛选的 DailyMood，其余字段填中性值 */
function makeDay(date: string): DailyMood {
  const [y, m, d] = date.split('-').map(Number)
  return {
    date,
    day: new Date(y, m - 1, d),
    raw: 0,
    score: 0,
    messageCount: 0,
    positiveHits: 0,
    negativeHits: 0,
    topWords: [],
    messages: [],
  }
}

describe('格式嗅探（4 种导出格式）', () => {
  const cases = [
    {
      label: '方括号 + 行内内容',
      text: `[2026-09-26 08:12:00] 我: ${CONTENT}`,
      format: 'bracket-inline',
    },
    {
      label: '行首时间 + 行内内容',
      text: `2026-09-26 08:12:00 我: ${CONTENT}`,
      format: 'plain-inline',
    },
    {
      label: '方括号 + 换行内容',
      text: `[2026-09-26 08:12:00] 我\n${CONTENT}`,
      format: 'bracket-block',
    },
    {
      label: '行首时间 + 换行内容',
      text: `2026-09-26 08:12:00 我\n${CONTENT}`,
      format: 'plain-block',
    },
  ] as const

  for (const { label, text, format } of cases) {
    it(`${label} → 识别为 ${format}`, () => {
      const { messages, report } = parseChatTextWithReport(text)
      expect(report.format).toBe(format)
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe(CONTENT)
      expect(messages[0]?.nickname).toBe('我')
    })
  }

  it('秒可省略', () => {
    const { messages } = parseChatTextWithReport(`[2026-09-26 08:12] 我: ${CONTENT}`)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.date.getSeconds()).toBe(0)
  })

  it('无时间戳的后续行并入上一条记录', () => {
    const text = [`[2026-09-26 08:12:00] 我: 第一段`, '第二段没有时间戳'].join('\n')
    const { messages, report } = parseChatTextWithReport(text)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe('第一段 第二段没有时间戳')
    expect(report.continuationLines).toBe(1)
  })

  it('消息按时间升序排列', () => {
    const text = ['[2026-09-26 20:00:00] 我: 晚上', '[2026-09-26 08:00:00] 我: 早上'].join('\n')
    const { messages } = parseChatTextWithReport(text)
    expect(messages.map((m) => m.content)).toEqual(['早上', '晚上'])
  })
})

describe('解析报告：跳过行、未识别行与非法日期', () => {
  it('装饰标题与日期标题被跳过，非法日期单独计数', () => {
    const text = [
      '=== 聊天记录导出 ===',
      '2026-09-26 星期六',
      '这是一行完全不符合格式的噪声',
      '[2026-09-26 08:12:00] 我: 今天很开心',
      '[2026-02-30 08:12:00] 我: 这条日期非法',
    ].join('\n')

    const { messages, report } = parseChatLog(text)
    expect(report.totalLines).toBe(5)
    expect(report.skippedLines).toBe(2)
    expect(report.unmatchedLines).toBe(1)
    expect(report.invalidDateLines).toBe(1)
    // 非法日期的行只计入 invalidDateLines，不计入 matchedLines
    expect(report.matchedLines).toBe(1)
    expect(messages).toHaveLength(1)
    expect(report.samples[0]).toContain('不符合格式')
  })

  it('2026-02-30 不静默进位成 3 月 2 日', () => {
    const { days } = parseChatLog('[2026-02-30 08:12:00] 我: 非法日期')
    expect(days).toHaveLength(0)
  })

  it('闰年 2028-02-29 合法、平年 2026-02-29 非法', () => {
    expect(parseChatLog('[2028-02-29 08:00:00] 我: 闰年').days).toHaveLength(1)
    expect(parseChatLog('[2026-02-29 08:00:00] 我: 平年').days).toHaveLength(0)
  })

  it('内容为空的记录计入 emptyRecords 且不入库', () => {
    const { report } = parseChatLog('[2026-09-26 08:12:00] 我:')
    expect(report.emptyRecords).toBe(1)
  })

  it('纯分隔线被跳过', () => {
    const { report } = parseChatLog(['---', '[2026-09-26 08:12:00] 我: 好'].join('\n'))
    expect(report.skippedLines).toBe(1)
  })
})

describe('按天聚合与分值口径', () => {
  it('同一天多条记录聚合，score 为各条 messageScore 的平均', () => {
    const text = ['[2026-09-26 08:00:00] 我: 开心', '[2026-09-26 20:00:00] 我: 难过'].join('\n')
    const { days } = parseChatLog(text)
    expect(days).toHaveLength(1)

    const day = days[0]!
    expect(day.messageCount).toBe(2)
    const expected = (messageScore(day.messages[0]!.raw) + messageScore(day.messages[1]!.raw)) / 2
    expect(day.score).toBeCloseTo(expected, 10)
  })

  it('日期键格式为 YYYY-MM-DD 且补零', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('不同日期的记录分别归组并按时间升序', () => {
    const text = ['[2026-09-27 08:00:00] 我: 第二天', '[2026-09-26 08:00:00] 我: 第一天'].join('\n')
    const { days } = parseChatLog(text)
    expect(days.map((d) => d.date)).toEqual(['2026-09-26', '2026-09-27'])
  })

  it('聚合不改变入参顺序', () => {
    const { messages } = parseChatTextWithReport(
      ['[2026-09-26 08:00:00] 我: 好', '[2026-09-27 08:00:00] 我: 好'].join('\n'),
    )
    const days = aggregateByDay(messages)
    expect(days[0]?.date).toBe('2026-09-26')
  })
})

describe('时间范围筛选', () => {
  // 旧实现：new Date(2026, 4 - 3, 31) 溢出成 3 月 3 日；新实现按目标月天数收口到 2 月 28 日
  const days = ['2026-01-15', '2026-02-27', '2026-02-28', '2026-05-31'].map(makeDay)

  it('月末回溯不溢出，近 3 月从 02-28 起算', () => {
    const within3m = filterByRange(days, '3m')
    expect(within3m.map((d) => d.date)).toEqual(['2026-02-28', '2026-05-31'])
  })

  it('近半年命中全部', () => {
    expect(filterByRange(days, '6m')).toHaveLength(4)
  })

  it('all 原样返回，空数组不报错', () => {
    expect(filterByRange(days, 'all')).toHaveLength(4)
    expect(filterByRange([], '3m')).toHaveLength(0)
  })

  it('以数据中最新一天为基准回溯（而非系统当前时间）', () => {
    const onlyOld = ['2020-01-01', '2020-03-01'].map(makeDay)
    expect(filterByRange(onlyOld, '3m')).toHaveLength(2)
  })

  it('切换筛选区间不改变重叠日期的分值（绝对量纲回归）', () => {
    const result = parseChatLog(buildSampleChatLog())
    const recent = filterByRange(result.days, '3m')
    const visible = recent[recent.length - 1]!
    const sameDayInAll = result.days.find((d) => d.date === visible.date)!
    // 旧实现用 raw/maxAbs 相对归一化，maxAbs 随筛选区间变化，此处会不相同
    expect(sameDayInAll.score).toBe(visible.score)
  })
})

describe('内置示例数据', () => {
  const sample = parseChatLog(buildSampleChatLog())

  it('格式被识别为方括号行内', () => {
    expect(sample.report.format).toBe('bracket-inline')
  })

  it('没有未识别行与非法日期行', () => {
    expect(sample.report.unmatchedLines).toBe(0)
    expect(sample.report.invalidDateLines).toBe(0)
  })

  it('覆盖多个日期的数据', () => {
    expect(sample.days.length).toBeGreaterThan(200)
    expect(sample.days.every((d) => d.score >= -1 && d.score <= 1)).toBe(true)
  })

  it('概览统计与明细自洽', () => {
    const overview = buildOverview(sample.days)
    expect(overview.totalDays).toBe(sample.days.length)
    expect(overview.messageCount).toBe(sample.messages.length)
    expect(overview.bestDay!.score).toBeGreaterThanOrEqual(overview.worstDay!.score)
  })

  it('空数据概览不抛错', () => {
    expect(buildOverview([])).toEqual({
      totalDays: 0,
      averageScore: 0,
      bestDay: null,
      worstDay: null,
      messageCount: 0,
    })
  })
})
