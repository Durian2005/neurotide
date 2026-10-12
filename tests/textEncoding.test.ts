import { describe, expect, it } from 'vitest'
import { decodeTextBuffer } from '../src/utils/textEncoding'

// 中文 Windows 导出的聊天记录常见 GBK，直接按 UTF-8 读会整篇乱码。

function bytesOf(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

describe('编码探测与回退', () => {
  it('UTF-8 BOM', () => {
    const result = decodeTextBuffer(bytesOf(0xef, 0xbb, 0xbf, 0x61, 0x62))
    expect(result.text).toBe('ab')
    expect(result.encoding).toBe('UTF-8 (BOM)')
  })

  it('UTF-8 无 BOM', () => {
    expect(decodeTextBuffer(bytesOf(0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87)).text).toBe('中文')
  })

  it('GBK 字节序列回退解码', () => {
    const result = decodeTextBuffer(bytesOf(0xd6, 0xd0, 0xce, 0xc4))
    expect(result.text).toBe('中文')
    expect(result.encoding).toBe('GBK / GB18030')
  })

  it('UTF-16LE BOM', () => {
    const result = decodeTextBuffer(bytesOf(0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65))
    expect(result.text).toBe('中文')
    expect(result.encoding).toBe('UTF-16LE')
  })

  it('UTF-16BE BOM', () => {
    const result = decodeTextBuffer(bytesOf(0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87))
    expect(result.text).toBe('中文')
    expect(result.encoding).toBe('UTF-16BE')
  })

  it('空缓冲不抛错', () => {
    const result = decodeTextBuffer(new ArrayBuffer(0))
    expect(result.text).toBe('')
    expect(result.encoding).toBe('UTF-8')
  })

  it('解码结果可直接喂给解析器（GBK 记录不再整篇失败）', () => {
    // 「[2026-09-26 08:12:00] 我: 开心」的 GBK 字节
    const gbk = new Uint8Array([
      0x5b, 0x32, 0x30, 0x32, 0x36, 0x2d, 0x30, 0x39, 0x2d, 0x32, 0x36, 0x20, 0x30, 0x38, 0x3a, 0x31, 0x32, 0x3a, 0x30,
      0x30, 0x5d, 0x20, 0xce, 0xd2, 0x3a, 0x20, 0xbf, 0xaa, 0xd0, 0xc4,
    ])
    const { text, encoding } = decodeTextBuffer(gbk.buffer as ArrayBuffer)
    expect(encoding).toBe('GBK / GB18030')
    expect(text).toBe('[2026-09-26 08:12:00] 我: 开心')
  })
})
