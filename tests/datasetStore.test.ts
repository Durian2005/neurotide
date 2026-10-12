import { describe, expect, it } from 'vitest'
import {
  StorageError,
  buildDatasetMeta,
  createDatasetStore,
  createMemoryBackend,
  utf8ByteLength,
} from '../src/utils/datasetStore'
import type { DatasetStore, KvBackend, StoredDataset } from '../src/utils/datasetStore'
import { parseChatLog } from '../src/utils/parser'

const CHAT = [
  '[2026-09-01 08:00:00] 我: 今天很开心，天气很好',
  '[2026-09-02 09:30:00] 我: 有点累，压力不小',
  '[2026-09-02 20:10:00] 我: 还是挺好的',
].join('\n')

function makeStore(backend: KvBackend = createMemoryBackend()): DatasetStore {
  return createDatasetStore(backend)
}

function makeDataset(overrides: Partial<StoredDataset> = {}): StoredDataset {
  const result = parseChatLog(CHAT)
  return {
    ...buildDatasetMeta({
      id: overrides.id ?? 'id-1',
      name: overrides.name ?? '聊天记录',
      encoding: overrides.encoding ?? 'UTF-8',
      text: CHAT,
      result,
      savedAt: overrides.savedAt ?? 1_700_000_000_000,
    }),
    text: CHAT,
    ...overrides,
  }
}

describe('utf8ByteLength', () => {
  it('ASCII 每字符 1 字节', () => {
    expect(utf8ByteLength('abc')).toBe(3)
  })

  it('中日韩字符 3 字节', () => {
    expect(utf8ByteLength('你好')).toBe(6)
  })

  it('补充平面字符（emoji）按 4 字节计', () => {
    expect(utf8ByteLength('😀')).toBe(4)
  })

  it('混合文本逐段累加', () => {
    expect(utf8ByteLength('a你😀')).toBe(1 + 3 + 4)
  })

  it('落单的代理字符按 3 字节容错处理', () => {
    expect(utf8ByteLength('\ud800')).toBe(3)
  })

  it('与 TextEncoder 的结果一致', () => {
    const sample = 'NeuroTide 情绪地图 2026 · 😀😀'
    expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).byteLength)
  })
})

describe('buildDatasetMeta', () => {
  const result = parseChatLog(CHAT)
  const meta = buildDatasetMeta({
    id: 'ds-1',
    name: '我的聊天记录.txt',
    encoding: 'GBK / GB18030',
    text: CHAT,
    result,
    savedAt: 123,
  })

  it('保留标识与来源信息', () => {
    expect(meta.id).toBe('ds-1')
    expect(meta.name).toBe('我的聊天记录.txt')
    expect(meta.encoding).toBe('GBK / GB18030')
    expect(meta.savedAt).toBe(123)
  })

  it('统计天数与条数', () => {
    expect(meta.dayCount).toBe(2)
    expect(meta.messageCount).toBe(3)
  })

  it('记录首尾日期而非解析顺序', () => {
    expect(meta.firstDate).toBe('2026-09-01')
    expect(meta.lastDate).toBe('2026-09-02')
  })

  it('体积按原始文本的 UTF-8 字节数计', () => {
    expect(meta.sizeBytes).toBe(utf8ByteLength(CHAT))
  })

  it('平均情绪值等于各日分值的平均', () => {
    const expected = (result.days[0].score + result.days[1].score) / 2
    expect(meta.averageScore).toBeCloseTo(expected, 10)
  })

  it('空数据集不产生日期', () => {
    const empty = buildDatasetMeta({
      id: 'x',
      name: 'empty',
      encoding: 'UTF-8',
      text: '没有任何有效记录',
      result: parseChatLog('没有任何有效记录'),
    })
    expect(empty.dayCount).toBe(0)
    expect(empty.firstDate).toBeNull()
    expect(empty.lastDate).toBeNull()
  })
})

