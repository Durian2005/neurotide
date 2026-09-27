// 本地情绪词典引擎：纯浏览器端计算，零外部依赖
// 计分规则：命中积极词 +1，命中消极词 -1，未命中 0

export interface MessageSentiment {
  /** 命中的积极词（去重，按出现顺序） */
  positiveWords: string[]
  /** 命中的消极词（去重，按出现顺序） */
  negativeWords: string[]
  /** 命中计分：积极词数 - 消极词数 */
  raw: number
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

/** 仅对当前截图 OCR 输出的文字做汇总，不构造日期或坐标信息。 */
export function analyzeScreenshotText(text: string): ScreenshotSentiment {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0]+/g, ' ')
  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-—·•]|\d{1,2}:\d{2})\s*/, '').trim())
    .filter(Boolean)
  const positiveWords = lines.flatMap((line) => analyzeText(line).positiveWords)
  const negativeWords = lines.flatMap((line) => analyzeText(line).negativeWords)
  const raw = positiveWords.length - negativeWords.length
  const score = positiveWords.length + negativeWords.length === 0
    ? 0
    : raw / (positiveWords.length + negativeWords.length)

  return {
    text: normalized.trim(),
    positiveWords: [...new Set(positiveWords)],
    negativeWords: [...new Set(negativeWords)],
    positiveHitCount: positiveWords.length,
    negativeHitCount: negativeWords.length,
    raw,
    score,
    label: score >= 0.12 ? 'positive' : score <= -0.12 ? 'negative' : 'neutral',
  }
}

// 积极词典（60 词）
const POSITIVE_WORDS: string[] = [
  '开心', '快乐', '高兴', '兴奋', '幸福', '喜悦', '满足', '喜欢', '爱', '温暖',
  '感动', '感激', '感谢', '谢谢', '期待', '希望', '惊喜', '完美', '精彩', '优秀',
  '顺利', '成功', '加油', '轻松', '放松', '安心', '舒服', '美好', '温柔', '甜蜜',
  '愉快', '欢乐', '哈哈', '治愈', '值得', '幸运', '骄傲', '充实', '自由', '踏实',
  '元气', '阳光', '惬意', '舒心', '欣慰', '顺畅', '给力', '厉害', '不错', '挺好',
  '好棒', '美景', '开怀', '称心', '欣喜', '欢欣', '回味', '积极', '乐观', '神清气爽',
]

// 消极词典（60 词）
const NEGATIVE_WORDS: string[] = [
  '难过', '悲伤', '伤心', '失落', '沮丧', '痛苦', '绝望', '孤独', '遗憾', '委屈',
  '郁闷', '低落', '心碎', '难受', '疲惫', '无聊', '糟糕', '愤怒', '生气', '气愤',
  '讨厌', '烦躁', '恼火', '恶心', '抓狂', '可恶', '焦虑', '紧张', '害怕', '担心',
  '恐惧', '压力', '不安', '崩溃', '恐慌', '哭', '眼泪', '失眠', '熬夜', '累',
  '丧', '恨', '倒霉', '失败', '打击', '争吵', '吵架', '分手', '失去', '错过',
  '后悔', '抱歉', '对不起', '内疚', '自责', '无力', '迷茫', '困惑', '无助', '闷闷不乐',
]

export const DICTIONARY_SIZE: { positive: number; negative: number } = {
  positive: POSITIVE_WORDS.length,
  negative: NEGATIVE_WORDS.length,
}

// 命中词典：返回该条文本命中的积极/消极词与计分
export function analyzeText(content: string): MessageSentiment {
  const positiveWords: string[] = []
  for (const word of POSITIVE_WORDS) {
    if (content.includes(word)) positiveWords.push(word)
  }

  const negativeWords: string[] = []
  for (const word of NEGATIVE_WORDS) {
    if (content.includes(word)) negativeWords.push(word)
  }

  return { positiveWords, negativeWords, raw: positiveWords.length - negativeWords.length }
}

// 单条消息的展示用分值：压缩到 [-1, 1]，用于折线微缩图
export function messageScore(raw: number): number {
  return Math.tanh(raw / 1.5)
}

// 情绪分档，决定热力图配色
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