// 本地情绪词典引擎 v2：纯浏览器端计算，零外部依赖
//
// 计分模型（相比 v1 的四处修正）：
// 1. 每个词条带「极性 + 权重」，不再是命中即 ±1；
// 2. 识别否定词（不 / 没 / 无 …），命中后翻转极性并乘衰减系数；
// 3. 识别程度副词（非常 / 很 / 有点 …），按倍数放大或削弱权重；
// 4. 最长匹配优先 + 邻接屏蔽，修掉「积累」「可爱」这类子串误命中。
//
// 归一化口径：单条文本先压缩到 [-1, 1]（messageScore），
// 多条目聚合时取平均（aggregateScore），因此日期、截图、时间坐标三个模式共用同一把尺子。

export interface TextSpan {
  /** 原文起始下标 */
  start: number
  /** 原文结束下标（不含） */
  end: number
  polarity: 1 | -1
}

export interface SentimentHit extends TextSpan {
  /** 命中的词典词条 */
  word: string
  /** 实际匹配到的原文片段（含被识别出的否定词），用于原文高亮 */
  surface: string
  /** 生效权重 = 词条权重 × 程度修饰 × 否定衰减 */
  weight: number
  negated: boolean
}

export interface MessageSentiment {
  /** 命中的积极词（去重，按出现顺序） */
  positiveWords: string[]
  /** 命中的消极词（去重，按出现顺序） */
  negativeWords: string[]
  /** 加权计分：Σ(极性 × 生效权重) */
  raw: number
  /** 逐条命中明细，供高亮与解释使用 */
  hits: SentimentHit[]
}

export interface ScreenshotSentiment extends MessageSentiment {
  /** 当前图片识别到的原始文本行 */
  text: string
  /** 单图归一化分值，范围 [-1, 1] */
  score: number
  /** 情绪词命中次数，重复出现在不同文本行时分别计数 */
  positiveHitCount: number
  negativeHitCount: number
  /** 词典规则识别出的词汇，不代表临床结论 */
  label: 'positive' | 'neutral' | 'negative'
}

// ---------------------------------------------------------------------------
// 词典数据
// ---------------------------------------------------------------------------

interface Lexeme {
  word: string
  polarity: 1 | -1
  /** 强度基准，1 为普通词 */
  weight: number
  /** 若紧邻的前一个字在此串中，则视为构词的一部分（如「积累」里的「累」） */
  blockBefore?: string
  /** 若紧邻的后一个字在此串中，则跳过 */
  blockAfter?: string
}

