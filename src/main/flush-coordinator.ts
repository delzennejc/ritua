import { randomUUID } from 'node:crypto'

// A failed/crashed renderer must never leave an unbounded native quit request.
export class FlushCoordinator {
  private pending: { id: string; promise: Promise<boolean>; finish: (success: boolean) => void } | undefined
  constructor(
    private send: (id: string) => void,
    private timeoutMs = 8000,
  ) {}
  request(): Promise<boolean> {
    if (this.pending) return this.pending.promise
    let complete!: (success: boolean) => void
    const promise = new Promise<boolean>((resolve) => {
      complete = resolve
    })
    const id = randomUUID()
    const timer = setTimeout(() => this.acknowledge(id, false), this.timeoutMs)
    this.pending = {
      id,
      promise,
      finish: (success) => {
        clearTimeout(timer)
        this.pending = undefined
        complete(success)
      },
    }
    try {
      this.send(id)
    } catch {
      this.acknowledge(id, false)
    }
    return promise
  }
  acknowledge(id: string, success: boolean) {
    if (this.pending?.id !== id) return false
    this.pending.finish(success)
    return true
  }
  rendererGone() {
    if (this.pending) this.pending.finish(false)
  }
}
