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
  const worker = await createWorker('chi_sim', 1, {
    workerPath: `${OCR_ROOT}/tesseract-core/worker.min.js`,
    corePath: `${OCR_ROOT}/tesseract-core/tesseract-core-lstm.js`,
    langPath: `${OCR_ROOT}/lang`,
    gzip: false,
    cacheMethod: 'write',
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
