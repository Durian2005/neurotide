// 情绪值 → 颜色。
//
// 暖米色主题下：陶土橙=积极、浅沙=中性、雾蓝=消极（alpha 之外同一套 RGB 混合规则）。
// 日历热力图、星期×时段热力图、报告图共用本模块，避免各处各写一份导致颜色漂移。
// 色值统一来自 palette.ts；tests/palette.test.ts 会按 WCAG 校验格子与前景文字的对比度。
//
// `highContrast` 为高对比模式：浅底上改为**加深**配色（旧深色主题是提亮），
// 并把混合下限从 0.42 提到 0.78 —— 颜色因此不再承载幅度，须配合强度条使用。

import { NEUTRAL_BAND, moodLevel } from './sentiment'
import { PALETTE, cellTextColor, hexToRgb } from './palette'
import type { Rgb } from './palette'

export type { Rgb }

const NEUTRAL_RGB: Rgb = hexToRgb(PALETTE.moodNeutral)
const POSITIVE_RGB: Rgb = hexToRgb(PALETTE.moodPositive)
const NEGATIVE_RGB: Rgb = hexToRgb(PALETTE.moodNegative)

const NEUTRAL_RGB_HC: Rgb = hexToRgb(PALETTE.hcNeutral)
const POSITIVE_RGB_HC: Rgb = hexToRgb(PALETTE.hcPositive)
const NEGATIVE_RGB_HC: Rgb = hexToRgb(PALETTE.hcNegative)

const MIX_FLOOR = 0.42
const MIX_FLOOR_HC = 0.78

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/**
 * 情绪值 → RGB 三元组。
 * 重点：强度用「超出中性带的绝对幅度」度量，因此同一分值在任何视图里颜色一致。
 */
export function moodRgb(score: number, highContrast = false): Rgb {
  const neutral = highContrast ? NEUTRAL_RGB_HC : NEUTRAL_RGB
  const level = moodLevel(score)
  if (level === 'neutral') return [...neutral]
  const t = Math.min(1, (Math.abs(score) - NEUTRAL_BAND) / (1 - NEUTRAL_BAND))
  const floor = highContrast ? MIX_FLOOR_HC : MIX_FLOOR
  const target =
    level === 'positive'
      ? highContrast
        ? POSITIVE_RGB_HC
        : POSITIVE_RGB
      : highContrast
        ? NEGATIVE_RGB_HC
        : NEGATIVE_RGB
  const k = floor + (1 - floor) * t
  return [
    mixChannel(neutral[0], target[0], k),
    mixChannel(neutral[1], target[1], k),
    mixChannel(neutral[2], target[2], k),
  ]
}

/** 情绪值 → rgb() 字符串 */
export function moodColor(score: number, highContrast = false): string {
  const [r, g, b] = moodRgb(score, highContrast)
  return `rgb(${r}, ${g}, ${b})`
}

/** 情绪格子上的文字 / 字形颜色：自动在深墨与奶油白之间挑对比度更高的一侧 */
export function moodTextColor(score: number, highContrast = false): string {
  return cellTextColor(moodRgb(score, highContrast))
}
