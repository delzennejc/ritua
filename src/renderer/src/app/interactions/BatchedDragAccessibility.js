import { Accessibility } from '@dnd-kit/dom'
import { effect, untracked } from '@dnd-kit/state'

// dnd-kit 0.5 updates every activator for each individual registry change. React
// mounts a whole day/week in one commit; apply the same accessible attributes
// once after that commit, before paint. Announcements stay with the base plugin.
export class BatchedDragAccessibility extends Accessibility {
  constructor(manager, options) {
    super(manager, options)
    const destroy = this.destroy.bind(this)
    this.destroy = () => {
      this.disposeActivatorEffects()
      destroy()
    }
  }

  registerEffect(callback) {
    const activators = new Map()
    let queued = false
    let destroyed = false
    const schedule = () => {
      if (queued || destroyed) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (!destroyed) callback.call(this)
      })
    }
    const dispose = super.registerEffect(() => {
      const draggables = new Set(this.manager.registry.draggables.value)
      untracked(() => {
        for (const [draggable, stop] of activators) {
          if (draggables.has(draggable)) continue
          stop()
          activators.delete(draggable)
        }
        for (const draggable of draggables) {
          if (activators.has(draggable)) continue
          // Track each activator once, rather than reading every task's reactive
          // properties again each time one new calendar control is registered.
          activators.set(
            draggable,
            effect(() => {
              const activator = draggable.handle ?? draggable.element
              if (activator) {
                void draggable.isDragging
                void draggable.disabled
              }
              schedule()
            }),
          )
        }
      })
      schedule()
    })
    this.disposeActivatorEffects = () => {
      destroyed = true
      dispose()
      activators.forEach((stop) => stop())
      activators.clear()
    }
    return this.disposeActivatorEffects
  }
}
