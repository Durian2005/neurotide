// 浏览器存储后端：IndexedDB 优先，localStorage 兜底，都不可用时退化为内存。
//
// 实测结论（Chromium 内核 Edge，2026-10-11）：
// - `file://` 下 IndexedDB **可用**：open + upgrade 约 5ms，写入并读回 8MB 文本正常，
//   navigator.storage.estimate() 返回约 10GB 配额。
// - `file://` 的 location.origin 是 "file://"，即**所有本地 HTML 文件共用同一个存储域**，
//   因此必须提供「一键清除」，并在文档中如实说明。
// - 探测用超时保护：IndexedDB 在本环境不会抛异常，异常路径通常是静默挂起，
//   只靠 try/catch 判断可用性会误判。

import { BACKEND_LABEL, StorageError, createDatasetStore, createMemoryBackend } from './datasetStore'
import type { DatasetStore, KvBackend, StorageBackendKind } from './datasetStore'

const IDB_NAME = 'neurotide'
const IDB_VERSION = 1
const IDB_STORE = 'kv'
/** IndexedDB 打开超时：正常耗时在毫秒级，超时即视为不可用 */
const OPEN_TIMEOUT_MS = 2500
/** localStorage 总量约 5MB（UTF-16 计），单条留出保守上限 */
const LOCALSTORAGE_MAX_VALUE_BYTES = 2 * 1024 * 1024

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function rethrowLocalStorageError(error: unknown): never {
  if (isQuotaError(error)) throw new StorageError('quota', 'localStorage 空间不足，请先删除旧数据集。')
  throw new StorageError('unavailable', 'localStorage 写入被浏览器拒绝。')
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new StorageError('unavailable', 'IndexedDB 打开超时，已改用其它存储方式。'))
    }, OPEN_TIMEOUT_MS)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(IDB_NAME, IDB_VERSION)
    } catch (error) {
      finish(() => reject(error))
      return
    }

    request.addEventListener('upgradeneeded', () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    })
    request.addEventListener('success', () => {
      const db = request.result
      // 其它标签页升级数据库时主动让路，避免后续事务被阻塞
      db.addEventListener('versionchange', () => db.close())
      finish(() => resolve(db))
    })
    request.addEventListener('error', () => finish(() => reject(request.error ?? new Error('IndexedDB open failed'))))
    request.addEventListener('blocked', () =>
      finish(() => reject(new StorageError('unavailable', 'IndexedDB 被其它页面占用。'))),
    )
  })
}

function createIndexedDbBackend(db: IDBDatabase): KvBackend {
  const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction
      try {
        transaction = db.transaction(IDB_STORE, mode)
      } catch {
        reject(new StorageError('io', '本地数据库不可用，请刷新页面重试。'))
        return
      }
      const request = action(transaction.objectStore(IDB_STORE))
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () =>
        reject(
          isQuotaError(request.error)
            ? new StorageError('quota', '本机存储空间不足。')
            : (request.error ?? new Error('io')),
        ),
      )
      transaction.addEventListener('abort', () =>
        reject(
          isQuotaError(transaction.error)
            ? new StorageError('quota', '本机存储空间不足，请先删除旧数据集。')
            : new StorageError('io', '写入本地数据库失败。'),
        ),
      )
    })

  return {
    kind: 'indexeddb',
    // IndexedDB 无单条硬上限，实际受 origin 配额（实测约 10GB）约束
    maxValueBytes: 0,
    async get(key) {
      const value = await run<string | undefined>('readonly', (store) => store.get(key))
      return value ?? null
    },
    async set(key, value) {
      await run('readwrite', (store) => store.put(value, key))
    },
    async remove(key) {
      await run('readwrite', (store) => store.delete(key))
    },
    async keys() {
      const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
      return keys.filter((key): key is string => typeof key === 'string')
    },
    async clear() {
      await run('readwrite', (store) => store.clear())
    },
  }
}

function createLocalStorageBackend(): KvBackend | null {
  try {
    const probeKey = 'neurotide:probe'
    localStorage.setItem(probeKey, '1')
    localStorage.removeItem(probeKey)
  } catch {
    return null
  }

  return {
    kind: 'localstorage',
    maxValueBytes: LOCALSTORAGE_MAX_VALUE_BYTES,
    async get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch (error) {
        rethrowLocalStorageError(error)
      }
    },
    async remove(key) {
      try {
        localStorage.removeItem(key)
      } catch {
        // 删除失败不影响主流程
      }
    },
    async keys() {
      const keys: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key) keys.push(key)
        }
      } catch {
        return []
      }
      return keys
    },
    async clear() {
      try {
        localStorage.clear()
      } catch {
        // 忽略
      }
    },
  }
}

export interface ResolvedStore {
  store: DatasetStore
  kind: StorageBackendKind
  /** 发生降级时的说明文案，供界面提示 */
  notice: string
}

/** 依赖倒置的注入点：测试可借此替换为内存后端，避免真实落盘 */
let backendOverride: KvBackend | null = null

/** 仅供测试使用：注入自定义后端 */
export function setStorageBackendForTest(backend: KvBackend | null): void {
  backendOverride = backend
}

let resolved: Promise<ResolvedStore> | null = null

/** 探测并构造数据集存储，结果在进程内缓存（同一次会话只探测一次） */
export function resolveDatasetStore(): Promise<ResolvedStore> {
  if (resolved) return resolved

  resolved = (async (): Promise<ResolvedStore> => {
    if (backendOverride) {
      return { store: createDatasetStore(backendOverride), kind: backendOverride.kind, notice: '' }
    }

    try {
      const db = await openIndexedDb()
      return { store: createDatasetStore(createIndexedDbBackend(db)), kind: 'indexeddb', notice: '' }
    } catch (error) {
      const reason = error instanceof StorageError ? error.message : 'IndexedDB 不可用'
      const fallback = createLocalStorageBackend()
      if (fallback) {
        return {
          store: createDatasetStore(fallback),
          kind: 'localstorage',
          notice: `${reason}已降级为 localStorage，单个数据集上限约 2MB。`,
        }
      }
      return {
        store: createDatasetStore(createMemoryBackend()),
        kind: 'memory',
        notice: `${reason}且 localStorage 不可用，数据仅在当前会话有效，关闭页面即丢失。`,
      }
    }
  })()

  return resolved
}

/** 仅供测试使用：重置缓存与注入 */
export function resetDatasetStoreForTest(): void {
  resolved = null
  backendOverride = null
}

export { BACKEND_LABEL }