const POSITIVE_LEXEMES: Lexeme[] = [
  { word: '开心', polarity: 1, weight: 1.2 },
  { word: '快乐', polarity: 1, weight: 1.2 },
  { word: '高兴', polarity: 1, weight: 1.1 },
  { word: '兴奋', polarity: 1, weight: 1.5 },
  { word: '幸福', polarity: 1, weight: 1.7 },
  { word: '喜悦', polarity: 1, weight: 1.3 },
  { word: '满足', polarity: 1, weight: 1.1 },
  { word: '喜欢', polarity: 1, weight: 1.0 },
  // 「爱」是单字词条：屏蔽「爱好 / 爱国 / 爱将」这类中性构词
  { word: '爱', polarity: 1, weight: 0.9, blockAfter: '好国将' },
  { word: '温暖', polarity: 1, weight: 1.1 },
  { word: '感动', polarity: 1, weight: 1.3 },
  { word: '感激', polarity: 1, weight: 1.2 },
  { word: '感谢', polarity: 1, weight: 1.1 },
  { word: '谢谢', polarity: 1, weight: 1.0 },
  { word: '期待', polarity: 1, weight: 1.0 },
  { word: '希望', polarity: 1, weight: 1.0 },
  { word: '惊喜', polarity: 1, weight: 1.6 },
  { word: '完美', polarity: 1, weight: 1.6 },
  { word: '精彩', polarity: 1, weight: 1.5 },
  { word: '优秀', polarity: 1, weight: 1.2 },
  { word: '顺利', polarity: 1, weight: 1.0 },
  { word: '成功', polarity: 1, weight: 1.2 },
  { word: '加油', polarity: 1, weight: 1.0 },
  { word: '轻松', polarity: 1, weight: 1.2 },
  { word: '放松', polarity: 1, weight: 1.1 },
  { word: '安心', polarity: 1, weight: 1.1 },
  { word: '舒服', polarity: 1, weight: 1.2 },
  { word: '美好', polarity: 1, weight: 1.3 },
  { word: '温柔', polarity: 1, weight: 1.1 },
  { word: '甜蜜', polarity: 1, weight: 1.4 },
  { word: '愉快', polarity: 1, weight: 1.2 },
  { word: '欢乐', polarity: 1, weight: 1.3 },
  { word: '哈哈', polarity: 1, weight: 1.2 },
  { word: '治愈', polarity: 1, weight: 1.4 },
  { word: '值得', polarity: 1, weight: 1.0 },
  { word: '幸运', polarity: 1, weight: 1.3 },
  { word: '骄傲', polarity: 1, weight: 1.4 },
  { word: '充实', polarity: 1, weight: 1.1 },
  { word: '自由', polarity: 1, weight: 1.0 },
  { word: '踏实', polarity: 1, weight: 1.0 },
  { word: '元气', polarity: 1, weight: 1.2 },
  { word: '阳光', polarity: 1, weight: 0.8 },
  { word: '惬意', polarity: 1, weight: 1.2 },
  { word: '舒心', polarity: 1, weight: 1.2 },
  { word: '顺心', polarity: 1, weight: 1.1 },
  { word: '欣慰', polarity: 1, weight: 1.2 },
  { word: '顺畅', polarity: 1, weight: 1.0 },
  { word: '给力', polarity: 1, weight: 1.2 },
  { word: '厉害', polarity: 1, weight: 1.0 },
  { word: '圆满', polarity: 1, weight: 1.4 },
  { word: '不错', polarity: 1, weight: 0.8 },
  { word: '挺好', polarity: 1, weight: 0.8 },
  { word: '好棒', polarity: 1, weight: 1.4 },
  { word: '棒', polarity: 1, weight: 0.9, blockAfter: '球' },
  { word: '爽', polarity: 1, weight: 1.2, blockAfter: '约' },
  { word: '美景', polarity: 1, weight: 0.7 },
  { word: '开怀', polarity: 1, weight: 1.4 },
  { word: '称心', polarity: 1, weight: 1.2 },
  { word: '欣喜', polarity: 1, weight: 1.3 },
  { word: '欢欣', polarity: 1, weight: 1.3 },
  { word: '回味', polarity: 1, weight: 0.8 },
  { word: '积极', polarity: 1, weight: 0.9 },
  { word: '乐观', polarity: 1, weight: 1.0 },
  { word: '神清气爽', polarity: 1, weight: 1.6 },
  // 表情符号（聊天记录里高频，且天然带极性）
  { word: '😊', polarity: 1, weight: 1.2 },
  { word: '😄', polarity: 1, weight: 1.2 },
  { word: '😁', polarity: 1, weight: 1.2 },
  { word: '🥰', polarity: 1, weight: 1.4 },
  { word: '😍', polarity: 1, weight: 1.4 },
  { word: '🤩', polarity: 1, weight: 1.4 },
  { word: '🥳', polarity: 1, weight: 1.5 },
  { word: '😌', polarity: 1, weight: 1.0 },
  { word: '❤️', polarity: 1, weight: 1.3 },
  { word: '💕', polarity: 1, weight: 1.3 },
  { word: '🎉', polarity: 1, weight: 1.4 },
  { word: '👍', polarity: 1, weight: 1.1 },
  { word: '✨', polarity: 1, weight: 0.9 },
]

