import { describe, expect, it } from 'vitest'
import {
  CHUNK_THRESHOLD_LINES,
  PARSE_CHUNK_LINES,
  parseChatLog,
  parseChatLogAsync,
  parseChatTextWithReport,
  parseChatTextWithReportAsync,
} from '../src/utils/parser'

// ⑧ 分片解析：分片只改变「何时执行」，不改变处理顺序，
// 因此异步版（哪怕按 1 行一片把每条记录都切开）必须与同步版逐字段一致。

const CONTENT = '今天的天气很好，心情很轻松。'

/** 混合了孤立行 / 空行 / 装饰行 / 非法日期 / 乱序时间，尽量把各分支都覆盖到 */
const MIXED = [
  '这是文件开头的孤立说明行，没有时间戳也没有前置记录',
  `[2026-03-16 10:00:00] 李四: 有点累`,
  '',
  '======',
  `[2026-03-15 09:12:33] 张三: ${CONTENT}`,
  `[2026-02-30 09:00:00] 王五: 这是一条非法日期`,
  `[2026-03-18 07:30:00] 张三: 超级开心`,
].join('\n')

/** 换行内容格式：一条记录的内容本身就跨行，最容易被分片切坏 */
const BLOCK = [
  '[2026-03-15 09:12:33] 张三',
  '今天心情不错',
  '又多说了两句',
  '[2026-03-16 10:00:00] 李四',
  '有点累',
].join('\n')

const INLINE = [
  `2026-03-15 09:12:33 张三: ${CONTENT}`,
  `2026-03-16 10:00:00 李四: 今天有点累`,
  `2026-03-17 08:00:00 王五: 超级开心，简直太棒了`,
].join('\n')

const SAMPLES: Array<[string, string]> = [
  ['混合格式', MIXED],
  ['换行内容格式', BLOCK],
  ['行首时间 + 行内内容', INLINE],
  ['空文本', ''],
  ['只有空行', '\n\n\n'],
]

/** 测试里不真的让出主线程，避免几十次 setTimeout 拖慢用例 */
const noYield = async () => {}

describe('分片解析与同步解析结果一致', () => {
  for (const [label, text] of SAMPLES) {
    for (const chunkLines of [1, 2, 3, 5, 1000]) {
      it(`${label}，每片 ${chunkLines} 行`, async () => {
        const sync = parseChatTextWithReport(text)
        const chunked = await parseChatTextWithReportAsync(text, { chunkLines, yieldToMain: noYield })
        expect(chunked).toEqual(sync)
      })
    }
  }

  it('极端分片（1 行一片）也不会切坏换行内容记录', async () => {
    const sync = parseChatTextWithReport(BLOCK)
    const chunked = await parseChatTextWithReportAsync(BLOCK, { chunkLines: 1, yieldToMain: noYield })
    expect(chunked.messages).toHaveLength(2)
    expect(chunked.messages[0].content).toBe('今天心情不错 又多说了两句')
    expect(chunked).toEqual(sync)
  })

  it('报告里的空行 / 装饰行 / 非法日期计数与同步版一致', async () => {
    const sync = parseChatTextWithReport(MIXED)
    const chunked = await parseChatTextWithReportAsync(MIXED, { chunkLines: 2, yieldToMain: noYield })
    expect(sync.report.skippedLines).toBeGreaterThan(0)
    expect(sync.report.invalidDateLines).toBe(1)
    expect(sync.report.unmatchedLines).toBe(1)
    expect(chunked.report).toEqual(sync.report)
  })

  it('乱序时间在两种路径下都被排好序', async () => {
    const chunked = await parseChatTextWithReportAsync(MIXED, { chunkLines: 2, yieldToMain: noYield })
    const stamps = chunked.messages.map((message) => message.timestamp)
    expect(stamps).toEqual([...stamps].toSorted((a, b) => a - b))
  })

  it('一站式入口 parseChatLogAsync 与 parseChatLog 一致（含按天聚合）', async () => {
    const sync = parseChatLog(MIXED)
    const chunked = await parseChatLogAsync(MIXED, { chunkLines: 2, yieldToMain: noYield })
    expect(chunked).toEqual(sync)
    expect(chunked.days.length).toBeGreaterThan(0)
  })
})

describe('分片解析的进度与取消', () => {
  it('先报一次 0，再逐片递增到总数', async () => {
    const progress: Array<{ processed: number; total: number }> = []
    const result = await parseChatTextWithReportAsync(BLOCK, {
      chunkLines: 1,
      yieldToMain: noYield,
      onProgress: (info) => progress.push(info),
    })
    expect(progress[0]).toEqual({ processed: 0, total: result.report.totalLines })
    expect(progress.at(-1)).toEqual({ processed: result.report.totalLines, total: result.report.totalLines })
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index].processed).toBeGreaterThanOrEqual(progress[index - 1].processed)
    }
  })

  it('空文本也至少报一次进度，不会一次回调都不给', async () => {
    // 注意 '' 经 split('\n') 是 1 行（既有行为），所以这里只断言「有回调且首尾自洽」
    const progress: Array<{ processed: number; total: number }> = []
    await parseChatTextWithReportAsync('', { onProgress: (info) => progress.push(info) })
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0].processed).toBe(0)
    expect(progress.at(-1)?.processed).toBe(progress.at(-1)?.total)
  })

  it('收到 abort 后抛出 AbortError', async () => {
    const controller = new AbortController()
    const failure = await parseChatTextWithReportAsync(BLOCK, {
      chunkLines: 1,
      yieldToMain: noYield,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DOMException)
    expect((failure as DOMException).name).toBe('AbortError')
  })

  it('已 abort 的信号在开始前就生效', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      parseChatTextWithReportAsync(BLOCK, { signal: controller.signal, yieldToMain: noYield }),
    ).rejects.toThrow(/取消/)
  })
})

describe('分片参数与阈值', () => {
  it('非法分片大小退化为 1 行，不会死循环', async () => {
    for (const chunkLines of [0, -10, Number.NaN, 0.4]) {
      const chunked = await parseChatTextWithReportAsync(BLOCK, { chunkLines, yieldToMain: noYield })
      expect(chunked).toEqual(parseChatTextWithReport(BLOCK))
    }
  })

  it('默认分片大小低于「值得分片」的行数阈值，否则阈值没有意义', () => {
    expect(PARSE_CHUNK_LINES).toBeGreaterThan(0)
    expect(CHUNK_THRESHOLD_LINES).toBeGreaterThan(PARSE_CHUNK_LINES)
  })

  it('不注入 yieldToMain 时走默认实现，结果仍与同步版一致', async () => {
    // 默认实现是 setTimeout 让出（不能用 scheduler.yield，会饿死 React 的渲染调度）
    const chunked = await parseChatTextWithReportAsync(BLOCK, { chunkLines: 2 })
    expect(chunked).toEqual(parseChatTextWithReport(BLOCK))
  })
})
