// 数据集存储层：把「一份聊天记录 + 其解析结果摘要」当作一个数据集持久化到浏览器本地。
//
// 设计要点：
// 1. 只持久化**原始文本**，不存解析结果。解析是纯函数，重新解析即可复现；
//    而把 ParseResult 序列化会把同一条消息在 days 与 messages 里写两遍，体积更大且易失真。
// 2. 元数据与文本分开存（`d:<id>:m` / `d:<id>:t`），列出数据集时无需读出几十 MB 的正文。
// 3. 存储后端抽象为 KvBackend（键值均为字符串），IndexedDB / localStorage / 内存三种实现共用同一套读写逻辑，
//    纯逻辑部分因此可以直接用内存后端做单元测试。

import type { ParseResult } from './parser'
import { buildOverview } from './parser'

/** 存储后端类型；none 表示仅内存可用 */
export type StorageBackendKind = 'indexeddb' | 'localstorage' | 'memory' | 'none'

export const BACKEND_LABEL: Record<StorageBackendKind, string> = {
  indexeddb: 'IndexedDB',
  localstorage: 'localStorage',
  memory: '仅当前会话',
  none: '不可用',
}

export type StorageErrorCode = 'quota' | 'unavailable' | 'io' | 'corrupt'

export class StorageError extends Error {
  readonly code: StorageErrorCode

  constructor(code: StorageErrorCode, message: string) {
    super(message)
    this.name = 'StorageError'
    this.code = code
  }
}

