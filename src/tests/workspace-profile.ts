import { performance } from 'node:perf_hooks'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { editWorkspaceTask } from '../domain/task-editing'
import { immutableDocument } from '../domain/workspace-immutable'
import { createWorkspaceSession } from '../renderer/src/desktop/workspace-session'
import { changes } from '../domain/workspace-projection'
import type { Task } from '../domain/models'
import { addDays } from '../domain/calendar-dates'

const samples = 7
function measure(run: () => unknown) {
  run()
  const times = Array.from({ length: samples }, () => {
    const start = performance.now()
    run()
    return performance.now() - start
  }).sort((a, b) => a - b)
  return {
    medianMs: Number(times[Math.floor(samples / 2)].toFixed(2)),
    p95Ms: Number(times.at(-1)!.toFixed(2)),
  }
}
for (const count of [1000, 10000]) {
  const fields = project(emptyWorkspace('2026-09-14'))
  const dates: Record<string, Task[]> = {}
  for (let i = 0; i < count; i++) {
    const key = addDays('2026-09-14', Math.floor(i / 10) + 1)
    ;(dates[key] ??= []).push({
      id: `task-${i}`,
      title: `Task ${i}`,
      channel: 'Work',
      minutes: 30,
      complete: false,
      subtasks: [{ id: `step-${i}`, title: 'Next step', complete: false }],
    })
  }
  fields.datedTasksByDate = dates
  const document = immutableDocument(normalize(fields))
  const session = createWorkspaceSession()
  await session.initializeWorkspace()
  session.replaceWorkspaceDocument(document)
  session.getFields()
  let editVersion = 0
  console.log(
    JSON.stringify({
      tasks: count,
      datedLanes: Object.keys(dates).length,
      bytes: JSON.stringify(document).length,
      rendererEditAndProjection: measure(() => {
        const next = editWorkspaceTask(
          session.getDocument(),
          'task-0',
          { title: `Edit ${++editVersion}` },
          { actor: 'Test', now: new Date('2026-09-14T10:00:00') },
        )
        session.replaceWorkspaceDocument(next)
        session.getFields()
      }),
      diff: measure(() => changes(document, session.getDocument(), 'profile')),
      checkpointJson: measure(() => JSON.stringify({ base: document, local: session.getDocument() })),
      normalize: measure(() => normalize(fields)),
      project: measure(() => project(document)),
      canonicalEdit: measure(() =>
        editWorkspaceTask(
          document,
          'task-0',
          { title: 'Edited' },
          { actor: 'Test', now: new Date('2026-09-14T10:00:00') },
        ),
      ),
    }),
  )
  session.dispose()
}
