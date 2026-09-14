import type { WorkspaceDocument } from './workspace-types'
import type { Task, Project, BacklogGroup } from './models'
import { createWorkspaceView, applyWorkspaceView } from './workspace-view'
import { taskContent } from './workspace-selectors'

const selectView = createWorkspaceView()
/** Restore gesture locations without replacing task details edited since the snapshot. */
export function restoreBoardOrder(
  document: WorkspaceDocument,
  snapshot: { tasks: Task[]; datedTasksByDate: Record<string, Task[]> },
) {
  const tasks = new Map(document.entities.filter((e) => e.kind === 'task').map((e) => [e.id, taskContent(e)]))
  const current = (task: Task) => tasks.get(task.id) ?? task
  return applyWorkspaceView(document, {
    ...selectView(document),
    tasks: snapshot.tasks.map(current),
    datedTasksByDate: Object.fromEntries(
      Object.entries(snapshot.datedTasksByDate).map(([date, items]) => [date, items.map(current)]),
    ),
  })
}
export function restoreBacklogOrder(
  document: WorkspaceDocument,
  snapshot: { groups: BacklogGroup[]; objectives: Project[] },
) {
  const tasks = new Map(document.entities.filter((e) => e.kind === 'task').map((e) => [e.id, taskContent(e)]))
  return applyWorkspaceView(document, {
    ...selectView(document),
    backlogGroups: snapshot.groups.map((group) => ({
      ...group,
      items: group.items.map((task) => tasks.get(task.id) ?? task),
    })),
    weeklyObjectives: snapshot.objectives,
  })
}