const NEGATIVE_LEXEMES: Lexeme[] = [
  { word: '难过', polarity: -1, weight: 1.3 },
  { word: '悲伤', polarity: -1, weight: 1.6 },
  { word: '伤心', polarity: -1, weight: 1.5 },
  { word: '失落', polarity: -1, weight: 1.2 },
  { word: '沮丧', polarity: -1, weight: 1.5 },
  { word: '痛苦', polarity: -1, weight: 1.7 },
  { word: '绝望', polarity: -1, weight: 1.9 },
  { word: '孤独', polarity: -1, weight: 1.3 },
  { word: '遗憾', polarity: -1, weight: 1.0 },
  { word: '委屈', polarity: -1, weight: 1.3 },
  { word: '郁闷', polarity: -1, weight: 1.2 },
  { word: '低落', polarity: -1, weight: 1.2 },
  { word: '心碎', polarity: -1, weight: 1.8 },
  { word: '难受', polarity: -1, weight: 1.3 },
  { word: '疲惫', polarity: -1, weight: 1.3 },
  { word: '无聊', polarity: -1, weight: 0.8 },
  { word: '糟糕', polarity: -1, weight: 1.4 },
  { word: '愤怒', polarity: -1, weight: 1.6 },
  { word: '生气', polarity: -1, weight: 1.3 },
  { word: '气愤', polarity: -1, weight: 1.4 },
  { word: '讨厌', polarity: -1, weight: 1.3 },
  { word: '烦躁', polarity: -1, weight: 1.4 },
  { word: '烦', polarity: -1, weight: 0.9 },
  { word: '麻烦', polarity: -1, weight: 1.0 },
  { word: '恼火', polarity: -1, weight: 1.5 },
  { word: '恶心', polarity: -1, weight: 1.5 },
  { word: '抓狂', polarity: -1, weight: 1.6 },
  { word: '可恶', polarity: -1, weight: 1.3 },
  { word: '焦虑', polarity: -1, weight: 1.5 },
  { word: '紧张', polarity: -1, weight: 1.1 },
  { word: '害怕', polarity: -1, weight: 1.4 },
  { word: '担心', polarity: -1, weight: 1.1 },
  { word: '恐惧', polarity: -1, weight: 1.7 },
  { word: '压力', polarity: -1, weight: 1.2 },
  { word: '不安', polarity: -1, weight: 1.4 },
  { word: '崩溃', polarity: -1, weight: 1.9 },
  { word: '恐慌', polarity: -1, weight: 1.7 },
  { word: '哭', polarity: -1, weight: 1.3 },
  { word: '眼泪', polarity: -1, weight: 1.2 },
  { word: '失眠', polarity: -1, weight: 1.3 },
  { word: '熬夜', polarity: -1, weight: 0.9 },
  { word: '头疼', polarity: -1, weight: 1.1 },
  { word: '心累', polarity: -1, weight: 1.4 },
  // 「累」是单字词条，必须屏蔽「积累 / 累加 / 劳累 / 拖累」等构词
  { word: '累', polarity: -1, weight: 1.0, blockBefore: '积劳连拖牵受赘疲', blockAfter: '计加及积进次赘' },
  { word: '丧', polarity: -1, weight: 0.9 },
  { word: '恨', polarity: -1, weight: 1.4 },
  { word: '倒霉', polarity: -1, weight: 1.5 },
  { word: '失败', polarity: -1, weight: 1.3 },
  { word: '打击', polarity: -1, weight: 1.3 },
  { word: '争吵', polarity: -1, weight: 1.4 },
  { word: '吵架', polarity: -1, weight: 1.4 },
  { word: '分手', polarity: -1, weight: 1.8 },
  { word: '失去', polarity: -1, weight: 1.4 },
  { word: '错过', polarity: -1, weight: 1.1 },
  { word: '后悔', polarity: -1, weight: 1.4 },
  { word: '抱歉', polarity: -1, weight: 1.0 },
  { word: '对不起', polarity: -1, weight: 1.0 },
  { word: '内疚', polarity: -1, weight: 1.5 },
  { word: '自责', polarity: -1, weight: 1.5 },
  { word: '无力', polarity: -1, weight: 1.3 },
  { word: '迷茫', polarity: -1, weight: 1.2 },
  { word: '困惑', polarity: -1, weight: 1.0 },
  { word: '无助', polarity: -1, weight: 1.5 },
  { word: '闷闷不乐', polarity: -1, weight: 1.4 },
  { word: '😢', polarity: -1, weight: 1.2 },
  { word: '😭', polarity: -1, weight: 1.6 },
  { word: '😞', polarity: -1, weight: 1.3 },
  { word: '😔', polarity: -1, weight: 1.2 },
  { word: '😩', polarity: -1, weight: 1.3 },
  { word: '😫', polarity: -1, weight: 1.4 },
  { word: '😖', polarity: -1, weight: 1.4 },
  { word: '😡', polarity: -1, weight: 1.7 },
  { word: '😤', polarity: -1, weight: 1.4 },
  { word: '🤯', polarity: -1, weight: 1.4 },
  { word: '😰', polarity: -1, weight: 1.5 },
  { word: '💔', polarity: -1, weight: 1.7 },
]

const LEXICON: Lexeme[] = [...POSITIVE_LEXEMES, ...NEGATIVE_LEXEMES]

// 程度副词：按倍数放大/削弱后接词条的权重（长词优先匹配）
const DEGREE_TOKENS: Array<{ token: string; factor: number }> = [
  { token: '极其', factor: 1.8 },
  { token: '极度', factor: 1.8 },
  { token: '超级', factor: 1.7 },
  { token: '特别', factor: 1.6 },
  { token: '非常', factor: 1.6 },
  { token: '十分', factor: 1.5 },
  { token: '格外', factor: 1.5 },
  { token: '相当', factor: 1.4 },
  { token: '真的', factor: 1.3 },
  { token: '有点', factor: 0.6 },
  { token: '有些', factor: 0.65 },
  { token: '稍微', factor: 0.5 },
  { token: '略微', factor: 0.5 },
  { token: '一丝', factor: 0.6 },
  { token: '一点', factor: 0.65 },
  { token: '太', factor: 1.5 },
  { token: '超', factor: 1.5 },
  { token: '贼', factor: 1.5 },
  { token: '巨', factor: 1.4 },
  { token: '最', factor: 1.6 },
  { token: '很', factor: 1.3 },
  { token: '真', factor: 1.3 },
  { token: '好', factor: 1.2 },
  { token: '挺', factor: 1.1 },
].toSorted((a, b) => b.token.length - a.token.length)