describe('数据集读写', () => {
  it('保存后可按时间倒序列出', async () => {
    const store = makeStore()
    await store.save(makeDataset({ id: 'a', name: '较早', savedAt: 1000 }))
    await store.save(makeDataset({ id: 'b', name: '较新', savedAt: 2000 }))
    const list = await store.list()
    expect(list.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('载入时能取回原始文本', async () => {
    const store = makeStore()
    await store.save(makeDataset({ id: 'a' }))
    const loaded = await store.load('a')
    expect(loaded?.text).toBe(CHAT)
    expect(loaded?.id).toBe('a')
  })

  it('载入不存在的 id 返回 null', async () => {
    const store = makeStore()
    expect(await store.load('missing')).toBeNull()
  })

  it('同名数据集更新时不会产生第二份', async () => {
    const store = makeStore()
    await store.save(makeDataset({ id: 'a', name: '同一个文件.txt' }))
    await store.save(makeDataset({ id: 'a', name: '同一个文件.txt', savedAt: 9999 }))
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].savedAt).toBe(9999)
  })

  it('删除会同时清掉文本、元数据与活动标记', async () => {
    const backend = createMemoryBackend()
    const store = makeStore(backend)
    await store.save(makeDataset({ id: 'a' }))
    await store.setActiveId('a')
    await store.remove('a')
    expect(await store.list()).toEqual([])
    expect(await store.load('a')).toBeNull()
    expect(await store.getActiveId()).toBeNull()
    // 底层键也应清空，避免残留几十 MB 的正文
    expect(await backend.keys()).toEqual([])
  })

  it('清空会移除所有键', async () => {
    const backend = createMemoryBackend()
    const store = makeStore(backend)
    await store.save(makeDataset({ id: 'a' }))
    await store.save(makeDataset({ id: 'b' }))
    await store.clear()
    expect(await backend.keys()).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it('活动数据集可设置与清除', async () => {
    const store = makeStore()
    expect(await store.getActiveId()).toBeNull()
    await store.setActiveId('a')
    expect(await store.getActiveId()).toBe('a')
    await store.setActiveId(null)
    expect(await store.getActiveId()).toBeNull()
  })

  it('元数据损坏的记录会被跳过而不是抛错', async () => {
    const backend = createMemoryBackend()
    const store = makeStore(backend)
    await backend.set('d:broken:m', '{ 这不是 JSON')
    await backend.set('d:wrong-shape:m', '{"name":"缺少 id"}')
    await store.save(makeDataset({ id: 'ok' }))
    const list = await store.list()
    expect(list.map((item) => item.id)).toEqual(['ok'])
  })
})

describe('设置项', () => {
  it('默认开启本地保存，无障碍开关默认关闭', async () => {
    const store = makeStore()
    expect(await store.getSettings()).toEqual({ persistEnabled: true, colorSafe: false, highContrast: false })
  })

  it('关闭后可读回，且不认识的字段按关闭处理', async () => {
    const store = makeStore()
    await store.setSettings({ persistEnabled: false, colorSafe: true, highContrast: false })
    expect(await store.getSettings()).toEqual({ persistEnabled: false, colorSafe: true, highContrast: false })
  })

  it('设置项损坏时回退为默认值', async () => {
    const backend = createMemoryBackend()
    await backend.set('settings', '###')
    const store = makeStore(backend)
    expect(await store.getSettings()).toEqual({ persistEnabled: true, colorSafe: false, highContrast: false })
  })
})

describe('容量守卫', () => {
  it('超出后端单条上限时抛出 quota 错误', async () => {
    const store = makeStore(createMemoryBackend(16))
    await expect(store.save(makeDataset())).rejects.toBeInstanceOf(StorageError)
    await expect(store.save(makeDataset())).rejects.toMatchObject({ code: 'quota' })
  })

  it('无上限配置下大文本可正常保存', async () => {
    const store = makeStore(createMemoryBackend())
    const big = '情绪记录。'.repeat(20000)
    await store.save({ ...makeDataset({ id: 'big' }), text: big })
    expect((await store.load('big'))?.text).toHaveLength(big.length)
  })

  it('元数据写入失败时回滚已写入的正文', async () => {
    const inner = createMemoryBackend()
    const failing: KvBackend = {
      kind: 'memory',
      maxValueBytes: 0,
      get: (key) => inner.get(key),
      remove: (key) => inner.remove(key),
      keys: () => inner.keys(),
      clear: () => inner.clear(),
      async set(key, value) {
        if (key.endsWith(':m')) throw new Error('模拟元数据写入失败')
        await inner.set(key, value)
      },
    }
    const store = createDatasetStore(failing)
    await expect(store.save(makeDataset({ id: 'x' }))).rejects.toThrow('模拟元数据写入失败')
    expect(await inner.keys()).toEqual([])
  })
})
