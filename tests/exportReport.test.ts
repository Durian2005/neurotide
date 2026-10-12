import { describe, expect, it } from 'vitest'
import { buildBackupJson, buildDailyCsv, csvEscape, parseBackupJson, safeFileName } from '../src/utils/exportReport'
import { parseChatLog } from '../src/utils/parser'

const CHAT = [
  '[2026-09-01 08:00:00] 我: 今天很开心，天气很好',
  '[2026-09-02 09:30:00] 我: 有点累，压力不小',
  '[2026-09-02 20:10:00] 我: 还是挺好的',
].join('\n')

const result = parseChatLog(CHAT)
const meta = {
  name: '聊天记录',
  encoding: 'UTF-8',
  savedAt: 1_700_000_000_000,
  dayCount: result.days.length,
  messageCount: result.messages.length,
}

describe('csvEscape', () => {
  it('普通文本不加引号', () => {
    expect(csvEscape('开心')).toBe('开心')
  })

  it('含逗号时加引号', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  it('内部引号翻倍', () => {
    expect(csvEscape('a"b')).toBe('"a""b"')
  })

  it('含换行时加引号', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
})

describe('buildDailyCsv', () => {
  const csv = buildDailyCsv(result.days)

  it('以 BOM 开头，保证 Excel 正确识别 UTF-8', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
  })

  it('使用 CRLF 换行并保留结尾换行', () => {
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.slice(1).includes('\r\n')).toBe(true)
  })

  it('首行是表头', () => {
    const header = csv.replace('\uFEFF', '').split('\r\n')[0]
    expect(header).toBe('日期,情绪值,加权计分,记录数,积极命中,消极命中,主导词')
  })

  it('每天一行，情绪值保留 4 位小数', () => {
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(lines).toHaveLength(result.days.length + 1)
    const cells = lines[1].split(',')
    expect(cells[0]).toBe('2026-09-01')
    expect(cells[1]).toMatch(/^-?\d+\.\d{4}$/)
  })

  it('主导词以「词(次数)」形式汇总', () => {
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(lines[1]).toMatch(/\(1\)|\(2\)/)
  })

  it('无数据时只输出表头', () => {
    const empty = buildDailyCsv([])
    expect(empty.replace('\uFEFF', '').trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('JSON 备份往返', () => {
  const json = buildBackupJson({
    meta,
    text: CHAT,
    report: result.report,
    days: result.days,
    exportedAt: new Date(2026, 9, 11, 11, 30),
  })

  it('写入了可识别的应用标记与原始文本', () => {
    const parsed = JSON.parse(json) as { app: string; rawText: string; version: number }
    expect(parsed.app).toBe('NeuroTide')
    expect(parsed.version).toBe(1)
    expect(parsed.rawText).toBe(CHAT)
  })

  it('记录了计分口径，便于日后核对数值含义', () => {
    const parsed = JSON.parse(json) as { scoring: { messageScore: string; neutralBand: number } }
    expect(parsed.scoring.messageScore).toContain('tanh')
    expect(parsed.scoring.neutralBand).toBeGreaterThan(0)
  })

  it('日粒度数据与解析结果一致', () => {
    const parsed = JSON.parse(json) as { daily: Array<{ date: string; score: number }> }
    expect(parsed.daily).toHaveLength(result.days.length)
    expect(parsed.daily[0].date).toBe(result.days[0].date)
    expect(parsed.daily[0].score).toBeCloseTo(result.days[0].score, 4)
  })

  it('可被重新解析还原出原文', () => {
    const restored = parseBackupJson(json)
    expect(restored).not.toBeNull()
    expect(restored?.text).toBe(CHAT)
    expect(restored?.name).toBe('聊天记录（备份）')
    expect(restored?.encoding).toBe('UTF-8')
    expect(restored?.dayCount).toBe(result.days.length)
  })

  it('还原出的文本能被再次解析成同样的结果', () => {
    const restored = parseBackupJson(json)
    const again = parseChatLog(restored!.text)
    expect(again.days.map((day) => day.score)).toEqual(result.days.map((day) => day.score))
  })
})

describe('parseBackupJson 的拒绝路径', () => {
  it('普通聊天记录不会被误判', () => {
    expect(parseBackupJson(CHAT)).toBeNull()
  })

  it('无关 JSON 不会被误判', () => {
    expect(parseBackupJson('{"points":[{"time":"08:30","text":"很好"}]}')).toBeNull()
  })

  it('缺少 rawText 的备份会被拒绝', () => {
    expect(parseBackupJson('{"app":"NeuroTide","version":1}')).toBeNull()
  })

  it('标记正确但 JSON 语法损坏时不会抛异常', () => {
    expect(parseBackupJson('{"app":"NeuroTide", rawText: ')).toBeNull()
  })

  it('空字符串安全返回 null', () => {
    expect(parseBackupJson('')).toBeNull()
  })
})

describe('safeFileName', () => {
  it('去掉扩展名', () => {
    expect(safeFileName('聊天记录.txt')).toBe('聊天记录')
  })

  it('替换非法字符并把空白转成连字符', () => {
    expect(safeFileName('a b/c:d.txt')).toBe('a-b_c_d')
  })

  it('空名称回退为默认值', () => {
    expect(safeFileName('')).toBe('neurotide')
    expect(safeFileName('.txt')).toBe('neurotide')
  })

  it('过长名称会被截断', () => {
    expect(safeFileName('长'.repeat(200))).toHaveLength(60)
  })
})
