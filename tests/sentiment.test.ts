import { describe, expect, it } from 'vitest'
import {
  DICTIONARY_SIZE,
  MOOD_HEX,
  MOOD_HEX_HIGH_CONTRAST,
  NEUTRAL_BAND,
  aggregateScore,
  analyzeScreenshotText,
  analyzeText,
  messageScore,
  moodGlyph,
  moodLabel,
  moodLevel,
} from '../src/utils/sentiment'

// ① 情绪词典引擎的回归测试。
// 每条断言对应一个曾经真实存在的缺陷，改动 sentiment.ts 时这里必须保持全绿。

describe('极性判定与否定作用域', () => {
  it('「开心」判定为积极', () => {
    expect(analyzeText('开心').raw).toBeGreaterThan(0)
  })

  it('「不开心」被否定词翻转为消极（旧版曾判为积极）', () => {
    expect(analyzeText('不开心').raw).toBeLessThan(0)
  })

  it('「不是很开心」两层修饰后仍为消极', () => {
    expect(analyzeText('不是很开心').raw).toBeLessThan(0)
  })

  it('「毫无压力」被翻转为积极', () => {
    expect(analyzeText('毫无压力').raw).toBeGreaterThan(0)
  })

  it('否定前缀并入命中片段，整段标为消极', () => {
    expect(analyzeText('我不开心').hits[0]?.surface).toBe('不开心')
  })
})

describe('子串误命中（单字词条的邻接屏蔽）', () => {
  it('「积累了很多经验」不再命中「累」', () => {
    expect(analyzeText('积累了很多经验').raw).toBe(0)
  })

  it('「我的爱好是钓鱼」不再命中「爱」', () => {
    expect(analyzeText('我的爱好是钓鱼').raw).toBe(0)
  })

  it('「可爱的小猫」不因屏蔽而漏判，仍为积极', () => {
    expect(analyzeText('可爱的小猫').raw).toBeGreaterThan(0)
  })
})

describe('程度副词的放大与削弱', () => {
  it('「超级开心」强于「开心」', () => {
    expect(analyzeText('超级开心').raw).toBeGreaterThan(analyzeText('开心').raw)
  })

  it('「有点累」弱于「特别累」', () => {
    expect(Math.abs(analyzeText('有点累').raw)).toBeLessThan(Math.abs(analyzeText('特别累').raw))
  })

  it('程度词优先于否定词匹配：「非常开心」不被「非」误判为否定', () => {
    // 否定词表含「非」，若先匹配否定词，「非常开心」会被整条翻转
    expect(analyzeText('非常开心').raw).toBeGreaterThan(analyzeText('开心').raw)
  })
})

describe('匹配策略与词典完整性', () => {
  it('最长匹配优先：「沮丧」不被「丧」重复计分', () => {
    expect(analyzeText('沮丧').hits).toHaveLength(1)
  })

  it('emoji 参与计分：「😭」为消极', () => {
    expect(analyzeText('😭').raw).toBeLessThan(0)
  })

  it('积极词与消极词均已收录', () => {
    expect(DICTIONARY_SIZE.positive).toBeGreaterThan(0)
    expect(DICTIONARY_SIZE.negative).toBeGreaterThan(0)
  })

  it('空文本不产生命中', () => {
    expect(analyzeText('').raw).toBe(0)
    expect(analyzeText('').hits).toHaveLength(0)
  })
})

describe('分值与聚合口径', () => {
  it('messageScore 把原始分压缩到 [-1, 1]', () => {
    for (const raw of [-10, -3, -1, 0, 1, 3, 10]) {
      const score = messageScore(raw)
      expect(score).toBeGreaterThanOrEqual(-1)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('messageScore 为奇函数且保序', () => {
    expect(messageScore(2)).toBeCloseTo(-messageScore(-2), 10)
    expect(messageScore(3)).toBeGreaterThan(messageScore(1))
  })

  it('空数组聚合为 0', () => {
    expect(aggregateScore([])).toBe(0)
  })

  it('aggregateScore 先压缩再平均，与单条同为绝对量纲', () => {
    const raws = [3, -1, 0]
    const expected = (messageScore(3) + messageScore(-1) + messageScore(0)) / 3
    expect(aggregateScore(raws)).toBeCloseTo(expected, 10)
  })

  it('截图分值落在 [-1, 1]，且与单条口径一致', () => {
    const shot = analyzeScreenshotText('今天很开心\n工作有点压力')
    expect(shot.score).toBeGreaterThanOrEqual(-1)
    expect(shot.score).toBeLessThanOrEqual(1)

    const single = analyzeScreenshotText('开心')
    expect(single.score).toBeCloseTo(messageScore(single.raw), 10)
  })

  it('截图 raw 为各文本行加权计分之和', () => {
    const shot = analyzeScreenshotText('开心\n难过')
    expect(shot.raw).toBeCloseTo(analyzeText('开心').raw + analyzeText('难过').raw, 10)
  })
})

describe('分档与文案', () => {
  it('中性带边界', () => {
    expect(moodLevel(NEUTRAL_BAND)).toBe('positive')
    expect(moodLevel(-NEUTRAL_BAND)).toBe('negative')
    expect(moodLevel(0)).toBe('neutral')
  })

  it('文案随强度变化', () => {
    expect(moodLabel(0.8)).toBe('积极')
    expect(moodLabel(0.3)).toBe('偏积极')
    expect(moodLabel(0)).toBe('中性')
    expect(moodLabel(-0.3)).toBe('偏消极')
    expect(moodLabel(-0.8)).toBe('消极')
  })
})

/** 粗略相对亮度（WCAG 系数），用于断言高对比配色确实抬高了亮度 */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('色觉辅助（颜色之外的第二通道）', () => {
  it('方向字形与分档一致，中性用圆点而非箭头', () => {
    expect(moodGlyph(0.8)).toBe('▲')
    expect(moodGlyph(0.12)).toBe('▲')
    expect(moodGlyph(0)).toBe('·')
    expect(moodGlyph(-0.12)).toBe('▼')
    expect(moodGlyph(-0.8)).toBe('▼')
  })

  it('高对比配色抬高了消极色的亮度（原色在深色底上几乎不可辨）', () => {
    expect(luminance(MOOD_HEX_HIGH_CONTRAST.negative)).toBeGreaterThan(luminance(MOOD_HEX.negative) * 2)
    expect(luminance(MOOD_HEX_HIGH_CONTRAST.neutral)).toBeGreaterThan(luminance(MOOD_HEX.neutral))
    // 三档在高对比下仍然互不相同
    const set = new Set([
      MOOD_HEX_HIGH_CONTRAST.negative,
      MOOD_HEX_HIGH_CONTRAST.neutral,
      MOOD_HEX_HIGH_CONTRAST.positive,
    ])
    expect(set.size).toBe(3)
  })
})
