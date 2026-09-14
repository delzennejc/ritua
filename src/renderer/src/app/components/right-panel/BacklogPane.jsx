import { movePanelBacklog, restoreBacklogCollections } from '../../../desktop/workspace-actions'
import { dispatchTaskCommand } from '../../../desktop/workspace-actions'

import { ChoiceDropdown } from '.././Dropdown'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckCircle, Plus, Stack } from '@phosphor-icons/react'
import { DEFAULT_AREAS } from '../../../../../domain/workspace-defaults'
import { RIGHT_PANEL_BACKLOG_COLLECTION_ID } from '../../utils/collections'

import { AutoGrowingTextarea } from '.././DetailsTitleInput'

import { FolderLabel } from '.././FolderLabel'
import { BacklogTaskRow } from '.././BacklogTaskRow'
import { SortableCollectionDropProxy, SortableCollectionLane } from '.././SortableCollection'

import { UtilityPaneToolbar } from './PaneChrome.jsx'
import { UtilityPaneHeading } from './PaneChrome.jsx'
import { isFocusedThisWeek } from './project-order.js'
import { orderObjectivesForPanel } from './project-order.js'
const TASK_TEMPORAL_DIVIDER_ANIMATION_MS = 180

const TASK_TEMPORAL_DIVIDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const rightPanelTaskLaneId = (horizon, groupLabel, objectiveId = null) =>
  `${horizon}::${groupLabel}::${objectiveId || 'standalone'}`

