// 浏览器侧导出：触发文件下载，以及把热力图与概览合成为一张完整报告 PNG。
//
// 本模块直接依赖 DOM 与 Canvas，因此不参与 node 环境的单元测试，
// 改由发布前的浏览器端到端核验覆盖（校验 PNG 文件头与尺寸、CSV 的 BOM 与 CRLF 等实际字节）。
// 纯数据的构建逻辑在 exportReport.ts 中，那部分是完整单测覆盖的。

import { MOOD_HEX, NEUTRAL_BAND, moodLabel } from './sentiment'
import { buildOverview, RANGE_LABEL } from './parser'
import type { DailyMood, TimeRange } from './parser'

const REPORT_WIDTH = 1120
const REPORT_PAD = 48
const REPORT_SCALE = 2
const BG = '#0f172a'
const PANEL = '#172136'
const TEXT_MAIN = '#f1f5f9'
const TEXT_MUTED = '#94a3b8'
const TEXT_DIM = '#64748b'
const POSITIVE = '#67e8f9'
const NEGATIVE = '#93c5fd'
const NEUTRAL = '#cbd5e1'
const FONT_STACK = 'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'

/**
 * 报告里热力图的最高允许高度 = 内容区宽度（即高宽比 ≤ 1）。
 * 超出就**等比收窄**，绝不为了填满内容框而拉伸 —— 热力图格子是正方形，
 * 纵向压扁一眼就能看出来（早先 881 高的画布被硬塞进 620 的框，纵向压到 0.7 倍）。
 */
const MAX_HEATMAP_HEIGHT = REPORT_WIDTH - REPORT_PAD * 2

function triggerDownload(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** 以文本内容下载；blob URL 延后回收，避免下载尚未开始就被撤销 */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** 以 PNG 下载 canvas */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    triggerDownload(url, filename)
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }, 'image/png')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface ReportImageInput {
  datasetName: string
  range: TimeRange
  days: DailyMood[]
  heatmap: HTMLCanvasElement | null
  exportedAt?: Date
}

/**
 * 合成完整报告图：标题 → 概览卡片 → 热力图 → 图例 → 页脚。
 * 返回的 canvas 已按 2 倍像素密度绘制，可直接导出为高清 PNG。
 */
