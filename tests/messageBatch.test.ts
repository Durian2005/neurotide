import { describe, expect, it } from 'vitest'
import {
  BATCH_STEP,
  INITIAL_BATCH,
  batchProgressLabel,
  groupDigits,
  hasMoreMessages,
  initialVisibleCount,
  nextVisibleCount,
} from '../src/utils/messageBatch'

describe('initialVisibleCount（首批条数）', () => {
  it('少于一批时直接全部显示', () => {
    expect(initialVisibleCount(1)).toBe(1)
    expect(initialVisibleCount(INITIAL_BATCH - 1)).toBe(INITIAL_BATCH - 1)
    expect(initialVisibleCount(INITIAL_BATCH)).toBe(INITIAL_BATCH)
  })

  it('超过一批时只显示首批', () => {
    expect(initialVisibleCount(INITIAL_BATCH + 1)).toBe(INITIAL_BATCH)
    expect(initialVisibleCount(50_000)).toBe(INITIAL_BATCH)
  })

  it('空数据与非法输入都返回 0', () => {
    expect(initialVisibleCount(0)).toBe(0)
    expect(initialVisibleCount(-5)).toBe(0)
    expect(initialVisibleCount(Number.NaN)).toBe(0)
    expect(initialVisibleCount(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('小数按整数截断', () => {
    expect(initialVisibleCount(10.9)).toBe(10)
  })
})

describe('nextVisibleCount（再展开一批）', () => {
  it('每次递增一批', () => {
    expect(nextVisibleCount(INITIAL_BATCH, 50_000)).toBe(INITIAL_BATCH + BATCH_STEP)
    expect(nextVisibleCount(0, 50_000)).toBe(BATCH_STEP)
  })

  it('到末尾就停在末尾，不越界', () => {
    expect(nextVisibleCount(50_000, 50_000)).toBe(50_000)
    expect(nextVisibleCount(49_990, 50_000)).toBe(50_000)
    expect(nextVisibleCount(0, 10)).toBe(10)
  })

  it('current 越界时先钳回合法区间', () => {
    expect(nextVisibleCount(99_999, 50_000)).toBe(50_000)
    expect(nextVisibleCount(-5, 50_000)).toBe(BATCH_STEP)
  })

  it('步长非法时不退化成 0（否则会卡住不动）', () => {
    expect(nextVisibleCount(0, 50_000, 0)).toBe(1)
    expect(nextVisibleCount(0, 50_000, -10)).toBe(1)
    expect(nextVisibleCount(0, 50_000, Number.NaN)).toBe(1)
  })

  it('可以自定义步长', () => {
    expect(nextVisibleCount(0, 1000, 500)).toBe(500)
    expect(nextVisibleCount(800, 1000, 500)).toBe(1000)
  })

  it('空数据始终为 0', () => {
    expect(nextVisibleCount(0, 0)).toBe(0)
    expect(nextVisibleCount(10, 0)).toBe(0)
  })
})

describe('hasMoreMessages（是否还有未显示）', () => {
  it('未显示完为 true，显示完为 false', () => {
    expect(hasMoreMessages(INITIAL_BATCH, 50_000)).toBe(true)
    expect(hasMoreMessages(50_000, 50_000)).toBe(false)
    expect(hasMoreMessages(0, 1)).toBe(true)
    expect(hasMoreMessages(1, 1)).toBe(false)
  })

  it('空数据没有更多', () => {
    expect(hasMoreMessages(0, 0)).toBe(false)
  })

  it('visible 越界不会误报', () => {
    expect(hasMoreMessages(99_999, 50_000)).toBe(false)
    expect(hasMoreMessages(-1, 50_000)).toBe(true)
  })
})

describe('batchProgressLabel（计数文案）', () => {
  it('未显示完时给出「已显示 / 共」', () => {
    expect(batchProgressLabel(120, 50_000)).toBe('已显示 120 / 50,000 条')
    expect(batchProgressLabel(0, 7)).toBe('已显示 0 / 7 条')
  })

  it('显示完时只给总数', () => {
    expect(batchProgressLabel(7, 7)).toBe('共 7 条')
    expect(batchProgressLabel(1000, 1000)).toBe('共 1,000 条')
  })

  it('空数据有专门文案', () => {
    expect(batchProgressLabel(0, 0)).toBe('暂无记录')
  })

  it('越界输入钳回合法区间后再出文案', () => {
    expect(batchProgressLabel(99_999, 50_000)).toBe('共 50,000 条')
    expect(batchProgressLabel(-3, 50_000)).toBe('已显示 0 / 50,000 条')
  })
})

describe('groupDigits（千分位）', () => {
  it('按三位分组，不依赖运行环境 locale', () => {
    expect(groupDigits(0)).toBe('0')
    expect(groupDigits(7)).toBe('7')
    expect(groupDigits(999)).toBe('999')
    expect(groupDigits(1000)).toBe('1,000')
    expect(groupDigits(50_000)).toBe('50,000')
    expect(groupDigits(1_234_567)).toBe('1,234,567')
  })

  it('截断小数部分', () => {
    expect(groupDigits(1234.56)).toBe('1,234')
  })
})
