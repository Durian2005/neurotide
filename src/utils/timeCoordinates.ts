import { analyzeText, messageScore, moodLevel } from './sentiment'

export interface TimeCoordinate {
  id: string
  time: string
  minutes: number
  text: string
  score: number
  level: 'positive' | 'neutral' | 'negative'
}

export interface TimeCoordinateParseResult {
  points: TimeCoordinate[]
  errors: string[]
  format: 'txt' | 'csv' | 'json'
}

function parseClock(value: unknown): { time: string; minutes: number } | null {
  const source = String(value ?? '').trim()
  const match = source.match(/(?:T|\s|^|\[)(\d{1,2}):(\d{2})(?::\d{2})?(?:\]|\s|$)/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return {
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    minutes: hours * 60 + minutes,
  }
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"')
  }
  return trimmed
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells.map(stripOuterQuotes)
}


function parseJson(source: string): Array<{ time: unknown; text: unknown }> {
  const parsed: unknown = JSON.parse(source)
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { points?: unknown }).points)
      ? (parsed as { points: unknown[] }).points
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : []

  return records.flatMap((record) => {
    if (typeof record === 'string') return [{ time: '', text: record }]
    if (!record || typeof record !== 'object') return []
    const item = record as Record<string, unknown>
    return [{
      time: item.time ?? item.timestamp ?? item.datetime ?? item.date,
      text: item.text ?? item.content ?? item.message ?? item.value,
    }]
  })
}

function parseRecords(source: string, format: TimeCoordinateParseResult['format']): Array<{ time: unknown; text: unknown }> {
  if (format === 'json') return parseJson(source)
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  if (format === 'csv') {
    const rows = lines.map(splitCsvLine)
    const header = rows[0]?.map((cell) => cell.toLowerCase()) ?? []
    const timeIndex = header.findIndex((cell) => /time|时间|timestamp|时刻/.test(cell))
    const textIndex = header.findIndex((cell) => /text|内容|message|消息|value/.test(cell))
    const hasHeader = timeIndex >= 0 || textIndex >= 0
    return rows.slice(hasHeader ? 1 : 0).map((row) => ({
      time: row[hasHeader && timeIndex >= 0 ? timeIndex : 0],
      text: row[hasHeader && textIndex >= 0 ? textIndex : 1] ?? row.slice(1).join(', '),
    }))
  }
  return lines.map((line) => {
    const matched = line.match(/^\[?((?:\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T])?\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[,，;；\t|]\s*|\s+)(.+)$/)
    return matched ? { time: matched[1], text: matched[2] } : { time: '', text: '' }
  })
}

export function parseTimeCoordinates(source: string, fileName = ''): TimeCoordinateParseResult {
  const trimmed = source.trim()
  const lowerName = fileName.toLowerCase()
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[{') || trimmed.startsWith('["')
  const format: TimeCoordinateParseResult['format'] = lowerName.endsWith('.json') || looksLikeJson
    ? 'json'
    : lowerName.endsWith('.csv') || source.split(/\r?\n/)[0]?.includes(',')
      ? 'csv'
      : 'txt'
  const records = parseRecords(trimmed, format)
  const errors: string[] = []
  const points: TimeCoordinate[] = []

  records.forEach((record, index) => {
    const clock = parseClock(record.time)
    const text = String(record.text ?? '').trim()
    if (!clock || !text) {
      errors.push(`第 ${index + 1} 行缺少有效时间或文本`)
      return
    }
    const pointSentiment = analyzeCoordinateText(text)
    points.push({
      id: `${clock.time}-${index}`,
      time: clock.time,
      minutes: clock.minutes,
      text,
      score: pointSentiment.score,
      level: pointSentiment.level,
    })
  })

  points.sort((a, b) => a.minutes - b.minutes)
  return { points, errors, format }
}

function analyzeCoordinateText(text: string): { score: number; level: TimeCoordinate['level'] } {
  const sentiment = analyzeText(text)
  const score = messageScore(sentiment.raw)
  return { score, level: moodLevel(score) }
}

export function formatCoordinateExample(): string {
  return '[08:30] 今天心情很开心\n[12:45] 工作有点压力\n[19:20] 晚上感觉轻松'
}