export function renderReportCanvas(input: ReportImageInput): HTMLCanvasElement {
  const { datasetName, days, heatmap, range } = input
  const exportedAt = input.exportedAt ?? new Date()
  const overview = buildOverview(days)

  let positiveDays = 0
  let negativeDays = 0
  for (const day of days) {
    if (day.score >= NEUTRAL_BAND) positiveDays++
    else if (day.score <= -NEUTRAL_BAND) negativeDays++
  }
  const positiveRatio = days.length > 0 ? Math.round((positiveDays / days.length) * 100) : 0

  // --- 先算高度 ---
  const headerH = 118
  const statsH = 96
  const heatmapBoxW = REPORT_WIDTH - REPORT_PAD * 2
  let heatmapW = 0
  let heatmapH = 0
  if (heatmap && heatmap.width > 0 && heatmap.height > 0) {
    const ratio = heatmap.height / heatmap.width
    heatmapW = heatmapBoxW
    heatmapH = Math.round(heatmapBoxW * ratio)
    if (heatmapH > MAX_HEATMAP_HEIGHT) {
      // 超出上限时**等比收窄**而不是压扁：把 881 高的画布硬塞进 620 的框里，
      // 纵向会被压到 0.7 倍，格子变成扁矩形。
      heatmapH = MAX_HEATMAP_HEIGHT
      heatmapW = Math.round(heatmapH / ratio)
    }
  }
  const heatmapX = REPORT_PAD + Math.round((heatmapBoxW - heatmapW) / 2)
  const legendH = 54
  const footerH = 42
  const height = REPORT_PAD + headerH + statsH + (heatmapH > 0 ? heatmapH + 20 : 0) + legendH + footerH + REPORT_PAD

  const canvas = document.createElement('canvas')
  canvas.width = REPORT_WIDTH * REPORT_SCALE
  canvas.height = height * REPORT_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.setTransform(REPORT_SCALE, 0, 0, REPORT_SCALE, 0, 0)

  // --- 背景 ---
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, REPORT_WIDTH, height)

  // --- 标题区 ---
  let cursorY = REPORT_PAD
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_MAIN
  ctx.font = `600 30px ${FONT_STACK}`
  ctx.fillText('NeuroTide 情绪报告', REPORT_PAD, cursorY)

  // 右上角档位标记
  ctx.textAlign = 'right'
  ctx.font = `500 15px ${FONT_STACK}`
  ctx.fillStyle = POSITIVE
  ctx.fillText(RANGE_LABEL[range], REPORT_WIDTH - REPORT_PAD, cursorY + 6)

  cursorY += 42
  ctx.textAlign = 'left'
  ctx.font = `14px ${FONT_STACK}`
  ctx.fillStyle = TEXT_MUTED
  const stamp = `${exportedAt.getFullYear()}-${pad2(exportedAt.getMonth() + 1)}-${pad2(exportedAt.getDate())} ${pad2(
    exportedAt.getHours(),
  )}:${pad2(exportedAt.getMinutes())}`
  const rangeText = days.length > 0 ? `${days[0].date} ~ ${days[days.length - 1].date}` : '无数据'
  ctx.fillText(`${datasetName} · ${rangeText} · 导出时间 ${stamp}`, REPORT_PAD, cursorY)

  cursorY += 34
  ctx.strokeStyle = 'rgba(148,163,184,0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(REPORT_PAD, cursorY + 0.5)
  ctx.lineTo(REPORT_WIDTH - REPORT_PAD, cursorY + 0.5)
  ctx.stroke()

  // --- 概览卡片 ---
  cursorY += 20
  const cells: Array<{ label: string; value: string; color: string }> = [
    { label: '总天数', value: `${overview.totalDays} 天`, color: TEXT_MAIN },
    { label: '记录条数', value: `${overview.messageCount} 条`, color: TEXT_MAIN },
    {
      label: '平均情绪值',
      value: `${overview.averageScore >= 0 ? '+' : ''}${overview.averageScore.toFixed(2)} ${moodLabel(overview.averageScore)}`,
      color:
        overview.averageScore >= NEUTRAL_BAND ? POSITIVE : overview.averageScore <= -NEUTRAL_BAND ? NEGATIVE : NEUTRAL,
    },
    { label: '积极天数占比', value: `${positiveRatio}%`, color: positiveRatio >= 50 ? POSITIVE : NEUTRAL },
    { label: '消极天数', value: `${negativeDays} 天`, color: negativeDays > 0 ? NEGATIVE : TEXT_MAIN },
  ]
  const cellGap = 12
  const cellW = (heatmapW - cellGap * (cells.length - 1)) / cells.length
  cells.forEach((cell, index) => {
    const x = REPORT_PAD + index * (cellW + cellGap)
    ctx.fillStyle = PANEL
    roundRect(ctx, x, cursorY, cellW, statsH - 20, 12)
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `13px ${FONT_STACK}`
    ctx.fillStyle = TEXT_DIM
    ctx.fillText(cell.label, x + 14, cursorY + 14)
    ctx.font = `600 20px ${FONT_STACK}`
    ctx.fillStyle = cell.color
    ctx.fillText(cell.value, x + 14, cursorY + 38)
  })
  cursorY += statsH

  // 最积极 / 最消极
  const best = overview.bestDay
  const worst = overview.worstDay
  ctx.font = `13px ${FONT_STACK}`
  if (best) {
    ctx.textAlign = 'left'
    ctx.fillStyle = POSITIVE
    ctx.fillText(
      `最积极：${best.date}（${best.score >= 0 ? '+' : ''}${best.score.toFixed(2)}）`,
      REPORT_PAD,
      cursorY - 4,
    )
  }
  if (worst) {
    ctx.textAlign = 'right'
    ctx.fillStyle = NEGATIVE
    ctx.fillText(`最消极：${worst.date}（${worst.score.toFixed(2)}）`, REPORT_WIDTH - REPORT_PAD, cursorY - 4)
    ctx.textAlign = 'left'
  }

  // --- 热力图 ---
  if (heatmapH > 0 && heatmap) {
    cursorY += 16
    ctx.save()
    ctx.fillStyle = PANEL
    roundRect(ctx, heatmapX, cursorY, heatmapW, heatmapH, 14)
    ctx.fill()
    ctx.clip()
    // 热力图源 canvas 的像素宽度随窗口变化，放大到报告宽度时开启高质量插值
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(heatmap, heatmapX, cursorY, heatmapW, heatmapH)
    ctx.restore()
    cursorY += heatmapH
  }

  // --- 图例 ---
  cursorY += 22
  ctx.textBaseline = 'middle'
  ctx.font = `13px ${FONT_STACK}`
  const legendItems: Array<[string, string]> = [
    ['积极', MOOD_HEX.positive],
    ['中性', MOOD_HEX.neutral],
    ['消极', MOOD_HEX.negative],
  ]
  let legendX = REPORT_PAD
  for (const [label, hex] of legendItems) {
    ctx.fillStyle = hex
    roundRect(ctx, legendX, cursorY - 6, 13, 13, 4)
    ctx.fill()
    ctx.fillStyle = TEXT_MUTED
    ctx.fillText(label, legendX + 19, cursorY + 1)
    legendX += 19 + ctx.measureText(label).width + 22
  }
  ctx.fillStyle = TEXT_DIM
  ctx.textAlign = 'right'
  ctx.fillText(`中性带 ±${NEUTRAL_BAND}`, REPORT_WIDTH - REPORT_PAD, cursorY + 1)

  // --- 页脚 ---
  ctx.textAlign = 'left'
  ctx.font = `12px ${FONT_STACK}`
  ctx.fillStyle = TEXT_DIM
  ctx.fillText('由 NeuroTide 本地生成 · 数据未离开本机 · 词典情绪结果仅供参考', REPORT_PAD, height - REPORT_PAD + 6)

  return canvas
}