/** 键值存储的最小契约 */
export interface KvBackend {
  readonly kind: StorageBackendKind
  /** 单个值允许的最大字节数，0 表示无硬上限 */
  readonly maxValueBytes: number
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export interface DatasetMeta {
  id: string
  /** 数据集名称，默认取文件名 */
  name: string
  /** 首次保存时间 */
  savedAt: number
  encoding: string
  /** 原始文本 UTF-8 字节数 */
  sizeBytes: number
  messageCount: number
  dayCount: number
  /** 最早 / 最晚记录日期（YYYY-MM-DD） */
  firstDate: string | null
  lastDate: string | null
  averageScore: number
  formatLabel: string
}

export interface StoredDataset extends DatasetMeta {
  text: string
}

export interface Settings {
  /** 是否把导入的数据保存到本机（关闭时仅当前会话可用） */
  persistEnabled: boolean
  /** 色觉辅助：热力图额外绘制方向字形与强度条，不再单靠颜色表达情绪方向 */
  colorSafe: boolean
  /** 高对比：提升界面文字与图表的对比度 */
  highContrast: boolean
}

export const DEFAULT_SETTINGS: Settings = { persistEnabled: true, colorSafe: false, highContrast: false }

const KEY_META_PREFIX = 'd:'
const KEY_META_SUFFIX = ':m'
const KEY_TEXT_SUFFIX = ':t'
const KEY_ACTIVE = 'active'
const KEY_SETTINGS = 'settings'

function metaKey(id: string): string {
  return `${KEY_META_PREFIX}${id}${KEY_META_SUFFIX}`
}

function textKey(id: string): string {
  return `${KEY_META_PREFIX}${id}${KEY_TEXT_SUFFIX}`
}

function idFromMetaKey(key: string): string | null {
  if (!key.startsWith(KEY_META_PREFIX) || !key.endsWith(KEY_META_SUFFIX)) return null
  return key.slice(KEY_META_PREFIX.length, key.length - KEY_META_SUFFIX.length)
}

/**
 * UTF-8 字节数估算。刻意不用 TextEncoder：正文可能达到 20 MB，
 * 一次性编码会复制出等量内存，这里按码点直接累加。
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对：合并成一个补充平面码点（4 字节），并跳过低位代理
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3 // 落单的代理，按替换字符计
    } else bytes += 3
  }
  return bytes
}

/** 由解析结果与原始文本构建数据集元数据（纯函数） */
export function buildDatasetMeta(params: {
  id: string
  name: string
  encoding: string
  text: string
  result: ParseResult
  savedAt?: number
}): DatasetMeta {
  const { id, name, encoding, text, result } = params
  const days = result.days
  const overview = buildOverview(days)
  return {
    id,
    name,
    savedAt: params.savedAt ?? Date.now(),
    encoding,
    sizeBytes: utf8ByteLength(text),
    messageCount: result.messages.length,
    dayCount: days.length,
    firstDate: days.length > 0 ? days[0].date : null,
    lastDate: days.length > 0 ? days[days.length - 1].date : null,
    averageScore: overview.averageScore,
    formatLabel: result.report.formatLabel,
  }
}

export function createDatasetId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  return `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface DatasetStore {
  readonly kind: StorageBackendKind
  list(): Promise<DatasetMeta[]>
  load(id: string): Promise<StoredDataset | null>
  save(dataset: StoredDataset): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  getActiveId(): Promise<string | null>
  setActiveId(id: string | null): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<void>
}

function parseMeta(raw: string | null): DatasetMeta | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Partial<DatasetMeta>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null
  return candidate as DatasetMeta
}

export function createDatasetStore(backend: KvBackend): DatasetStore {
  const guardSize = (value: string, label: string) => {
    const limit = backend.maxValueBytes
    if (limit > 0 && utf8ByteLength(value) > limit) {
      throw new StorageError(
        'quota',
        `${label}超过 ${BACKEND_LABEL[backend.kind]} 单条容量上限（约 ${Math.round(limit / 1024)} KB），本次不保存到本机。`,
      )
    }
  }

  return {
    kind: backend.kind,

    async list() {
      const keys = await backend.keys()
      const metas: DatasetMeta[] = []
      for (const key of keys) {
        const id = idFromMetaKey(key)
        if (!id) continue
        const meta = parseMeta(await backend.get(key))
        if (meta) metas.push({ ...meta, id })
      }
      return metas.toSorted((a, b) => b.savedAt - a.savedAt)
    },

    async load(id) {
      const meta = parseMeta(await backend.get(metaKey(id)))
      if (!meta) return null
      const text = await backend.get(textKey(id))
      if (text === null) return null
      return { ...meta, id, text }
    },

    async save(dataset) {
      const { text, ...meta } = dataset
      guardSize(text, '原始文本')
      const metaJson = JSON.stringify(meta)
      guardSize(metaJson, '元数据')
      await backend.set(textKey(dataset.id), text)
      try {
        await backend.set(metaKey(dataset.id), metaJson)
      } catch (error) {
        // 元数据写入失败时回滚文本，避免留下无法被列出的孤儿记录
        await backend.remove(textKey(dataset.id)).catch(() => undefined)
        throw error
      }
    },

    async remove(id) {
      await backend.remove(textKey(id))
      await backend.remove(metaKey(id))
      if ((await backend.get(KEY_ACTIVE)) === id) await backend.remove(KEY_ACTIVE)
    },

    async clear() {
      await backend.clear()
    },

    async getActiveId() {
      return backend.get(KEY_ACTIVE)
    },

    async setActiveId(id) {
      if (id === null) await backend.remove(KEY_ACTIVE)
      else await backend.set(KEY_ACTIVE, id)
    },

    async getSettings() {
      const raw = await backend.get(KEY_SETTINGS)
      if (!raw) return { ...DEFAULT_SETTINGS }
      try {
        const parsed = JSON.parse(raw) as Partial<Settings>
        return {
          persistEnabled: parsed.persistEnabled !== false,
          colorSafe: parsed.colorSafe === true,
          highContrast: parsed.highContrast === true,
        }
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    },

    async setSettings(settings) {
      await backend.set(KEY_SETTINGS, JSON.stringify(settings))
    },
  }
}

/** 内存后端：用于测试与「无可用持久化」时的降级 */
export function createMemoryBackend(maxValueBytes = 0): KvBackend {
  const map = new Map<string, string>()
  return {
    kind: 'memory',
    maxValueBytes,
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
    async remove(key) {
      map.delete(key)
    },
    async keys() {
      return [...map.keys()]
    },
    async clear() {
      map.clear()
    },
  }
}
