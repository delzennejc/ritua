import { mutateWorkspaceTask } from '../../../../domain/task-editing'
import {
  getWorkspaceFields,
  getWorkspaceDocument,
  queueBulkWorkspaceUpdate,
  replaceWorkspaceDocument,
} from '../../desktop/workspace-store'
import { CURRENT_DATE_KEY } from '../utils/dates'

export function useTaskRecurrence({ boardStateRef, areas, setActiveTaskId }) {
  const updateTaskRecurrenceFromDetails = (taskId, recurrence) => {
    const document = getWorkspaceDocument()
    const selected = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    const context = {
      today: CURRENT_DATE_KEY,
      seriesId: `${taskId}-${crypto.randomUUID()}`,
    }
    if (selected && !selected.data.content.complete) {
      const lane = String(selected.data.lane)
      const dateKey = lane.startsWith('date:') ? lane.slice(5) : context.today
      const start = dateKey < context.today ? context.today : dateKey
      replaceWorkspaceDocument(
        mutateWorkspaceTask(document, taskId, (task) => ({
          ...task,
          recurrence,
          ...(!task.recurrenceSeriesId && recurrence.frequency !== 'none'
            ? {
                recurrenceSeriesId: context.seriesId,
                recurrenceStartDateKey: start,
                recurrenceIndex: 0,
              }
            : {}),
        })),
      )
      boardStateRef.current = getWorkspaceFields()
    }
    queueBulkWorkspaceUpdate(
      `task-recurrence:${taskId}`,
      {
        type: 'task-recurrence',
        taskId,
        recurrence,
        context: { today: context.today, seriesId: context.seriesId },
        areas,
      },
      true,
      (result) => {
        if (result.activeTaskId !== undefined) setActiveTaskId(result.activeTaskId)
      },
    )
  }
  return { updateTaskRecurrenceFromDetails }
}
