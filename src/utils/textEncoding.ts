// 文本文件解码：聊天记录导出常见 UTF-8 / UTF-16 / GBK 三种编码，
// 中文 Windows 下 GBK 导出直接按 UTF-8 读会整篇乱码，因此这里做探测与回退。

export interface DecodedText {
  text: string
  /** 人类可读的编码名，用于界面提示 */
  encoding: string
}

/** TextDecoder 对 gbk 的支持并非所有运行时都有，探测一次并缓存 */
let gbkDecoder: TextDecoder | null = null
let gbkProbed = false

function getGbkDecoder(): TextDecoder | null {
  if (!gbkProbed) {
    gbkProbed = true
    try {
      gbkDecoder = new TextDecoder('gbk')
    } catch {
      gbkDecoder = null
    }
  }
  return gbkDecoder
}

function safeDecode(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

export function decodeTextBuffer(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer)

  // 1) BOM 优先
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8 (BOM)' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16LE' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16BE' }
  }

  // 2) 严格 UTF-8：非法字节序列会抛错，以此区分 GBK
  const strictUtf8 = safeDecode(bytes, 'utf-8', true)
  if (strictUtf8 !== null) return { text: strictUtf8, encoding: 'UTF-8' }

  // 3) 回退 GBK / GB18030
  const gbk = getGbkDecoder()
  if (gbk) {
    const decoded = safeDecode(bytes, 'gbk', false)
    if (decoded !== null) return { text: decoded, encoding: 'GBK / GB18030' }
  }

  // 4) 兜底：容错 UTF-8（用替换符标出问题字节）
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8 (容错)' }
}

export async function readTextFile(file: File): Promise<DecodedText> {
  return decodeTextBuffer(await file.arrayBuffer())
}
