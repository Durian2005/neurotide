import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDateTime,
  formatFullDate,
  formatRelativeTime,
  formatScore,
  formatShortDate,
} from '../src/utils/format'

describe('日期格式化', () => {
  const date = new Date(2026, 8, 6, 8, 5)

  it('完整日期', () => {
    expect(formatFullDate(date)).toBe('2026年9月6日')
  })

  it('日期时间补零', () => {
    expect(formatDateTime(date)).toBe('2026-09-06 08:05')
  })

  it('短日期补零', () => {
    expect(formatShortDate(date)).toBe('09-06')
  })
})

describe('情绪值格式化', () => {
  it('正值带加号', () => {
    expect(formatScore(0.423)).toBe('+0.42')
  })

  it('负值带减号', () => {
    expect(formatScore(-0.187)).toBe('-0.19')
  })

  it('零不带符号', () => {
    expect(formatScore(0)).toBe('0.00')
  })
})

describe('体积格式化', () => {
  it('小于 1KB 显示字节', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('KB 保留一位小数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('MB 在 10MB 以下保留一位小数', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(5.5 * 1048576)).toBe('5.5 MB')
  })

  it('10MB 以上取整，避免无意义精度', () => {
    expect(formatBytes(12 * 1048576)).toBe('12 MB')
  })

  it('非法输入返回占位符', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('相对时间', () => {
  const now = new Date(2026, 9, 11, 12, 0, 0).getTime()
  const minutesAgo = (n: number) => now - n * 60_000

  it('一分钟内显示刚刚', () => {
    expect(formatRelativeTime(now, now)).toBe('刚刚')
    expect(formatRelativeTime(minutesAgo(0.5), now)).toBe('刚刚')
  })

  it('分钟级', () => {
    expect(formatRelativeTime(minutesAgo(5), now)).toBe('5 分钟前')
    expect(formatRelativeTime(minutesAgo(59), now)).toBe('59 分钟前')
  })

  it('小时级', () => {
    expect(formatRelativeTime(minutesAgo(180), now)).toBe('3 小时前')
  })

  it('天级', () => {
    expect(formatRelativeTime(minutesAgo(60 * 24 * 2), now)).toBe('2 天前')
    expect(formatRelativeTime(minutesAgo(60 * 24 * 30), now)).toBe('30 天前')
  })

  it('超过 30 天回退为日期', () => {
    expect(formatRelativeTime(new Date(2026, 7, 1, 9, 0).getTime(), now)).toBe('2026-08-01')
  })

  it('时间在未来时与非法输入都能兜底', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('刚刚')
    expect(formatRelativeTime(Number.NaN, now)).toBe('—')
  })
})
