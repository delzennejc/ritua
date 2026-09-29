import type { WorkspaceDocument } from '../../../domain/workspace-types'
import {
  applyBulkWorkspaceAction,
  type BulkWorkspaceAction,
  type BulkWorkspaceResult,
} from './bulk-workspace-actions'

type Job = {
  key: string
  action: BulkWorkspaceAction
  onApplied?: (result: BulkWorkspaceResult) => void
  stale?: boolean
}

/** Compute large changes in a worker after the initiating control has rendered. */
export function createBulkWorkspaceUpdateQueue(
  getDocument: () => WorkspaceDocument,
  replaceDocument: (document: WorkspaceDocument) => void,
  onError: (error: unknown) => void,
) {
  const pending: Job[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  let worker: Worker | undefined
  let requestId = 0
  let running: Promise<void> | undefined
  let runningJob: Job | undefined
  let draining = false

  const cancelSchedule = () => {
    clearTimeout(timer)
    timer = undefined
    if (idle !== undefined) cancelIdleCallback(idle)
    idle = undefined
  }

  const runAction = (document: WorkspaceDocument, action: BulkWorkspaceAction) => {
    if (typeof Worker === 'undefined')
      return Promise.resolve().then(() => applyBulkWorkspaceAction(document, action))
    worker ??= new Worker(new URL('./bulk-workspace-worker.ts', import.meta.url), { type: 'module' })
    const target = worker
    const id = ++requestId
    return new Promise<BulkWorkspaceResult>((resolve, reject) => {
      const finish = () => {
        target.removeEventListener('message', onMessage)
        target.removeEventListener('error', onErrorEvent)
      }
      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== id) return
        finish()
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.result as BulkWorkspaceResult)
      }
      const onErrorEvent = (event: ErrorEvent) => {
        finish()
        worker = undefined
        target.terminate()
        reject(new Error(event.message || 'Bulk update worker failed'))
      }
      target.addEventListener('message', onMessage)
      target.addEventListener('error', onErrorEvent)
      target.postMessage({ id, document, action })
    })
  }

  const schedule = () => {
    if (draining || running || !pending.length) return
    cancelSchedule()
    timer = setTimeout(() => {
      timer = undefined
      idle = requestIdleCallback(
        () => {
          idle = undefined
          void runNext().catch(onError)
        },
        { timeout: 1000 },
      )
    }, 120)
  }

  const runNext = () => {
    if (running) return running
    const job = pending.shift()
    if (!job) return Promise.resolve()
    runningJob = job
    running = (async () => {
      try {
        while (!job.stale) {
          const source = getDocument()
          const result = await runAction(source, job.action)
          if (job.stale) return
          if (getDocument() !== source) continue
          if (result.document !== source) replaceDocument(result.document)
          job.onApplied?.(result)
          return
        }
      } catch (error) {
        if (!job.stale) pending.unshift(job)
        throw error
      } finally {
        runningJob = undefined
        running = undefined
        schedule()
      }
    })()
    return running
  }

  const enqueue = (
    key: string,
    action: BulkWorkspaceAction,
    replacePending = false,
    onApplied?: (result: BulkWorkspaceResult) => void,
  ) => {
    if (replacePending) {
      const index = pending.findIndex((job) => job.key === key)
      if (index >= 0) pending.splice(index, 1)
      if (runningJob?.key === key) runningJob.stale = true
    }
    pending.push({ key, action, onApplied })
    schedule()
  }

  const flush = async () => {
    draining = true
    cancelSchedule()
    try {
      while (running || pending.length) {
        if (running) await running
        else await runNext()
      }
    } finally {
      draining = false
      schedule()
    }
  }

  return { enqueue, flush, hasPending: () => Boolean(running || pending.length) }
}
