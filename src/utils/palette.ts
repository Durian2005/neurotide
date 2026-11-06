// 全局暖米色色板：唯一的色值来源。
//
// 三条绘制路径在这里汇合，避免各处各写一份导致颜色漂移：
//   1. src/index.css 的 @theme 把同一组色值暴露成 Tailwind 工具类（bg-* / text-* / border-*）
//   2. Canvas / SVG / 报告 PNG 直接读 PALETTE 的十六进制值
//   3. tests/palette.test.ts 读 index.css 逐项核对，并按 WCAG 计算对比度
// 改配色时请同时改 index.css 的 @theme（测试会强制两边一致）。

export const PALETTE = {
  /** 主区背景：暖米色 */
  paper: '#F6EFE3',
  /** 侧栏：比主区略深一点，形成分层 */
  sidebar: '#EFE4D3',
  /** 卡片 / 面板：近白的奶油色 */
  card: '#FFFCF6',
  /** 卡片内嵌的次级区域 */
  sunken: '#EFE3D1',
  /** 热力图画布底色 */
  canvas: '#FBF6EC',
  /** 深色格子上的浅色文字 */
  cream: '#FFF9EF',

  /** 主文字（深可可褐） */
  ink: '#33291F',
  /** 次级文字 */
  inkSoft: '#554536',
  /** 弱化文字 / 提示文案：在所有底面上仍 >= 4.5:1 */
  inkMuted: '#6E5C49',

  /** 边框：在所有底面上 >= 3:1，可直接用于交互控件轮廓 */
  line: '#8A7353',
  /** 装饰性分隔线（不承载信息，故可以更浅） */
  lineSoft: '#CDB99B',

  /** 主品牌色：陶土红 */
  clay: '#9E4A2B',
  clayDeep: '#7C341B',
  /** 陶土色文字：在米色底上 >= 5.8:1 */
  clayInk: '#8C3F23',
  clayWash: '#F5E0D1',

  warn: '#8A5A10',
  warnWash: '#FAEBCD',
  danger: '#A02E26',
  dangerWash: '#FBE3DC',

  /** 情绪三档（热力图格子目标色）：偏浅的暖陶土 / 雾蓝，深墨小字在其上仍 >= 4.5:1 */
  moodNeutral: '#E2D4BE',
  moodPositive: '#D18A62',
  moodNegative: '#7FA8B5',
  /** 情绪语义文字（比格子色更深，保证小字可读） */
  positiveInk: '#9C3F1E',
  negativeInk: '#2E5A6B',
  negativeWash: '#E2EDF0',
  /** 无记录格子 */
  noData: '#E9DCC6',

  /** 高对比模式：在浅底上改为加深、加饱和（而非旧版深色主题里的提亮） */
  hcNeutral: '#6E583E',
  hcPositive: '#7C2C14',
  hcNegative: '#173E50',
} as const

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

/** `rgba()` 字符串，alpha ∈ [0,1] */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function linearChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminanceOfRgb([r, g, b]: Rgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b)
}

/** WCAG 2.x 相对亮度，入参为 #RRGGBB */
export function luminance(hex: string): number {
  return luminanceOfRgb(hexToRgb(hex))
}

/** WCAG 对比度，返回 1–21 */
export function contrastRatio(a: string, b: string): number {
  return ratio(luminance(a), luminance(b))
}

function ratio(x: number, y: number): number {
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 情绪格子上的前景色：在深墨与奶油白之间挑对比度更高的一个。
 * 默认格子偏浅 → 深墨；高对比格子偏深 → 奶油白。这样 10px 的数字与字形始终可读。
 */
export function cellTextColor(cell: Rgb): string {
  const dark = ratio(luminanceOfRgb(cell), luminance(PALETTE.ink))
  const light = ratio(luminanceOfRgb(cell), luminance(PALETTE.cream))
  return dark >= light ? PALETTE.ink : PALETTE.cream
}
