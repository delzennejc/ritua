import type { Project, ProjectTask } from './models'
import type { WorkspaceDocument } from './workspace-types'
import { taskContent } from './workspace-selectors'
import { isPreviousWeekCompletedTask } from './project-task-order'

/** Filter the card only; project membership and completed history remain intact. */
export function currentProjectCardTasks(
  project: Project,
  document: WorkspaceDocument | null,
  weekStart: string,
): ProjectTask[] {
  const tasks = new Map(
    (document?.entities ?? [])
      .filter((entity) => entity.kind === 'task')
      .map((entity) => [entity.id, entity]),
  )
  return (project.tasks ?? []).filter((member) => {
    const entity = tasks.get(member.taskId || member.id)
    const canonical = entity ? taskContent(entity) : member
    const lane = entity?.data.lane
    const dateKey =
      typeof lane === 'string' && lane.startsWith('date:')
        ? lane.slice('date:'.length)
        : lane === 'today'
          ? String(document?.fields.workspaceDate ?? '')
          : null
    return !isPreviousWeekCompletedTask({ ...canonical, dateKey }, weekStart)
  })
}
