import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PALETTE, contrastRatio, luminance } from '../src/utils/palette'
import { moodRgb, moodTextColor } from '../src/utils/moodColor'
import { MOOD_HEX, MOOD_HEX_HIGH_CONTRAST } from '../src/utils/sentiment'
import { CANVAS_BG, NO_DATA_HEX } from '../src/utils/heatmapGrid'

const BACKGROUNDS = [
  'paper',
  'sidebar',
  'card',
  'sunken',
  'canvas',
  'cream',
  'clayWash',
  'warnWash',
  'dangerWash',
  'negativeWash',
] as const

const TEXT_COLORS = ['ink', 'inkSoft', 'inkMuted', 'clayInk', 'positiveInk', 'negativeInk', 'warn', 'danger'] as const

const toHex = (rgb: readonly [number, number, number]): string =>
  `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

const palette: Record<string, string> = { ...PALETTE }
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8')

describe('暖米色色板', () => {
  it('所有色值都是 6 位十六进制', () => {
    for (const [name, value] of Object.entries(PALETTE)) {
      expect(value, name).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('index.css 的 @theme token 与 PALETTE 逐项一致（防止 CSS 与 Canvas 配色漂移）', () => {
    const tokens = [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)]
    expect(tokens.length).toBeGreaterThanOrEqual(25)
    for (const [, kebab, value] of tokens) {
      const key = kebab.replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase())
      expect(PALETTE, `--color-${kebab} 在 PALETTE 中没有对应项`).toHaveProperty(key)
      expect(palette[key].toLowerCase(), `--color-${kebab}`).toBe(value.toLowerCase())
    }
  })

  it('Canvas / 图例常量都指向同一份色板', () => {
    expect(CANVAS_BG).toBe(PALETTE.canvas)
    expect(NO_DATA_HEX).toBe(PALETTE.noData)
    expect(MOOD_HEX.positive).toBe(PALETTE.moodPositive)
    expect(MOOD_HEX.neutral).toBe(PALETTE.moodNeutral)
    expect(MOOD_HEX.negative).toBe(PALETTE.moodNegative)
    expect(MOOD_HEX_HIGH_CONTRAST.positive).toBe(PALETTE.hcPositive)
    expect(MOOD_HEX_HIGH_CONTRAST.neutral).toBe(PALETTE.hcNeutral)
    expect(MOOD_HEX_HIGH_CONTRAST.negative).toBe(PALETTE.hcNegative)
  })

  it('正文文字在所有底面上满足 WCAG AA（>= 4.5:1）', () => {
    for (const fg of TEXT_COLORS) {
      for (const bg of BACKGROUNDS) {
        expect(contrastRatio(PALETTE[fg], PALETTE[bg]), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('交互控件边框与焦点环满足非文本对比度（>= 3:1）', () => {
    for (const bg of BACKGROUNDS) {
      expect(contrastRatio(PALETTE.line, PALETTE[bg]), `line / ${bg}`).toBeGreaterThanOrEqual(3)
    }
    expect(contrastRatio(PALETTE.clayInk, PALETTE.paper)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(PALETTE.clayDeep, PALETTE.canvas)).toBeGreaterThanOrEqual(3)
  })

  it('主按钮：奶油白文字压在陶土色按钮上满足 AA', () => {
    expect(contrastRatio(PALETTE.cream, PALETTE.clay)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(PALETTE.cream, PALETTE.clayDeep)).toBeGreaterThanOrEqual(4.5)
  })

  it('情绪格子上的数字 / 字形在全部分值上满足 AA（自动切换深墨与奶油白）', () => {
    for (const highContrast of [false, true]) {
      for (let score = -1; score <= 1.0001; score += 0.02) {
        const cell = toHex(moodRgb(score, highContrast))
        const foreground = moodTextColor(score, highContrast)
        expect(contrastRatio(cell, foreground), `score=${score.toFixed(2)} hc=${highContrast}`).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })

  it('高对比配色在浅米色画布上明显更深，且图形对比度 >= 3:1', () => {
    for (const level of ['positive', 'neutral', 'negative'] as const) {
      const normal =
        level === 'positive' ? PALETTE.moodPositive : level === 'negative' ? PALETTE.moodNegative : PALETTE.moodNeutral
      const strong = MOOD_HEX_HIGH_CONTRAST[level]
      expect(luminance(strong), level).toBeLessThan(luminance(normal))
      expect(contrastRatio(strong, PALETTE.canvas), level).toBeGreaterThanOrEqual(3)
    }
  })
})