// 否定词：翻转极性（长词优先匹配）
const NEGATION_TOKENS: string[] = [
  '不怎么',
  '毫无',
  '没有',
  '不再',
  '不用',
  '不太',
  '不算',
  '不要',
  '不',
  '没',
  '无',
  '别',
  '未',
  '非',
].toSorted((a, b) => b.length - a.length)

/** 否定作用域内允许出现的透明字（不阻断否定传播，例如「不是很开心」） */
const FILLER_CHARS = new Set([
  '是',
  '的',
  '么',
  '怎',
  '那',
  '这',
  '会',
  '要',
  '能',
  '有',
  '所',
  '还',
  '算',
  ' ',
  '\u3000',
])

/** 命中否定后权重的衰减系数：否定通常弱于直接表述 */
const NEGATION_DECAY = 0.6

/** 否定作用域的最大回溯步数 */
const MODIFIER_WINDOW = 4

export const DICTIONARY_SIZE: { positive: number; negative: number } = {
  positive: POSITIVE_LEXEMES.length,
  negative: NEGATIVE_LEXEMES.length,
}

// ---------------------------------------------------------------------------
// 匹配与计分
// ---------------------------------------------------------------------------

function isBlocked(text: string, start: number, end: number, lexeme: Lexeme): boolean {
  if (lexeme.blockBefore && start > 0 && lexeme.blockBefore.includes(text[start - 1])) return true
  if (lexeme.blockAfter && end < text.length && lexeme.blockAfter.includes(text[end])) return true
  return false
}

interface Modifier {
  negated: boolean
  degree: number
  negationStart: number
}

// 向前回溯，识别紧邻的程度副词与否定词
function inspectModifier(text: string, wordStart: number): Modifier {
  let cursor = wordStart
  let negated = false
  let degree = 1
  let negationStart = -1
  let steps = 0

  while (cursor > 0 && steps < MODIFIER_WINDOW) {
    steps++

    let consumed = false
    for (const item of DEGREE_TOKENS) {
      const from = cursor - item.token.length
      if (from >= 0 && text.startsWith(item.token, from)) {
        degree *= item.factor
        cursor = from
        consumed = true
        break
      }
    }
    if (consumed) continue

    for (const token of NEGATION_TOKENS) {
      const from = cursor - token.length
      if (from >= 0 && text.startsWith(token, from)) {
        negated = true
        negationStart = from
        cursor = from
        consumed = true
        break
      }
    }
    if (consumed) break

    if (FILLER_CHARS.has(text[cursor - 1])) {
      cursor--
      continue
    }
    break
  }

  return { negated, degree, negationStart }
}

// 收集全部候选命中，再按「位置升序 + 长度降序」做不重叠筛选，等价于最长匹配优先
function collectHits(text: string): SentimentHit[] {
  const candidates: SentimentHit[] = []

  for (const lexeme of LEXICON) {
    let from = 0
    while (true) {
      const start = text.indexOf(lexeme.word, from)
      if (start === -1) break
      const end = start + lexeme.word.length
      from = end
      if (isBlocked(text, start, end, lexeme)) continue
      candidates.push({
        word: lexeme.word,
        surface: lexeme.word,
        start,
        end,
        polarity: lexeme.polarity,
        weight: lexeme.weight,
        negated: false,
      })
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))

  const accepted: SentimentHit[] = []
  let cursor = 0
  for (const hit of candidates) {
    if (hit.start < cursor) continue
    accepted.push(hit)
    cursor = hit.end
  }

  for (const hit of accepted) {
    const modifier = inspectModifier(text, hit.start)
    if (modifier.degree !== 1) hit.weight *= modifier.degree
    if (modifier.negated) {
      hit.polarity = hit.polarity === 1 ? -1 : 1
      hit.negated = true
      hit.weight *= NEGATION_DECAY
      hit.start = modifier.negationStart
      hit.surface = text.slice(modifier.negationStart, hit.end)
    }
  }

  accepted.sort((a, b) => a.start - b.start)
  return accepted
}

