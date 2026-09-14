import { CURRENT_DATE_KEY } from './dates'
import { moveTaskBetweenDates as move } from '../../../../domain/task-scheduling'
const BOARD_GROUP_PREFIX = 'board'
export const boardGroupId = (surfaceId, dateKey) => `${BOARD_GROUP_PREFIX}:${surfaceId}:${dateKey}`

export const acceptsBoardTaskDrag = (source) =>
  source.data?.kind === 'board-task' ||
  (source.data?.kind === 'collection-item' && source.data?.backlogTask === true)

export const moveTaskBetweenDates = (input) => move(input, CURRENT_DATE_KEY)
