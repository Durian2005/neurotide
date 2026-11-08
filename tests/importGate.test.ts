import { describe, expect, it } from 'vitest'
import { createImportGate } from '../src/utils/importGate'

// 并发导入的回归测试：分片解析期间再导入一份文件时，旧请求必须彻底作废。
// 真实场景在 App 里，这里钉住的是它依赖的那份并发契约。

describe('导入请求门', () => {
  it('同一时刻只有最新请求是 current', () => {
    const gate = createImportGate()
    const first = gate.begin()
    expect(first.isCurrent()).toBe(true)

    const second = gate.begin()
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    expect(second.id).toBeGreaterThan(first.id)
  })

  it('新请求会 abort 旧请求，但不会 abort 自己', () => {
    const gate = createImportGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('连续多次导入后，除最后一个外全部失效且全部收到 abort', () => {
    const gate = createImportGate()
    const requests = Array.from({ length: 5 }, () => gate.begin())

    expect(requests.filter((request) => request.isCurrent())).toHaveLength(1)
    expect(requests.at(-1)?.isCurrent()).toBe(true)
    expect(requests.slice(0, -1).every((request) => request.signal.aborted)).toBe(true)
    expect(requests.at(-1)?.signal.aborted).toBe(false)
  })

  it('currentId 随 begin 单调递增，过期写入可据此识别', () => {
    const gate = createImportGate()
    const first = gate.begin()
    expect(gate.currentId()).toBe(first.id)

    const second = gate.begin()
    expect(gate.currentId()).toBe(second.id)
    expect(gate.currentId()).not.toBe(first.id)
  })

  it('外部 abort 取消当前请求，但不影响后续新请求', () => {
    const gate = createImportGate()
    const first = gate.begin()
    gate.abort()
    expect(first.signal.aborted).toBe(true)

    const second = gate.begin()
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('不同门之间互不干扰', () => {
    const one = createImportGate()
    const two = createImportGate()
    const first = one.begin()
    two.begin()

    expect(first.isCurrent()).toBe(true)
    expect(first.signal.aborted).toBe(false)
  })
})
