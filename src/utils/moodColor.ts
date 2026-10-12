// 情绪值 → 颜色。
//
// 口径与词典一致：深蓝=消极、灰=中性、亮青=积极（alpha 之外同一套 RGB 混合规则）。
// 日历热力图、星期×时段热力图、报告图共用本模块，避免各处各写一份导致颜色漂移。
//
// `highContrast` 为色觉辅助 / 高对比模式：中性基色抬到 slate-400，消极色抬到 blue-400，
// 并把混合下限从 0.42 提到 0.78 —— 原本 #1e3a8a 在 #0f172a 上对比度约 1.6:1，几乎不可辨。

import { NEUTRAL_BAND, moodLevel } from './sentiment'

export type Rgb = [number, number, number]

const NEUTRAL_RGB: Rgb = [51, 65, 85]
const POSITIVE_RGB: Rgb = [34, 211, 238]
const NEGATIVE_RGB: Rgb = [30, 58, 138]

const NEUTRAL_RGB_HC: Rgb = [148, 163, 184]
const POSITIVE_RGB_HC: Rgb = [103, 232, 249]
const NEGATIVE_RGB_HC: Rgb = [96, 165, 250]

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
