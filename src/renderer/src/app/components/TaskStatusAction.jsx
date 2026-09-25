import { ArrowsLeftRight } from '@phosphor-icons/react'
import { changeTodayTaskStatus } from '../../desktop/today-status-actions'
import { todayBoardStatus } from '../../../../domain/today-board'
import { Dropdown } from './Dropdown'
import './task-status.css'

const STATUS_OPTIONS = [
  { value: 'todo', label: 'Todo' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'to-review', label: 'To Review' },
  { value: 'done', label: 'Done' },
]

export function TaskStatusAction({ task, details = false }) {
  const value = todayBoardStatus(task)
  const label = STATUS_OPTIONS.find((option) => option.value === value).label

  return (
    <Dropdown
      className={details ? 'task-details-more task-status-action' : 'task-status-action'}
      triggerClassName={details ? '' : 'task-area-picker'}
      label={`Status for ${task.title}: ${label}`}
      title="Status"
      triggerTitle={`Change task status (${label})`}
      trigger={
        details ? (
          <>
            <ArrowsLeftRight size={17} weight="bold" aria-hidden="true" /> {label}
          </>
        ) : (
          <span className="task-status-label">
            <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />
            <span>{label}</span>
          </span>
        )
      }
      items={STATUS_OPTIONS.map((option) => ({
        id: option.value,
        label: option.label,
        icon: <ArrowsLeftRight size={15} weight="bold" aria-hidden="true" />,
        role: 'menuitemradio',
        checked: option.value === value,
        onSelect: () => {
          if (option.value !== value) changeTodayTaskStatus(task.id, option.value)
        },
      }))}
    />
  )
}
