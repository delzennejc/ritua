import { changeWorkspaceRecurrence } from '../../../../domain/task-recurrence'
import {
  getWorkspaceFields,
  getWorkspaceDocument,
  replaceWorkspaceDocument,
} from '../../desktop/workspace-store'
import { CURRENT_DATE_KEY } from '../utils/dates'
import { backlogTaskDetailsAdapter } from '../utils/workspace-presenters'

export function useTaskRecurrence({ boardStateRef, areas, setActiveTaskId }) {
  const updateTaskRecurrenceFromDetails = (taskId, recurrence) => {
    const result = changeWorkspaceRecurrence(getWorkspaceDocument(), taskId, recurrence, {
      today: CURRENT_DATE_KEY,
      seriesId: `${taskId}-${crypto.randomUUID()}`,
      prepareTask: (task) => backlogTaskDetailsAdapter(task, areas),
    })
    replaceWorkspaceDocument(result.document)
    boardStateRef.current = getWorkspaceFields()
    if (result.activeTaskId !== undefined) setActiveTaskId(result.activeTaskId)
  }
  return { updateTaskRecurrenceFromDetails }
}