// 命中词典：返回该条文本命中的积极/消极词、加权计分与逐条明细
export function analyzeText(content: string): MessageSentiment {
  const text = content ?? ''
  const hits = collectHits(text)

  const positiveWords: string[] = []
  const negativeWords: string[] = []
  let raw = 0

  for (const hit of hits) {
    raw += hit.polarity * hit.weight
    const bucket = hit.polarity === 1 ? positiveWords : negativeWords
    if (!bucket.includes(hit.word)) bucket.push(hit.word)
  }

  return { positiveWords, negativeWords, raw, hits }
}

// 单条文本的展示用分值：压缩到 [-1, 1]
export function messageScore(raw: number): number {
  return Math.tanh(raw / 1.5)
}

// 多条文本的聚合分值：先各自压缩再取平均，保证与单条分值同一量纲
export function aggregateScore(rawValues: number[]): number {
  if (rawValues.length === 0) return 0
  let sum = 0
  for (const raw of rawValues) sum += messageScore(raw)
  return sum / rawValues.length
}

// ---------------------------------------------------------------------------
// 分档与配色
// ---------------------------------------------------------------------------

export type MoodLevel = 'negative' | 'neutral' | 'positive'

export const NEUTRAL_BAND = 0.12

export function moodLevel(score: number): MoodLevel {
  if (score >= NEUTRAL_BAND) return 'positive'
  if (score <= -NEUTRAL_BAND) return 'negative'
  return 'neutral'
}

// 情绪文案
export function moodLabel(score: number): string {
  const level = moodLevel(score)
  if (level === 'positive') return score >= 0.6 ? '积极' : '偏积极'
  if (level === 'negative') return score <= -0.6 ? '消极' : '偏消极'
  return '中性'
}

// 三档配色（heatmap 与 UI 共用同一套色值）
export const MOOD_HEX: Record<MoodLevel, string> = {
  negative: '#1e3a8a',
  neutral: '#334155',
  positive: '#22d3ee',
}

export const MOOD_TEXT_CLASS: Record<MoodLevel, string> = {
  positive: 'text-cyan-300',
  neutral: 'text-slate-300',
  negative: 'text-blue-300',
}

export const MOOD_DOT_CLASS: Record<MoodLevel, string> = {
  positive: 'bg-cyan-400',
  neutral: 'bg-slate-500',
  negative: 'bg-blue-800',
}

/**
 * 高对比配色（深蓝 #1e3a8a 在 #0f172a 背景上对比度仅约 1.6:1，接近「看不见」）。
 * 保留「蓝=消极 / 青=积极」的语义，只把亮度抬到可辨识区间。
 */
export const MOOD_HEX_HIGH_CONTRAST: Record<MoodLevel, string> = {
  negative: '#60a5fa',
  neutral: '#94a3b8',
  positive: '#67e8f9',
}

/**
 * 情绪方向字形：颜色之外的第二通道，供色觉辅助与高对比模式使用。
 * 用 ASCII 之外的几何字符（而非 ▲▼ 之外的箭头）以便在 10–34px 的格子里也能看清。
 */
export function moodGlyph(score: number): string {
  const level = moodLevel(score)
  if (level === 'positive') return '▲'
  if (level === 'negative') return '▼'
  return '·'
}

/** 仅对当前截图 OCR 输出的文字做汇总，不构造日期或坐标信息。 */
export function analyzeScreenshotText(text: string): ScreenshotSentiment {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0]+/g, ' ')
  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-—·•]|\d{1,2}:\d{2})\s*/, '').trim())
    .filter(Boolean)

  const lineResults = lines.map((line) => analyzeText(line))
  const hits = lineResults.flatMap((result) => result.hits.map((hit) => ({ ...hit })))
  const positiveHits = hits.filter((hit) => hit.polarity === 1).map((hit) => hit.word)
  const negativeHits = hits.filter((hit) => hit.polarity === -1).map((hit) => hit.word)
  const score = aggregateScore(lineResults.map((result) => result.raw))

  return {
    text: normalized.trim(),
    positiveWords: [...new Set(positiveHits)],
    negativeWords: [...new Set(negativeHits)],
    positiveHitCount: positiveHits.length,
    negativeHitCount: negativeHits.length,
    // 与 DailyMood 同构：raw 为加权计分总和，score 为各文本单元分值的平均
    raw: lineResults.reduce((sum, result) => sum + result.raw, 0),
    score,
    label: score >= NEUTRAL_BAND ? 'positive' : score <= -NEUTRAL_BAND ? 'negative' : 'neutral',
    hits,
  }
}