function TaskTemporalDivider({ groupLabel, laneId, layoutRevision }) {
  const dividerRef = useRef(null)
  const previousTopRef = useRef(null)
  const animationRef = useRef(null)

  useLayoutEffect(() => {
    const divider = dividerRef.current
    if (!divider) return

    const scrollContainer = divider.closest('.backlog-pane-content')
    const measureTop = () => {
      const dividerTop = divider.getBoundingClientRect().top
      if (!scrollContainer) return dividerTop
      return dividerTop - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop
    }

    const activeAnimation = animationRef.current
    const previousTop = activeAnimation ? measureTop() : previousTopRef.current
    if (activeAnimation) {
      activeAnimation.cancel()
      animationRef.current = null
    }

    const nextTop = measureTop()
    previousTopRef.current = nextTop
    const deltaY = previousTop === null ? 0 : previousTop - nextTop
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || Math.abs(deltaY) < 0.5) return

    const animation = divider.animate(
      [{ transform: `translate3d(0, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      {
        duration: TASK_TEMPORAL_DIVIDER_ANIMATION_MS,
        easing: TASK_TEMPORAL_DIVIDER_EASING,
        fill: 'both',
      },
    )
    animationRef.current = animation
    animation.onfinish = () => {
      if (animationRef.current !== animation) return
      animation.cancel()
      animationRef.current = null
    }
  }, [layoutRevision])

  useEffect(
    () => () => {
      animationRef.current?.cancel()
      animationRef.current = null
    },
    [],
  )

  return (
    <div
      ref={dividerRef}
      aria-label={`${groupLabel} tasks`}
      className="right-panel-task-temporal-divider"
      data-task-temporal-divider-id={laneId}
      role="separator"
    >
      <span>{groupLabel}</span>
    </div>
  )
}

export function BacklogPane({
  areas = DEFAULT_AREAS,
  groups,
  objectives = [],
  onCompleteUndatedTask,
  onOpenObjective,
  onOpenTask,

  setObjectives,
  unavailableTaskIds = [],
  weeklyFocusedObjectives,
  toolbarContent,
}) {
  const defaultArea = areas[0]?.label || 'Ritua'
  const [taskHorizon, setTaskHorizon] = useState('this-week')
  const [editingGroup, setEditingGroup] = useState(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftProjectId, setDraftProjectId] = useState('')
  const [draftArea, setDraftArea] = useState(defaultArea)
  const draftInputRef = useRef(null)
  const returnFocusRef = useRef(null)
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const anytimeGroup = groups.find((group) => group.label === 'Anytime') || {
    id: 'anytime',
    label: 'Anytime',
    items: [],
  }
  const somedayGroup = groups.find((group) => group.label === 'Someday') || {
    id: 'someday',
    label: 'Someday',
    items: [],
  }
  const unavailableTaskIdSet = new Set(unavailableTaskIds)
  const visibleAnytimeTasks = anytimeGroup.items.filter((task) => !unavailableTaskIdSet.has(task.id))
  const visibleSomedayTasks = somedayGroup.items.filter((task) => !unavailableTaskIdSet.has(task.id))
  const focusedProjects = (
    Array.isArray(weeklyFocusedObjectives) ? weeklyFocusedObjectives : objectives.filter(isFocusedThisWeek)
  ).filter(isFocusedThisWeek)
  const thisWeekProjectSections = focusedProjects
    .map((objective) => ({
      objective,
      anytimeTasks: visibleAnytimeTasks.filter((task) => task.objectiveId === objective.id),
      somedayTasks: [],
    }))
    .filter(({ objective, anytimeTasks }) => anytimeTasks.length || !objective.complete)
  const standaloneAnytimeTasks = visibleAnytimeTasks.filter((task) => !task.objectiveId)
  const standaloneSomedayTasks = visibleSomedayTasks.filter((task) => !task.objectiveId)
  const laterProjectSections = orderObjectivesForPanel(objectives, weeklyFocusedObjectives)
    .map((objective) => ({
      objective,
      anytimeTasks: visibleAnytimeTasks.filter((task) => task.objectiveId === objective.id),
      somedayTasks: visibleSomedayTasks.filter((task) => task.objectiveId === objective.id),
    }))
    .filter(
      ({ objective, anytimeTasks, somedayTasks }) =>
        anytimeTasks.length || somedayTasks.length || !objective.complete,
    )
  const temporalDividerRevision = JSON.stringify([
    [
      'standalone',
      standaloneAnytimeTasks.map((task) => task.id),
      standaloneSomedayTasks.map((task) => task.id),
    ],
    ...laterProjectSections.map(({ objective, anytimeTasks, somedayTasks }) => [
      objective.id,
      anytimeTasks.map((task) => task.id),
      somedayTasks.map((task) => task.id),
    ]),
  ])
  const thisWeekTaskCount = thisWeekProjectSections.reduce(
    (sum, section) => sum + section.anytimeTasks.length,
    standaloneAnytimeTasks.length,
  )
  const laterTaskCount = laterProjectSections.reduce(
    (sum, section) => sum + section.anytimeTasks.length + section.somedayTasks.length,
    standaloneAnytimeTasks.length + standaloneSomedayTasks.length,
  )
  const visibleTaskCount = taskHorizon === 'this-week' ? thisWeekTaskCount : laterTaskCount
  const moveBacklogTask = (move) => {
    const fields = movePanelBacklog(
      move,
      unavailableTaskIds,
      groups.flatMap((group) => group.items).find((task) => task.id === move.itemId),
    )
    groupsRef.current = fields.backlogGroups
  }
  const restoreBacklogCollection = (snapshot) => {
    groupsRef.current = snapshot.groups
    restoreBacklogCollections(snapshot)
  }
  const toggleBacklogTask = (taskId) => {
    const task = groups.flatMap((group) => group.items).find((item) => item.id === taskId)
    if (!task) return
    onCompleteUndatedTask?.(taskId)
  }
  useEffect(() => {
    if (editingGroup) draftInputRef.current?.focus()
  }, [editingGroup])

  const startAddingTask = (sectionKey, returnFocusElement, projectId = '') => {
    returnFocusRef.current = returnFocusElement
    setEditingGroup(sectionKey)
    setDraftTitle('')
    setDraftProjectId(projectId)
    setDraftArea(defaultArea)
    requestAnimationFrame(() => draftInputRef.current?.focus())
  }

  const cancelTaskDraft = () => {
    setEditingGroup(null)
    setDraftTitle('')
    setDraftProjectId('')
    setDraftArea(defaultArea)
    requestAnimationFrame(() => returnFocusRef.current?.focus?.())
  }

  const selectTaskHorizon = (horizon) => {
    setTaskHorizon(horizon)
    setEditingGroup(null)
    setDraftTitle('')
    setDraftProjectId('')
    setDraftArea(defaultArea)
  }

  const handleTaskHorizonKeyDown = (event) => {
    let nextHorizon
    if (event.key === 'ArrowLeft' || event.key === 'Home') {
      nextHorizon = 'this-week'
    } else if (event.key === 'ArrowRight' || event.key === 'End') {
      nextHorizon = 'later'
    } else {
      return
    }
    event.preventDefault()
    selectTaskHorizon(nextHorizon)
    requestAnimationFrame(() =>
      document.getElementById(`right-panel-task-horizon-tab-${nextHorizon}`)?.focus(),
    )
  }

  const createTask = (event, groupLabel, { preserveProject = false } = {}) => {
    event.preventDefault()
    const title = draftTitle.trim()
    if (!title) return
    const selectedProject = objectives.find(
      (objective) => objective.id === draftProjectId && !objective.complete,
    )
    if (draftProjectId && !selectedProject) return
    const taskId = `backlog-${Date.now()}`

    const group = groups.find((item) => item.label === groupLabel)
    if (!group) return
    dispatchTaskCommand({
      type: 'task.create',
      tasks: [
        {
          lane: `backlog:${group.id}`,
          task: {
            id: taskId,
            title,
            channel: selectedProject?.channel || draftArea,
            complete: false,
            ...(selectedProject ? { objectiveId: selectedProject.id } : {}),
          },
        },
      ],
      referencePrefix: 'objective',
    })
    setDraftTitle('')
    setDraftProjectId(preserveProject ? selectedProject?.id || '' : '')
    requestAnimationFrame(() => draftInputRef.current?.focus())
  }

  const renderBacklogTasks = (sectionTasks, sectionKey, groupLabel, objective = null) => (
    <SortableCollectionLane
      acceptExternalTaskDrop
      as="ul"
      className="right-panel-task-temporal-lane"
      collectionId={RIGHT_PANEL_BACKLOG_COLLECTION_ID}
      collectionSnapshot={{ groups, objectives }}
      externalDropData={{
        backlogDropTarget: true,
        backlogGroupLabel: groupLabel,
        backlogChannel: objective?.channel,
        backlogContextual: true,
        backlogObjectiveId: objective?.id || null,
      }}
      items={sectionTasks}
      laneId={sectionKey}
      onMove={moveBacklogTask}
      onRestore={restoreBacklogCollection}
      surfaceId="right-panel-backlog"
    >
      {({ collectionItemProps }) =>
        sectionTasks.map((item, index) => (
          <BacklogTaskRow
            collectionItem={collectionItemProps(item, index, { type: 'backlog', variant: 'panel' })}
            item={item}
            key={item.id}
            onOpen={onOpenTask}
            onToggle={toggleBacklogTask}
            variant="panel"
          />
        ))
      }
    </SortableCollectionLane>
  )

  const renderTaskLaneDropProxy = (children, { groupLabel, horizon, insertionIndex, objective = null }) => (
    <SortableCollectionDropProxy
      acceptExternalTaskDrop
      collectionId={RIGHT_PANEL_BACKLOG_COLLECTION_ID}
      externalDropData={{
        backlogDropTarget: true,
        backlogGroupLabel: groupLabel,
        backlogChannel: objective?.channel,
        backlogContextual: true,
        backlogObjectiveId: objective?.id || null,
      }}
      insertionIndex={insertionIndex}
      laneId={rightPanelTaskLaneId(horizon, groupLabel, objective?.id)}
      proxyId="add-task"
      surfaceId="right-panel-backlog"
    >
      {children}
    </SortableCollectionDropProxy>
  )

  const renderTemporalLane = (sectionTasks, horizon, groupLabel, objective = null) => {
    const laneId = rightPanelTaskLaneId(horizon, groupLabel, objective?.id)
    return (
      <>
        <TaskTemporalDivider
          groupLabel={groupLabel}
          laneId={laneId}
          layoutRevision={temporalDividerRevision}
        />
        {renderBacklogTasks(sectionTasks, laneId, groupLabel, objective)}
      </>
    )
  }

  const renderTaskDraft = (sectionKey, groupLabel, objective = null) =>
    editingGroup === sectionKey ? (
      <ul>
        <li className="right-panel-backlog-draft-shell">
          <form
            className={`right-panel-backlog-row right-panel-backlog-new-task-row ${
              objective ? 'right-panel-project-task-draft' : ''
            }`}
            onBlur={(event) => {
              if (
                !draftTitle.trim() &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.relatedTarget?.closest?.('[data-dropdown-root]')
              ) {
                cancelTaskDraft()
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelTaskDraft()
              }
            }}
            onSubmit={(event) =>
              createTask(event, groupLabel, {
                preserveProject: Boolean(objective),
              })
            }
          >
            <CheckCircle size={17} />
            <AutoGrowingTextarea
              ref={draftInputRef}
              aria-label={`New task in ${objective?.title || 'Standalone'}`}
              autoComplete="off"
              placeholder="Type a task title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  createTask(event, groupLabel, {
                    preserveProject: Boolean(objective),
                  })
                }
              }}
            />
            {!objective ? (
              <ChoiceDropdown
                label="Area for new standalone task"
                className="right-panel-task-area-select"
                value={draftArea}
                onChange={setDraftArea}
                options={areas.map((area) => ({ value: area.label, label: area.label }))}
              />
            ) : null}
          </form>
        </li>
      </ul>
    ) : null

  const renderProjectSection = ({ objective, anytimeTasks, somedayTasks }, horizon) => {
    const sectionKey = `${horizon}-project-${objective.id}`
    const taskCount = anytimeTasks.length + somedayTasks.length
    const captureGroupLabel = horizon === 'this-week' ? 'Anytime' : 'Someday'
    const addTaskButton = !objective.complete ? (
      <button
        className="backlog-add-task-button"
        type="button"
        aria-label={`Add task to ${objective.title}`}
        onClick={(event) => startAddingTask(sectionKey, event.currentTarget, objective.id)}
      >
        <Plus size={15} /> Add new task
      </button>
    ) : null
    return (
      <section
        className="right-panel-backlog-group right-panel-project-task-group"
        data-project-id={objective.id}
        key={objective.id}
      >
        <header>
          <button
            aria-label={`Open project ${objective.title}`}
            className="right-panel-project-heading-button"
            title={objective.title}
            type="button"
            onClick={(event) => onOpenObjective?.(objective, event.currentTarget)}
          >
            <FolderLabel channel={objective.channel} />
            <h3>{objective.title}</h3>
            <span className="right-panel-backlog-count">{taskCount}</span>
          </button>
        </header>
        {horizon === 'later' ? (
          <>
            {renderTemporalLane(anytimeTasks, horizon, 'Anytime', objective)}
            {renderTemporalLane(somedayTasks, horizon, 'Someday', objective)}
          </>
        ) : (
          renderBacklogTasks(
            anytimeTasks,
            rightPanelTaskLaneId(horizon, 'Anytime', objective.id),
            'Anytime',
            objective,
          )
        )}
        {renderTaskDraft(sectionKey, captureGroupLabel, objective)}
        {horizon === 'this-week' && addTaskButton
          ? renderTaskLaneDropProxy(addTaskButton, {
              groupLabel: 'Anytime',
              horizon,
              insertionIndex: anytimeTasks.length,
              objective,
            })
          : addTaskButton}
      </section>
    )
  }

  const renderStandaloneSection = ({ anytimeTasks, somedayTasks }, horizon) => {
    const sectionKey = `${horizon}-standalone`
    const taskCount =
      horizon === 'this-week' ? anytimeTasks.length : anytimeTasks.length + somedayTasks.length
    const addTaskButton = (
      <button
        className="backlog-add-task-button"
        type="button"
        aria-label={`Add standalone task to ${horizon === 'this-week' ? 'This week' : 'Later'}`}
        onClick={(event) => startAddingTask(sectionKey, event.currentTarget)}
      >
        <Plus size={15} /> Add new task
      </button>
    )
    return (
      <section className="right-panel-backlog-group right-panel-standalone-task-group">
        <header className="right-panel-standalone-heading">
          <span className="right-panel-standalone-icon" aria-hidden="true">
            <Stack size={14} />
          </span>
          <h3>Standalone</h3>
          <span className="right-panel-backlog-count">{taskCount}</span>
        </header>
        {horizon === 'later' ? (
          <>
            {renderTemporalLane(anytimeTasks, horizon, 'Anytime')}
            {renderTemporalLane(somedayTasks, horizon, 'Someday')}
          </>
        ) : (
          renderBacklogTasks(anytimeTasks, rightPanelTaskLaneId(horizon, 'Anytime'), 'Anytime')
        )}
        {renderTaskDraft(sectionKey, horizon === 'this-week' ? 'Anytime' : 'Someday')}
        {horizon === 'this-week'
          ? renderTaskLaneDropProxy(addTaskButton, {
              groupLabel: 'Anytime',
              horizon,
              insertionIndex: anytimeTasks.length,
            })
          : addTaskButton}
      </section>
    )
  }

  return (
    <div className="utility-pane backlog-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content backlog-pane-content">
        <UtilityPaneHeading icon={Stack} title="Tasks">
          <span className="utility-pane-count">{visibleTaskCount}</span>
        </UtilityPaneHeading>
        <div
          className="right-panel-task-horizon-tabs"
          role="tablist"
          aria-label="Task horizon"
          onKeyDown={handleTaskHorizonKeyDown}
        >
          <button
            aria-controls="right-panel-task-horizon-this-week"
            aria-selected={taskHorizon === 'this-week'}
            className={taskHorizon === 'this-week' ? 'active' : ''}
            id="right-panel-task-horizon-tab-this-week"
            role="tab"
            tabIndex={taskHorizon === 'this-week' ? 0 : -1}
            type="button"
            onClick={() => selectTaskHorizon('this-week')}
          >
            This week
          </button>
          <button
            aria-controls="right-panel-task-horizon-later"
            aria-selected={taskHorizon === 'later'}
            className={taskHorizon === 'later' ? 'active' : ''}
            id="right-panel-task-horizon-tab-later"
            role="tab"
            tabIndex={taskHorizon === 'later' ? 0 : -1}
            type="button"
            onClick={() => selectTaskHorizon('later')}
          >
            Later
          </button>
        </div>
        <div
          aria-labelledby={`right-panel-task-horizon-tab-${taskHorizon}`}
          className={`right-panel-backlog-list right-panel-task-horizon-${taskHorizon}`}
          id={`right-panel-task-horizon-${taskHorizon}`}
          role="tabpanel"
        >
          {taskHorizon === 'this-week' ? (
            <>
              {thisWeekProjectSections.map((section) => renderProjectSection(section, 'this-week'))}
              {renderStandaloneSection(
                {
                  anytimeTasks: standaloneAnytimeTasks,
                  somedayTasks: [],
                },
                'this-week',
              )}
            </>
          ) : (
            <>
              {renderStandaloneSection(
                {
                  anytimeTasks: standaloneAnytimeTasks,
                  somedayTasks: standaloneSomedayTasks,
                },
                'later',
              )}
              {laterProjectSections.map((section) => renderProjectSection(section, 'later'))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
