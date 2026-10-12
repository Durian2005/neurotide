// 纯数据导出：日粒度 CSV、可回导的 JSON 备份，以及文件名清理。
//
// 本模块不触碰 DOM，因此可被单元测试完整覆盖。
// 触发下载与合成报告图片属于浏览器侧行为，放在 browserExport.ts。
//
// 设计要点：
// 1. CSV 带 UTF-8 BOM 并使用 CRLF：否则 Excel 打开中文会乱码、换行会被吃掉。
// 2. JSON 备份内嵌原始文本，因此可被本应用重新导入，构成真正的「备份」而非一次性快照。

import { NEUTRAL_BAND } from './sentiment'
import { buildOverview } from './parser'
import { buildInsightSummary } from './analysis'
import type { DailyMood, ParseReport } from './parser'
import type { DatasetMeta } from './datasetStore'

export interface BackupPayload {
  app: 'NeuroTide'
  version: 1
  exportedAt: string
  dataset: Pick<DatasetMeta, 'name' | 'encoding' | 'savedAt' | 'dayCount' | 'messageCount'>
  rawText: string
}

/* -------------------------------------------------------------------------- */
/* 文件名                                                                      */
/* -------------------------------------------------------------------------- */

/** Windows 文件名保留字符 */
const RESERVED_NAME_CHARS = new Set('\\/:*?"<>|'.split(''))

/** 逐字符清理：丢弃控制字符，保留字符替换为下划线 */
function sanitizeFileName(name: string): string {
  let out = ''
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    out += RESERVED_NAME_CHARS.has(char) ? '_' : char
  }
  return out
}

/** 去掉文件名中的非法字符，避免下载被浏览器拒绝 */
export function safeFileName(name: string): string {
  const cleaned = sanitizeFileName(name.replace(/\.[a-z0-9]{1,8}$/i, ''))
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return cleaned || 'neurotide'
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** RFC 4180 转义：含逗号、引号或换行时加引号，内部引号翻倍 */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export const CSV_HEADER = ['日期', '情绪值', '加权计分', '记录数', '积极命中', '消极命中', '主导词'] as const

/** 日粒度 CSV。情绪值保留 4 位小数，便于二次统计分析。 */
export function buildDailyCsv(days: DailyMood[]): string {
  const rows: string[] = [CSV_HEADER.join(',')]
  for (const day of days) {
    const topWords = day.topWords.map((item) => `${item.word}(${item.count})`).join(' | ')
    rows.push(
      [
        day.date,
        day.score.toFixed(4),
        day.raw.toFixed(2),
        String(day.messageCount),
        String(day.positiveHits),
        String(day.negativeHits),
        csvEscape(topWords),
      ].join(','),
    )
  }
  // BOM 让 Excel 正确识别 UTF-8；CRLF 是 RFC 4180 的换行约定
  return `\uFEFF${rows.join('\r\n')}\r\n`
}

/* -------------------------------------------------------------------------- */
/* JSON 备份                                                                   */
/* -------------------------------------------------------------------------- */

export function buildBackupJson(params: {
  meta: Pick<DatasetMeta, 'name' | 'encoding' | 'savedAt' | 'dayCount' | 'messageCount'>
  text: string
  report: ParseReport | null
  days: DailyMood[]
  /** 全量日数据；提供时区间对比从全量切窗口，否则退回本区间前后半段对比 */
  allDays?: DailyMood[]
  exportedAt?: Date
}): string {
  const { meta, text, report, days } = params
  const overview = buildOverview(days)
  const messages = days.flatMap((day) => day.messages)
  const payload = {
    app: 'NeuroTide' as const,
    version: 1 as const,
    exportedAt: (params.exportedAt ?? new Date()).toISOString(),
    dataset: meta,
    rawText: text,
    report,
    scoring: {
      dictionary: 'lexicon-v2（权重 + 否定 + 程度副词）',
      messageScore: 'tanh(raw / 1.5)',
      dailyScore: '各条 messageScore 的算术平均（绝对量纲）',
      neutralBand: NEUTRAL_BAND,
    },
    overview: {
      totalDays: overview.totalDays,
      messageCount: overview.messageCount,
      averageScore: Number(overview.averageScore.toFixed(4)),
      bestDay: overview.bestDay
        ? { date: overview.bestDay.date, score: Number(overview.bestDay.score.toFixed(4)) }
        : null,
      worstDay: overview.worstDay
        ? { date: overview.worstDay.date, score: Number(overview.worstDay.score.toFixed(4)) }
        : null,
    },
    // 分析摘要：趋势 / 连续区间 / 星期×时段 / 词云 / 区间对比。
    // 只存结果不存渲染，纯数据，便于二次分析。
    analysis: buildInsightSummary(days, messages, { allDays: params.allDays }),
    daily: days.map((day) => ({
      date: day.date,
      score: Number(day.score.toFixed(4)),
      raw: Number(day.raw.toFixed(2)),
      messageCount: day.messageCount,
      positiveHits: day.positiveHits,
      negativeHits: day.negativeHits,
      topWords: day.topWords.map((item) => ({ word: item.word, count: item.count, positive: item.positive })),
    })),
  }
  return JSON.stringify(payload, null, 2)
}

export interface ParsedBackup {
  name: string
  encoding: string
  text: string
  dayCount: number
  messageCount: number
}

/**
 * 识别本应用导出的 JSON 备份并取出原始文本，用于重新导入。
 * 返回 null 表示不是本应用的备份，调用方应回退到常规聊天记录解析。
 */
export function parseBackupJson(source: string): ParsedBackup | null {
  const trimmed = source.trim()
  // 先做廉价前缀检查，避免对任意 TXT 都执行 JSON.parse
  if (!trimmed.startsWith('{') || !/"app"\s*:\s*"NeuroTide"/.test(trimmed)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const payload = parsed as Partial<BackupPayload>
  if (payload.app !== 'NeuroTide' || typeof payload.rawText !== 'string') return null
  const dataset = payload.dataset
  return {
    name: dataset && typeof dataset.name === 'string' && dataset.name ? `${dataset.name}（备份）` : 'NeuroTide 备份',
    encoding: dataset && typeof dataset.encoding === 'string' ? dataset.encoding : '备份还原',
    text: payload.rawText,
    dayCount: dataset && typeof dataset.dayCount === 'number' ? dataset.dayCount : 0,
    messageCount: dataset && typeof dataset.messageCount === 'number' ? dataset.messageCount : 0,
  }
}
