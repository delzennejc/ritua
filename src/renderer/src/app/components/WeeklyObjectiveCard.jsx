import { CheckCircle } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { workspaceStore } from '../../desktop/workspace-store'
import { currentProjectCardTasks } from '../../../../domain/project-card-tasks'
import { mondayOf } from '../../../../domain/calendar-dates'
import { CURRENT_DATE_KEY } from '../utils/dates'
import { completedTasksLast } from '../../../../domain/tasks'
import { minutesLabel } from '../utils/time'
import { FolderLabel } from './FolderLabel'
import { SortableCollectionItem } from './SortableCollection'

const OBJECTIVE_CARD_ACTION_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
].join(',')

function objectiveCardOpenProps(objective, onOpen) {
  if (!onOpen) return {}

  return {
    'data-objective-card-openable': 'true',
    onClick: (event) => {
      if (event.defaultPrevented) return
      const actionTarget = event.target?.closest?.(OBJECTIVE_CARD_ACTION_SELECTOR)
      if (actionTarget && actionTarget !== event.currentTarget && event.currentTarget.contains(actionTarget))
        return

      const returnFocusElement = event.currentTarget.querySelector('[data-objective-title-id]')
      onOpen(objective, returnFocusElement || event.currentTarget)
    },
  }
}

export function WeeklyObjectiveCard({
  className = '',
  collectionItem,
  dragPreview = false,
  objective,
  onOpen,
  onToggle,
  showThisWeekLabel = false,
  showCompletedHistory = false,
}) {
  const document = useStore(workspaceStore, (state) => state.document)
  const weekStart = mondayOf(CURRENT_DATE_KEY)
  const visibleTasks = useMemo(
    () =>
      showCompletedHistory ? objective.tasks || [] : currentProjectCardTasks(objective, document, weekStart),
    [document, objective, showCompletedHistory, weekStart],
  )
  const cardClassName = `weekly-objective-card ${objective.complete ? 'complete' : ''} ${className}`.trim()
  const openProps = dragPreview ? {} : objectiveCardOpenProps(objective, onOpen)
  const content = (
    <>
      <div className="weekly-objective-heading">
        <h3>
          {onOpen && !dragPreview ? (
            <button
              className="weekly-objective-title"
              data-objective-title-id={objective.id}
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onOpen(objective, event.currentTarget)
              }}
              onClick={(event) => {
                event.stopPropagation()
                onOpen(objective, event.currentTarget)
              }}
            >
              {objective.title}
            </button>
          ) : (
            objective.title
          )}
        </h3>
      </div>
      <div className="weekly-objective-meta">
        <button
          className="icon-button weekly-objective-toggle"
          type="button"
          aria-label={
            objective.complete ? `Mark ${objective.title} incomplete` : `Mark ${objective.title} complete`
          }
          onClick={() => onToggle?.(objective.id)}
        >
          <CheckCircle size={18} weight={objective.complete ? 'fill' : 'regular'} />
        </button>
        {showThisWeekLabel && objective.focusedThisWeek !== false ? (
          <span className="weekly-objective-week-label">This week</span>
        ) : null}
        <FolderLabel channel={objective.channel} />
      </div>
      {visibleTasks.length ? (
        <ul className="weekly-objective-tasks">
          {completedTasksLast(visibleTasks).map((task) => (
            <li
              className={task.complete ? 'complete' : ''}
              data-task-layout-complete={String(Boolean(task.complete))}
              data-task-layout-id={task.taskId || task.id}
              key={task.id}
            >
              <CheckCircle size={14} weight={task.complete ? 'fill' : 'regular'} />
              <span>{task.title}</span>
              <time>{minutesLabel(task.minutes)}</time>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )

  if (dragPreview || !collectionItem) {
    return (
      <article
        className={`${cardClassName} ${dragPreview ? 'collection-drag-preview' : ''}`.trim()}
        {...openProps}
      >
        {content}
      </article>
    )
  }

  return (
    <SortableCollectionItem
      as="article"
      className={cardClassName}
      aria-label={`Drag ${objective.title} to reorder projects`}
      {...collectionItem}
      itemSnapshot={objective}
      preview={{ type: 'objective', showThisWeekLabel, showCompletedHistory }}
      {...openProps}
    >
      {content}
    </SortableCollectionItem>
  )
}
