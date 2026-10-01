import { reportActionError } from './ActionErrors'

export const COMPLETION_PAUSE_MS = 800
type CompletionRequest = {
  read: () => boolean | undefined
  apply: () => void
}
type QueueEnvironment = {
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
  onError?: (error: unknown) => void
}

/** Pending click intent stays separate from canonical data until the card's pause ends. */
export function createCompletionQueue(environment: QueueEnvironment = {}) {
  const schedule = environment.schedule ?? setTimeout
  const cancel = environment.cancel ?? clearTimeout
  const requests = new Map<string, CompletionRequest & { timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<() => void>()
  const publish = () => listeners.forEach((listener) => listener())
  const remove = (key: string, notify = true) => {
    const request = requests.get(key)
    if (!request) return
    cancel(request.timer)
    requests.delete(key)
    if (notify) publish()
    return request
  }
  const finish = (key: string, propagate = false) => {
    const request = remove(key, false)
    if (!request) return
    try {
      // An external completion or deletion supersedes the pending click.
      if (request.read() === false) request.apply()
    } catch (error) {
      environment.onError?.(error)
      if (propagate) throw error
    } finally {
      // Canonical projection publishes first, avoiding an unchecked frame at handoff.
      queueMicrotask(publish)
    }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isPending: (key: string) => requests.has(key),
    hasPending: () => requests.size > 0,
    cancel: (key: string) => {
      remove(key)
    },
    enqueue(key: string, request: CompletionRequest) {
      if (requests.has(key)) return
      requests.set(key, { ...request, timer: schedule(() => finish(key), COMPLETION_PAUSE_MS) })
      publish()
    },
    flush() {
      for (const key of [...requests.keys()]) finish(key, true)
    },
  }
}

export const completionQueue = createCompletionQueue({
  onError: (error) => reportActionError(error instanceof Error ? error.message : String(error)),
})
