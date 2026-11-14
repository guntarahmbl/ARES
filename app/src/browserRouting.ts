import type { Bootstrap } from './types'

type RoutingConfig = NonNullable<Bootstrap['routing']>
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, Pending>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./routing.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const item = pending.get(data.id)
      if (!item) return
      pending.delete(data.id)
      item.cleanup()
      if (data.error) item.reject(new Error(data.error))
      else item.resolve(data.result)
    }
    worker.onerror = () => {
      for (const item of pending.values()) {
        item.cleanup()
        item.reject(new Error('The route calculator stopped. Please try again.'))
      }
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  return worker
}

export function browserRouting<T>(config: RoutingConfig, operation: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const activeWorker = getWorker()
    const id = ++nextId
    const abort = () => {
      pending.delete(id)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Request aborted', 'AbortError'))
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    activeWorker.postMessage({ id, config, operation, body })
  })
}
