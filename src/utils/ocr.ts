import { createWorker } from 'tesseract.js'

type OcrLoggerMessage = {
  status: string
  progress: number
}

export interface OcrProgress {
  status: string
  progress: number
}

const PUBLIC_BASE = import.meta.env.BASE_URL
const OCR_ROOT = `${PUBLIC_BASE}ocr`

/**
 * `file://` 下浏览器不会对 worker / wasm 发独立请求，OCR 必然失败。
 * 这里提前拦下并给出可执行的提示，而不是让 tesseract.js 走到一半抛出
 * 一个难以定位的网络错误（其默认兜底路径还指向 cdn.jsdelivr.net）。
 */
function assertNotFileProtocol(): void {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return
  throw new Error(
    'OCR 需要通过本地 HTTP 服务运行：单文件双击打开（file://）时浏览器无法加载识别引擎。' +
      '请改用随附的 open-neurotide.bat 启动，或自行起一个静态服务器。',
  )
}

function formatStatus(message: OcrLoggerMessage): OcrProgress {
  const statusMap: Record<string, string> = {
    'loading tesseract core': '加载本地 OCR 引擎',
    'initializing tesseract': '初始化识别器',
    'loading language traineddata': '加载简体中文模型（首次加载稍慢）',
    'initializing api': '准备识别',
    'recognizing text': '正在识别截图文字',
  }
  return {
    status: statusMap[message.status] ?? '正在准备本地识别',
    progress: Math.max(0, Math.min(1, Number.isFinite(message.progress) ? message.progress : 0)),
  }
}

export async function recognizeChineseScreenshot(
  image: File,
  onProgress: (progress: OcrProgress) => void,
): Promise<string> {
  assertNotFileProtocol()
  const worker = await createWorker('chi_sim', 1, {
    workerPath: `${OCR_ROOT}/tesseract-core/worker.min.js`,
    corePath: `${OCR_ROOT}/tesseract-core/tesseract-core-lstm.js`,
    langPath: `${OCR_ROOT}/lang`,
    gzip: false,
    cacheMethod: 'write',
    // 关键：产物要能在 file:// 下打开。blob: worker 在 file:// 下会被浏览器拦截，
    // 必须让 tesseract.js 直接去取上面那些真实路径。
    workerBlobURL: false,
    logger: (message) => onProgress(formatStatus(message)),
  })

  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
