import { Star } from '@phosphor-icons/react'
import { useWorkspaceProjection } from '../../desktop/workspace-store'
import { setDailyHighlight } from '../../desktop/daily-plan-actions'
import { ChoiceDropdown } from './Dropdown'
import { CURRENT_DATE_KEY } from '../utils/dates'
import '../views/daily-planning/daily-planning.css'

export function DailyHighlight({ tasks, dateKey, onOpenTask }) {
  const highlightId = useWorkspaceProjection('daily.highlightTaskId', null)
  const canonicalTasks = useWorkspaceProjection('tasks', [])
  if (dateKey !== CURRENT_DATE_KEY) return null
  const todayIds = new Set(canonicalTasks.map((task) => task.id))
  const availableTasks = tasks.filter((task) => todayIds.has(task.id))
  const highlight = availableTasks.find((task) => task.id === highlightId)
  return (
    <div className={`today-highlight ${highlight?.complete ? 'is-complete' : ''}`}>
      <Star size={18} weight={highlight ? 'fill' : 'regular'} aria-hidden="true" />
      <span className="today-highlight-label">Daily highlight</span>
      {highlight ? (
        <button
          className="today-highlight-title"
          onClick={(event) => onOpenTask(highlight, event.currentTarget)}
        >
          {highlight.title}
          {highlight.complete ? <span> · Completed</span> : null}
        </button>
      ) : (
        <span className="today-highlight-empty">What’s the one thing that matters today?</span>
      )}
      <ChoiceDropdown
        label="Change daily highlight"
        trigger={<>{highlight ? 'Change' : 'Choose highlight'}</>}
        menuWidth={320}
        value={highlight?.id ?? ''}
        onChange={(id) => setDailyHighlight(id || null)}
        options={[
          { value: '', label: 'No highlight' },
          ...availableTasks
            .filter((task) => !task.complete || task.id === highlightId)
            .map((task) => ({ value: task.id, label: task.title, icon: <Star size={14} /> })),
        ]}
      />
    </div>
  )
}
