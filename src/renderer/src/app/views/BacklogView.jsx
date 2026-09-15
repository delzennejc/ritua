import { useWorkspaceTaskActions } from '../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../hooks/useWorkspaceCollections.js'
import { moveBacklogContext, restoreBacklogCollections } from '../../desktop/workspace-actions'
import { dispatchTaskCommand } from '../../desktop/workspace-actions'
import { normalizedChannel, reorderProjectSubset } from '../../../../domain/backlog-organization'
import { ChoiceDropdown } from '../components/Dropdown'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import {
  Archive,
  CalendarBlank,
  CaretDown,
  CaretRight,
  CheckCircle,
  Checks,
  Folder,
  Plus,
  Stack,
  PushPin,
} from '@phosphor-icons/react'
import { BacklogTaskRow } from '../components/BacklogTaskRow'
import { TaskProjectAction } from '../components/TaskProjectAction'
import { AutoGrowingTextarea } from '../components/DetailsTitleInput'
import { ProjectProgressCircle } from '../components/ProjectProgressCircle'
import { ProjectFocusButton } from '../components/ProjectFocusButton'
import { RightPanel } from '../components/RightPanel'
import { HorizonFilterControl } from '../components/TopControls'
import {
  acceptsExternalTaskDrop,
  SortableCollectionDropProxy,
  SortableCollectionItem,
  SortableCollectionLane,
} from '../components/SortableCollection'

const MAIN_BACKLOG_COLLECTION_ID = 'backlog-main-tasks'
const MAIN_BACKLOG_SURFACE_ID = 'backlog-main'
const BACKLOG_LAYOUT_ANIMATION_MS = 180
const BACKLOG_LAYOUT_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const HORIZON_LABELS = ['Anytime', 'Scheduled', 'Someday']
export function BacklogView({
  activeRightPane,
  onOpenArea,
  onRightPaneChange,
  onScopeChange,
  onToggleObjective,
  onToggleScheduledTask,
  scheduledItems = [],
  scope = 'anytime',
}) {
  const {
    onAssignObjective,
    onQuickSchedule,
    onUnscheduleTask,
    onCreateBoardTask,
    onCreateCalendarSession,
    onCompleteUndatedTask,
    onOpenObjective,
    onOpenTask,
  } = useWorkspaceTaskActions()

  const {
    areas,
    datedTasksByDate,
    events,
    backlogGroups: groups,
    objectives,
    setEvents,
    setObjectives,
    tasks,
    weeklyFocusedObjectives,
    setWeeklyFocusedObjectives,
    rightPanelUnavailableTaskIds,
  } = useWorkspaceCollections()

  const [editingContext, setEditingContext] = useState(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftProjectId, setDraftProjectId] = useState('')
  const [projectDraft, setProjectDraft] = useState(null)
  const [projectTitle, setProjectTitle] = useState('')
  const [projectChannel, setProjectChannel] = useState(() => areas[0]?.label || 'Ritua')
  const [visibleHorizonLabels, setVisibleHorizonLabels] = useState(HORIZON_LABELS)
  const [collapsedProjectSections, setCollapsedProjectSections] = useState(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set())
  const selectionTriggerRef = useRef(null)
  const draftInputRef = useRef(null)
  const draftTitleRef = useRef('')
  const draftReturnFocusRef = useRef(null)
  const projectInputRef = useRef(null)
  const projectReturnFocusRef = useRef(null)
  const backlogLayoutRef = useRef(null)
  const pendingLayoutPositionsRef = useRef(null)
  const layoutAnimationsRef = useRef(new Map())
  const groupsRef = useRef(groups)
  const objectivesRef = useRef(objectives)
  groupsRef.current = groups
  objectivesRef.current = objectives

  const projectId = scope.startsWith('project:') ? scope.slice('project:'.length) : null
  const areaId = scope.startsWith('area:') ? scope.slice('area:'.length) : null
  const activeProject = objectives.find((objective) => objective.id === projectId) || null
  const activeArea = areas.find((area) => area.id === areaId || area.label === activeProject?.channel) || null
  const activeListLabel = scope === 'scheduled' ? 'Scheduled' : scope === 'someday' ? 'Someday' : 'Anytime'
  const taskGroups = useMemo(() => {
    const scheduledGroup = {
      id: 'scheduled',
      label: 'Scheduled',
      marker: 'D',
      tone: 'violet',
      items: scheduledItems,
    }
    const anytimeGroup = groups.find((group) => group.label === 'Anytime')
    const somedayGroup = groups.find((group) => group.label === 'Someday')
    return [anytimeGroup, scheduledGroup, somedayGroup].filter(Boolean)
  }, [groups, scheduledItems])
  const activeList = taskGroups.find((group) => group.label === activeListLabel) || {
    id: activeListLabel.toLowerCase(),
    label: activeListLabel,
    items: [],
  }
  const knownProjectIds = useMemo(() => new Set(objectives.map((objective) => objective.id)), [objectives])

  const scopeLabel = activeProject?.title || activeArea?.label || activeListLabel
  const scopeDescription = activeProject
    ? `${activeProject.complete ? 'Completed project' : 'Project'} in ${activeProject.channel}`
    : activeArea
      ? (() => {
          const projectCount = objectives.filter(
            (objective) => !objective.complete && objective.channel === activeArea.label,
          ).length
          return `${projectCount} active ${projectCount === 1 ? 'project' : 'projects'}`
        })()
      : activeListLabel === 'Scheduled'
        ? 'Tasks planned for today and later'
        : activeListLabel === 'Someday'
          ? 'Ideas and work without a current commitment'
          : 'Available tasks, grouped by area and project'
  const isScheduledList = activeListLabel === 'Scheduled'
  const canCreateProjectInCurrentScope = !isScheduledList && areas.length > 0
  const pageDropData = {
    backlogDropTarget: !isScheduledList,
    backlogGroupLabel: activeListLabel,
    backlogChannel: activeProject?.channel || activeArea?.label,
    backlogContextual: Boolean(activeProject || activeArea),
    backlogObjectiveId: activeProject?.id || null,
  }
  const pageDrop = useDroppable({
    id: `backlog-page:${scope}`,
    type: 'backlog-page',
    accept: isScheduledList ? () => false : acceptsExternalTaskDrop,
    collisionPriority: CollisionPriority.Lowest,
    data: {
      kind: 'backlog-page',
      scope,
      ...pageDropData,
    },
  })
  const ScopeIcon = activeProject
    ? PushPin
    : activeArea
      ? Folder
      : activeListLabel === 'Scheduled'
        ? CalendarBlank
        : activeListLabel === 'Someday'
          ? Archive
          : Stack
  const scopeBreadcrumb = activeProject
    ? [
        {
          label: activeProject.channel,
          scope: activeArea ? `area:${activeArea.id}` : 'anytime',
        },
        { label: activeProject.title, scope: `project:${activeProject.id}` },
      ]
    : activeArea
      ? [{ label: activeArea.label, scope: `area:${activeArea.id}` }]
      : [{ label: activeListLabel, scope }]

  useEffect(() => {
    if (editingContext) draftInputRef.current?.focus()
  }, [editingContext])

  useEffect(() => {
    if (projectDraft) projectInputRef.current?.focus()
  }, [projectDraft])

  const captureBacklogLayoutPositions = () => {
    const positions = new Map()
    backlogLayoutRef.current?.querySelectorAll('[data-backlog-layout-key]').forEach((element) => {
      const key = element.dataset.backlogLayoutKey
      const rect = element.getBoundingClientRect()
      positions.set(key, { left: rect.left, top: rect.top })
    })
    pendingLayoutPositionsRef.current = positions
  }

  useLayoutEffect(() => {
    const previousPositions = pendingLayoutPositionsRef.current
    if (!previousPositions) return
    pendingLayoutPositionsRef.current = null

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    backlogLayoutRef.current?.querySelectorAll('[data-backlog-layout-key]').forEach((element) => {
      const key = element.dataset.backlogLayoutKey
      const previousPosition = previousPositions.get(key)
      const previousAnimation = layoutAnimationsRef.current.get(key)
      previousAnimation?.cancel()
      layoutAnimationsRef.current.delete(key)
      if (!previousPosition || reduceMotion) return

      const nextPosition = element.getBoundingClientRect()
      const deltaX = previousPosition.left - nextPosition.left
      const deltaY = previousPosition.top - nextPosition.top
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

      const animation = element.animate(
        [{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        {
          duration: BACKLOG_LAYOUT_ANIMATION_MS,
          easing: BACKLOG_LAYOUT_ANIMATION_EASING,
          fill: 'both',
        },
      )
      layoutAnimationsRef.current.set(key, animation)
      animation.onfinish = () => {
        if (layoutAnimationsRef.current.get(key) !== animation) return
        animation.cancel()
        layoutAnimationsRef.current.delete(key)
      }
    })
  }, [groups, objectives])

  useEffect(
    () => () => {
      layoutAnimationsRef.current.forEach((animation) => animation.cancel())
      layoutAnimationsRef.current.clear()
    },
    [],
  )

  const contextForArea = (area, items = [], listLabel = activeListLabel) => ({
    channel: area.label,
    items,
    key: `area-${area.id}-${listLabel.toLowerCase()}`,
    label: area.label,
    listLabel,
    matchesItem: (item) =>
      normalizedChannel(item.channel) === area.label &&
      (!item.objectiveId || !knownProjectIds.has(item.objectiveId)),
  })

  const contextForProject = (project, items = [], listLabel = activeListLabel) => ({
    channel: project.channel,
    items,
    key: `project-${project.id}-${listLabel.toLowerCase()}`,
    label: project.title,
    listLabel,
    objectiveId: project.id,
    matchesItem: (item) => item.objectiveId === project.id,
  })

  const projectTemporalSections = activeProject
    ? taskGroups
        .filter((group) => visibleHorizonLabels.includes(group.label))
        .map((group) => ({
          group,
          context: contextForProject(
            activeProject,
            group.items.filter((item) => item.objectiveId === activeProject.id),
            group.label,
          ),
        }))
    : []

  const areaTemporalSections =
    activeArea && !activeProject
      ? taskGroups
          .filter((group) => visibleHorizonLabels.includes(group.label))
          .map((group) => {
            const looseItems = group.items.filter(
              (item) =>
                normalizedChannel(item.channel) === activeArea.label &&
                (!item.objectiveId || !knownProjectIds.has(item.objectiveId)),
            )
            const projectSections = objectives
              .filter((project) => project.channel === activeArea.label)
              .map((project) => ({
                project,
                items: group.items.filter((item) => item.objectiveId === project.id),
              }))
              .filter(({ project, items }) => !project.complete || items.length > 0)

            return {
              group,
              looseContext: contextForArea(activeArea, looseItems, group.label),
              projectSections,
              taskCount:
                looseItems.length + projectSections.reduce((sum, section) => sum + section.items.length, 0),
            }
          })
      : []

  const areaSections = areas
    .map((area) => {
      const projects = objectives.filter(
        (objective) =>
          (!objective.complete ||
            objective.id === projectId ||
            activeList.items.some((item) => item.objectiveId === objective.id)) &&
          objective.channel === area.label,
      )
      const looseItems = projectId
        ? []
        : activeList.items.filter(
            (item) =>
              normalizedChannel(item.channel) === area.label &&
              (!item.objectiveId || !knownProjectIds.has(item.objectiveId)),
          )
      const projectSections = projects
        .map((project) => ({
          project,
          items: activeList.items.filter((item) => item.objectiveId === project.id),
        }))
        .filter(
          ({ project, items }) =>
            project.id === projectId ||
            area.id === areaId ||
            (!areaId && !projectId && (!project.complete || items.length)),
        )
      const visible =
        area.id === areaId ||
        activeProject?.channel === area.label ||
        editingContext?.channel === area.label ||
        projectDraft?.areaId === area.id ||
        (!areaId && !projectId && (looseItems.length || projectSections.length))

      return {
        area,
        looseItems,
        projectSections,
        taskCount:
          looseItems.length + projectSections.reduce((sum, section) => sum + section.items.length, 0),
        visible,
      }
    })
    .filter((section) => section.visible)

  const selectableTasks = activeProject
    ? projectTemporalSections.flatMap(({ context }) => context.items)
    : activeArea
      ? areaTemporalSections.flatMap(({ group, looseContext, projectSections }) => [
          ...looseContext.items,
          ...projectSections.flatMap(({ project, items }) =>
            collapsedProjectSections.has(`${group.label}:${project.id}`) ? [] : items,
          ),
        ])
      : areaSections.flatMap(({ looseItems, projectSections }) => [
          ...looseItems,
          ...projectSections.flatMap(({ project, items }) =>
            collapsedProjectSections.has(`${activeListLabel}:${project.id}`) ? [] : items,
          ),
        ])
  const selectedTasks = selectableTasks.filter((task) => selectedTaskIds.has(task.id))
  const allSelected = selectableTasks.length > 0 && selectedTasks.length === selectableTasks.length

  useEffect(() => {
    setSelectionMode(false)
    setSelectedTaskIds(new Set())
  }, [scope, visibleHorizonLabels])

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedTaskIds(new Set())
    requestAnimationFrame(() => selectionTriggerRef.current?.focus({ preventScroll: true }))
  }

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const assignSelectedTasks = (projectId) => {
    if (!selectedTasks.length) return
    captureBacklogLayoutPositions()
    dispatchTaskCommand({
      type: 'task.assign-many',
      taskIds: selectedTasks.map((task) => task.id),
      projectId,
    })
    exitSelection()
  }

  const toggleProjectSection = (project, listLabel) => {
    const sectionKey = `${listLabel}:${project.id}`
    captureBacklogLayoutPositions()
    setCollapsedProjectSections((current) => {
      const next = new Set(current)
      if (next.has(sectionKey)) next.delete(sectionKey)
      else next.add(sectionKey)
      return next
    })
  }

  const toggleProjectFocus = (projectId) => {
    setObjectives((items) =>
      items.map((project) =>
        project.id === projectId
          ? { ...project, focusedThisWeek: project.focusedThisWeek === false }
          : project,
      ),
    )
  }

  const startAddingTask = (context, returnFocusElement) => {
    // Clicking Add task does not always blur the current editor first (notably on macOS).
    if (
      editingContext &&
      draftTitleRef.current.trim() &&
      !saveTaskDraft(editingContext, { continueAdding: false })
    )
      return
    draftReturnFocusRef.current = returnFocusElement || document.activeElement
    setEditingContext(context)
    draftTitleRef.current = ''
    setDraftTitle('')
    setDraftProjectId(context.objectiveId || '')
    requestAnimationFrame(() => draftInputRef.current?.focus())
  }

  const cancelTaskDraft = ({ returnFocus = true } = {}) => {
    draftTitleRef.current = ''
    setEditingContext(null)
    setDraftTitle('')
    setDraftProjectId('')
    if (returnFocus) requestAnimationFrame(() => draftReturnFocusRef.current?.focus?.())
  }

  useEffect(() => {
    if (
      editingContext?.objectiveId &&
      objectives.some((objective) => objective.id === editingContext.objectiveId && objective.complete)
    ) {
      cancelTaskDraft()
    }
  }, [editingContext, objectives])

  const defaultAggregateListLabel = visibleHorizonLabels.includes('Anytime')
    ? 'Anytime'
    : visibleHorizonLabels.includes('Someday')
      ? 'Someday'
      : null

  const defaultTaskContext = () => {
    if (activeProject) {
      const listLabel = defaultAggregateListLabel || 'Anytime'
      const list = taskGroups.find((group) => group.label === listLabel) || activeList
      const projectItems = list.items.filter((item) => item.objectiveId === activeProject.id)
      return contextForProject(activeProject, projectItems, listLabel)
    }
    if (activeArea) {
      const listLabel = defaultAggregateListLabel || 'Anytime'
      const list = taskGroups.find((group) => group.label === listLabel) || activeList
      const looseItems = list.items.filter(
        (item) =>
          normalizedChannel(item.channel) === activeArea.label &&
          (!item.objectiveId || !knownProjectIds.has(item.objectiveId)),
      )
      return contextForArea(activeArea, looseItems, listLabel)
    }
    const fallbackArea = areas[0]
    const looseItems = activeList.items.filter(
      (item) =>
        normalizedChannel(item.channel) === fallbackArea.label &&
        (!item.objectiveId || !knownProjectIds.has(item.objectiveId)),
    )
    return {
      ...contextForArea(fallbackArea, looseItems),
      allowProjectChoice: true,
    }
  }

  const saveTaskDraft = (context, { continueAdding = true } = {}) => {
    const title = draftTitleRef.current.trim()
    if (!title) return
    const selectedProject = context.allowProjectChoice
      ? objectives.find((objective) => objective.id === draftProjectId)
      : null
    const resolvedContext = selectedProject
      ? {
          channel: selectedProject.channel,
          objectiveId: selectedProject.id,
        }
      : context
    const destinationProject = resolvedContext.objectiveId
      ? objectives.find((objective) => objective.id === resolvedContext.objectiveId)
      : null
    if (destinationProject?.complete) {
      cancelTaskDraft({ returnFocus: continueAdding })
      return
    }

    const taskId = `backlog-${Date.now()}`
    const task = {
      id: taskId,
      title,
      channel: resolvedContext.channel,
      complete: false,
      ...(resolvedContext.objectiveId ? { objectiveId: resolvedContext.objectiveId } : {}),
    }

    const targetListLabel = resolvedContext.listLabel || activeListLabel
    const group = groups.find((item) => item.label === targetListLabel)
    if (!group) return
    dispatchTaskCommand({
      type: 'task.create',
      tasks: [{ task, lane: `backlog:${group.id}` }],
      referencePrefix: 'objective',
    })
    draftTitleRef.current = ''
    setDraftTitle('')
    if (continueAdding) requestAnimationFrame(() => draftInputRef.current?.focus())
    else cancelTaskDraft({ returnFocus: false })
    return true
  }

  const toggleTask = (taskId) => {
    const task = groups.flatMap((group) => group.items).find((item) => item.id === taskId)
    if (!task) {
      if (scheduledItems.some((item) => item.id === taskId)) {
        onToggleScheduledTask?.(taskId)
      }
      return
    }
    onCompleteUndatedTask?.(taskId)
  }

  const moveTaskInContext = (context, move) => {
    const targetData = move.targetData || {
      backlogGroupLabel: context.listLabel || activeListLabel,
      backlogChannel: context.channel,
      backlogObjectiveId: context.objectiveId || null,
    }
    if (targetData.backlogScheduleTarget) return
    const targetProject = targetData.backlogObjectiveId
      ? objectivesRef.current.find((objective) => objective.id === targetData.backlogObjectiveId)
      : null
    if (targetProject?.complete) return

    captureBacklogLayoutPositions()
    const fields = moveBacklogContext({ ...move, targetData })
    groupsRef.current = fields.backlogGroups
    objectivesRef.current = fields.weeklyObjectives
  }

  const moveProjectsInArea = (projectIds, move) => {
    setObjectives((items) => reorderProjectSubset(items, projectIds, move))
  }

  const startAddingProject = (area, returnFocusElement) => {
    if (!canCreateProjectInCurrentScope) return
    projectReturnFocusRef.current = returnFocusElement || document.activeElement
    setProjectTitle('')
    setProjectChannel(area?.label || activeArea?.label || 'Ritua')
    setProjectDraft({ areaId: area?.id || null })
    requestAnimationFrame(() => projectInputRef.current?.focus())
  }

  const cancelProjectDraft = () => {
    setProjectDraft(null)
    setProjectTitle('')
    requestAnimationFrame(() => projectReturnFocusRef.current?.focus?.())
  }

  const createProject = (event) => {
    event.preventDefault()
    if (!canCreateProjectInCurrentScope) return
    const title = projectTitle.trim()
    if (!title) return

    const draftArea = areas.find((area) => area.id === projectDraft?.areaId)
    const id = `objective-${Date.now()}`
    setObjectives((items) => [
      ...items,
      {
        id,
        title,
        channel: draftArea?.label || projectChannel,
        complete: false,
        focusedThisWeek: false,
        tasks: [],
      },
    ])
    setProjectTitle('')
    setProjectDraft(null)
    if (!draftArea) onScopeChange?.(`project:${id}`)
  }

  const renderAreaProjectDraft = (area) => {
    if (!canCreateProjectInCurrentScope || projectDraft?.areaId !== area.id) return null

    return (
      <form
        className="work-area-project-create"
        onBlur={(event) => {
          if (
            !projectTitle.trim() &&
            !event.currentTarget.contains(event.relatedTarget) &&
            !event.relatedTarget?.closest?.('[data-dropdown-root]')
          ) {
            cancelProjectDraft()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelProjectDraft()
          }
        }}
        onSubmit={createProject}
      >
        <PushPin mirrored size={17} style={{ color: area.color }} />
        <AutoGrowingTextarea
          ref={projectInputRef}
          aria-label={`New project in ${area.label}`}
          autoComplete="off"
          placeholder="Name the result you want to achieve"
          value={projectTitle}
          onChange={(event) => setProjectTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              createProject(event)
            }
          }}
        />
      </form>
    )
  }

  const renderDraft = (context) => {
    if (editingContext?.key !== context.key) return null
    const draftContext = editingContext

    return (
      <form
        className="backlog-row backlog-new-task-row"
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            !event.relatedTarget?.closest?.('[data-dropdown-root]')
          ) {
            if (draftTitleRef.current.trim()) {
              saveTaskDraft(draftContext, { continueAdding: false })
            } else {
              cancelTaskDraft({ returnFocus: false })
            }
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelTaskDraft()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          saveTaskDraft(draftContext)
        }}
      >
        <span className="backlog-completion-toggle" aria-hidden="true">
          <CheckCircle size={19} />
        </span>
        <AutoGrowingTextarea
          ref={draftInputRef}
          aria-label={`New task in ${draftContext.label}`}
          autoComplete="off"
          placeholder="Type a task title"
          value={draftTitle}
          onChange={(event) => {
            draftTitleRef.current = event.target.value
            setDraftTitle(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              saveTaskDraft(draftContext)
            }
          }}
        />
        {draftContext.allowProjectChoice ? (
          <ChoiceDropdown
            label="Optional project"
            value={draftProjectId}
            onChange={setDraftProjectId}
            options={[
              { value: '', label: `Standalone in ${draftContext.channel}` },
              ...objectives
                .filter((project) => !project.complete)
                .map((project) => ({ value: project.id, label: `${project.channel} · ${project.title}` })),
            ]}
          />
        ) : null}
      </form>
    )
  }

  const taskContextDropData = (context) => {
    const scheduledContext = context.listLabel === 'Scheduled'
    return {
      backlogDropTarget: !scheduledContext,
      backlogScheduleTarget: scheduledContext,
      backlogGroupLabel: context.listLabel || activeList.label,
      backlogChannel: context.channel,
      backlogContextual: true,
      backlogObjectiveId: context.objectiveId || null,
    }
  }

  const taskContextDropProxyProps = (context) => ({
    acceptExternalTaskDrop: true,
    collectionId: MAIN_BACKLOG_COLLECTION_ID,
    externalDropData: taskContextDropData(context),
    laneId: context.key,
    proxyId: `${context.key}-header`,
    surfaceId: MAIN_BACKLOG_SURFACE_ID,
  })

  const restoreTaskCollection = (snapshot) => {
    captureBacklogLayoutPositions()
    groupsRef.current = snapshot.groups
    objectivesRef.current = snapshot.objectives
    restoreBacklogCollections(snapshot)
  }

  const renderTaskContext = (
    context,
    { addLabel = 'Add task', emptyLabel = null, showAddRow = true } = {},
  ) => {
    const scheduledContext = context.listLabel === 'Scheduled'
    const renderRows = (collectionItemProps = null) =>
      context.items.map((item, index) => {
        const visibleDateItems = scheduledContext
          ? context.items.filter((candidate) => candidate.scheduledDateKey === item.scheduledDateKey)
          : []
        return (
          <BacklogTaskRow
            boardDateKey={scheduledContext ? item.scheduledDateKey : undefined}
            boardIndex={scheduledContext ? item.scheduledDateIndex : undefined}
            boardSurfaceId={scheduledContext ? `${MAIN_BACKLOG_SURFACE_ID}-scheduled` : undefined}
            boardVisibleIndex={
              scheduledContext
                ? visibleDateItems.findIndex((candidate) => candidate.id === item.id)
                : undefined
            }
            boardVisibleTaskIds={
              scheduledContext ? visibleDateItems.map((candidate) => candidate.id) : undefined
            }
            collectionItem={
              collectionItemProps
                ? collectionItemProps(item, index, { type: 'backlog', variant: 'main' })
                : null
            }
            item={item}
            key={item.id}
            onOpen={onOpenTask}
            onToggle={toggleTask}
            selection={
              selectionMode
                ? { checked: selectedTaskIds.has(item.id), onToggle: toggleTaskSelection }
                : undefined
            }
            projectAction={
              !activeProject && !selectionMode ? (
                <TaskProjectAction
                  tasks={[item]}
                  projects={objectives}
                  onAssign={(projectId) => {
                    captureBacklogLayoutPositions()
                    onAssignObjective(item, projectId)
                    requestAnimationFrame(() => {
                      const movedRow = backlogLayoutRef.current?.querySelector(
                        `[data-task-layout-id="${CSS.escape(item.id)}"] .backlog-project-trigger`,
                      )
                      ;(movedRow || selectionTriggerRef.current)?.focus({ preventScroll: true })
                    })
                  }}
                />
              ) : null
            }
            showArea={false}
          />
        )
      })
    const content = (collectionItemProps = null) => (
      <>
        {renderRows(collectionItemProps)}
        {!context.items.length && emptyLabel && editingContext?.key !== context.key ? (
          <p className="empty-row">{emptyLabel}</p>
        ) : null}
        {!scheduledContext ? renderDraft(context) : null}
        {showAddRow && !scheduledContext ? (
          <button
            className="backlog-add-task-button"
            data-backlog-layout-key={`add-task:${context.key}`}
            type="button"
            onClick={(event) => startAddingTask(context, event.currentTarget)}
          >
            <Plus size={15} /> {addLabel}
          </button>
        ) : null}
      </>
    )

    return (
      <div className="work-task-context" key={context.key}>
        {scheduledContext ? (
          <SortableCollectionLane
            acceptExternalTaskDrop
            className="backlog-group-items backlog-scheduled-drop-lane"
            collectionId={MAIN_BACKLOG_COLLECTION_ID}
            collectionSnapshot={{ groups, objectives }}
            externalDropData={taskContextDropData(context)}
            items={[]}
            laneId={context.key}
            onMove={(move) => moveTaskInContext(context, move)}
            onRestore={restoreTaskCollection}
            surfaceId={MAIN_BACKLOG_SURFACE_ID}
          >
            {content()}
          </SortableCollectionLane>
        ) : (
          <SortableCollectionLane
            acceptExternalTaskDrop
            className="backlog-group-items"
            collectionId={MAIN_BACKLOG_COLLECTION_ID}
            collectionSnapshot={{ groups, objectives }}
            externalDropData={taskContextDropData(context)}
            items={context.items}
            laneId={context.key}
            onMove={(move) => moveTaskInContext(context, move)}
            onRestore={restoreTaskCollection}
            surfaceId={MAIN_BACKLOG_SURFACE_ID}
          >
            {({ collectionItemProps }) => content(collectionItemProps)}
          </SortableCollectionLane>
        )}
      </div>
    )
  }

  const renderProjectSection = (area, project, items, collectionItem = null, listLabel = activeListLabel) => {
    const context = contextForProject(project, items, listLabel)
    const sectionKey = `${listLabel}:${project.id}`
    const collapsed = collapsedProjectSections.has(sectionKey)
    const sectionContent = (
      <>
        {project.id !== projectId ? (
          <SortableCollectionDropProxy
            as="header"
            className="work-project-header"
            data-backlog-project-openable="true"
            data-backlog-layout-key={`header:${context.key}`}
            {...taskContextDropProxyProps(context)}
            onClick={(event) => {
              if (event.defaultPrevented) return
              const actionTarget = event.target?.closest?.('button')
              if (
                actionTarget &&
                actionTarget !== event.currentTarget &&
                event.currentTarget.contains(actionTarget)
              )
                return
              const returnFocusElement = event.currentTarget.querySelector('[data-objective-title-id]')
              onOpenObjective?.(project, returnFocusElement || event.currentTarget)
            }}
          >
            <button
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${project.title} in ${listLabel}`}
              className="work-project-collapse-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                toggleProjectSection(project, listLabel)
              }}
            >
              {collapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
            </button>
            <ProjectProgressCircle complete={project.complete} size={17} tasks={project.tasks || []} />
            <ProjectFocusButton project={project} onToggle={toggleProjectFocus} />
            <button
              type="button"
              className="work-project-title"
              data-objective-title-id={project.id}
              onClick={(event) => {
                event.stopPropagation()
                onOpenObjective?.(project, event.currentTarget)
              }}
            >
              {project.title}
            </button>
            <span>
              {items.length} {items.length === 1 ? 'task' : 'tasks'}
            </span>
          </SortableCollectionDropProxy>
        ) : null}
        {!collapsed
          ? renderTaskContext(context, {
              addLabel: 'Add task',
              emptyLabel: 'No tasks in this project yet.',
              showAddRow: !project.complete,
            })
          : null}
      </>
    )
    const sectionClassName =
      `work-project-section ${project.id === projectId ? 'focused' : ''} ${project.complete ? 'complete' : ''} ${collapsed ? 'collapsed' : ''}`.trim()

    if (!collectionItem) {
      return (
        <section className={sectionClassName} key={project.id}>
          {sectionContent}
        </section>
      )
    }

    return (
      <SortableCollectionItem
        as="section"
        aria-label={`Drag ${project.title} to reorder projects in ${area.label}`}
        className={sectionClassName}
        key={project.id}
        pointerActivationDistance={5}
        pointerActivatorSelector=".work-project-header"
        {...collectionItem}
      >
        {sectionContent}
      </SortableCollectionItem>
    )
  }

  return (
    <div className="surface-row backlog-layout">
      <section
        ref={pageDrop.ref}
        className="backlog-view"
        onKeyDown={(event) => {
          if (selectionMode && event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault()
            exitSelection()
          }
        }}
        data-backlog-drop-zone={pageDropData.backlogDropTarget ? 'true' : undefined}
        data-backlog-page-drop-zone={pageDropData.backlogDropTarget ? 'true' : undefined}
        data-backlog-page-scope={scope}
        data-backlog-group-label={pageDropData.backlogGroupLabel}
        data-backlog-channel={pageDropData.backlogChannel}
        data-backlog-contextual={pageDropData.backlogContextual ? 'true' : undefined}
        data-backlog-objective-id={pageDropData.backlogObjectiveId || undefined}
      >
        <div className="backlog-toolbar">
          <nav className="backlog-toolbar-scope" aria-label="Breadcrumb">
            <ScopeIcon
              mirrored={ScopeIcon === PushPin}
              size={15}
              weight={activeArea && !activeProject ? 'fill' : 'regular'}
            />
            <ol>
              {scopeBreadcrumb.map((item, index) => (
                <li key={`${item.scope}-${item.label}`}>
                  <button
                    aria-current={index === scopeBreadcrumb.length - 1 ? 'page' : undefined}
                    className="backlog-breadcrumb-button"
                    type="button"
                    onClick={() => onScopeChange?.(item.scope)}
                  >
                    {item.label}
                  </button>
                  {index < scopeBreadcrumb.length - 1 ? <span aria-hidden="true">/</span> : null}
                </li>
              ))}
            </ol>
          </nav>
          <span className="backlog-toolbar-spacer" />
          {!activeProject ? (
            <>
              {selectionMode ? (
                <>
                  <span className="backlog-selection-count" role="status">
                    {selectedTasks.length} selected
                  </span>
                  <button
                    type="button"
                    disabled={!selectableTasks.length}
                    onClick={() =>
                      setSelectedTaskIds(
                        allSelected ? new Set() : new Set(selectableTasks.map((task) => task.id)),
                      )
                    }
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  <TaskProjectAction
                    tasks={selectedTasks}
                    projects={objectives}
                    onAssign={assignSelectedTasks}
                    bulk
                  />
                </>
              ) : null}
              <button
                ref={selectionTriggerRef}
                type="button"
                aria-pressed={selectionMode}
                onClick={() => {
                  if (selectionMode) exitSelection()
                  else setSelectionMode(true)
                }}
              >
                <Checks size={15} aria-hidden="true" /> {selectionMode ? 'Cancel' : 'Select tasks'}
              </button>
            </>
          ) : null}
          {activeArea || activeProject ? (
            <HorizonFilterControl
              horizons={HORIZON_LABELS}
              selectedHorizons={visibleHorizonLabels}
              onHorizonFilterChange={setVisibleHorizonLabels}
            />
          ) : null}
          {!(activeArea || activeProject) && activeListLabel !== 'Scheduled' && areas.length ? (
            <button
              type="button"
              onClick={(event) => startAddingTask(defaultTaskContext(), event.currentTarget)}
            >
              <Plus size={15} /> Add task
            </button>
          ) : null}
        </div>

        <div className="work-index-content">
          <header className="work-index-heading">
            {activeProject ? (
              <button
                className="work-index-heading-icon work-index-heading-completion"
                type="button"
                aria-label={activeProject.complete ? 'Mark project incomplete' : 'Mark project complete'}
                style={{
                  '--work-scope-color': activeProject.complete ? 'var(--green)' : 'var(--faint)',
                }}
                onClick={() => onToggleObjective?.(activeProject.id)}
              >
                <CheckCircle size={24} weight={activeProject.complete ? 'fill' : 'regular'} />
              </button>
            ) : (
              <span
                className="work-index-heading-icon"
                style={{ '--work-scope-color': activeArea?.color || '#7b5bd2' }}
              >
                <ScopeIcon
                  mirrored={ScopeIcon === PushPin}
                  size={24}
                  weight={activeArea ? 'fill' : 'regular'}
                />
              </span>
            )}
            <span>
              <h1
                className={activeProject ? 'work-index-project-heading' : undefined}
                aria-label={activeProject ? scopeLabel : undefined}
              >
                {activeProject ? (
                  <ProjectFocusButton project={activeProject} onToggle={toggleProjectFocus} />
                ) : null}
                {activeProject ? (
                  <button
                    className="work-index-project-title"
                    data-objective-title-id={activeProject.id}
                    type="button"
                    onClick={(event) => onOpenObjective?.(activeProject, event.currentTarget)}
                  >
                    {scopeLabel}
                  </button>
                ) : activeArea ? (
                  <button
                    className="work-index-project-title work-index-area-title"
                    data-area-title-id={activeArea.id}
                    type="button"
                    onClick={(event) => onOpenArea?.(activeArea, event.currentTarget)}
                  >
                    {scopeLabel}
                  </button>
                ) : (
                  scopeLabel
                )}
              </h1>
              <p>{scopeDescription}</p>
            </span>
          </header>

          {canCreateProjectInCurrentScope && projectDraft?.areaId === null ? (
            <form className="work-project-create" onSubmit={createProject}>
              <PushPin mirrored size={18} />
              <AutoGrowingTextarea
                ref={projectInputRef}
                aria-label="New project title"
                autoComplete="off"
                placeholder="Name the result you want to achieve"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    createProject(event)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelProjectDraft()
                  }
                }}
              />
              <ChoiceDropdown
                label="Project area"
                value={projectChannel}
                onChange={setProjectChannel}
                options={areas.map((area) => ({ value: area.label, label: area.label }))}
              />
              <button type="submit">Create</button>
            </form>
          ) : null}

          <div className="work-area-list" ref={backlogLayoutRef}>
            {activeProject ? (
              projectTemporalSections.map(({ group, context }) => (
                <section className="work-temporal-section" key={group.id}>
                  <SortableCollectionDropProxy
                    as="header"
                    className="work-temporal-header"
                    data-backlog-layout-key={`header:${context.key}`}
                    {...taskContextDropProxyProps(context)}
                  >
                    <strong>{group.label}</strong>
                    <span>
                      {context.items.length} {context.items.length === 1 ? 'task' : 'tasks'}
                    </span>
                  </SortableCollectionDropProxy>
                  {renderTaskContext(context, {
                    addLabel: `Add task to ${group.label}`,
                    emptyLabel: activeProject.complete ? 'No tasks in this list.' : 'No tasks here yet.',
                    showAddRow: !activeProject.complete && group.label !== 'Scheduled',
                  })}
                </section>
              ))
            ) : activeArea ? (
              <section className="work-area-section focused">
                {areaTemporalSections.map(({ group, looseContext, projectSections, taskCount }) => (
                  <section className="work-temporal-section" key={group.id}>
                    <SortableCollectionDropProxy
                      as="header"
                      className="work-temporal-header"
                      data-backlog-layout-key={`header:${looseContext.key}`}
                      {...taskContextDropProxyProps(looseContext)}
                    >
                      <strong>{group.label}</strong>
                      <span>
                        {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                      </span>
                    </SortableCollectionDropProxy>

                    {renderTaskContext(looseContext, {
                      addLabel: `Add task to ${activeArea.label}`,
                      emptyLabel: projectSections.length ? null : 'No standalone tasks yet.',
                      showAddRow: group.label !== 'Scheduled',
                    })}

                    {projectSections.length ? (
                      <SortableCollectionLane
                        className="work-area-project-list"
                        collectionId={`area-projects-${activeArea.id}-${group.id}`}
                        collectionSnapshot={objectives}
                        items={projectSections.map(({ project }) => project)}
                        laneId={`${activeArea.id}-${group.id}`}
                        onMove={(move) =>
                          moveProjectsInArea(
                            projectSections.map(({ project }) => project.id),
                            move,
                          )
                        }
                        onRestore={setObjectives}
                        surfaceId={`backlog-area-projects-${activeArea.id}-${group.id}`}
                      >
                        {({ collectionItemProps }) =>
                          projectSections.map(({ project, items }, index) =>
                            renderProjectSection(
                              activeArea,
                              project,
                              items,
                              collectionItemProps(project, index, { type: 'objective' }),
                              group.label,
                            ),
                          )
                        }
                      </SortableCollectionLane>
                    ) : null}
                    {group.label === 'Anytime' ? (
                      <>
                        {renderAreaProjectDraft(activeArea)}
                        {canCreateProjectInCurrentScope && projectDraft?.areaId !== activeArea.id ? (
                          <button
                            aria-label={`New project in ${activeArea.label}`}
                            className="work-area-add-project-button"
                            type="button"
                            onClick={(event) => startAddingProject(activeArea, event.currentTarget)}
                          >
                            <Plus size={15} /> New project
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                ))}
              </section>
            ) : (
              areaSections.map(({ area, looseItems, projectSections, taskCount }) => {
                const looseContext = contextForArea(area, looseItems)
                return (
                  <section className={`work-area-section ${activeArea ? 'focused' : ''}`} key={area.id}>
                    {!activeArea ? (
                      <SortableCollectionDropProxy
                        as="header"
                        className="work-area-header"
                        data-backlog-layout-key={`header:${looseContext.key}`}
                        {...taskContextDropProxyProps(looseContext)}
                      >
                        <Folder size={17} weight="fill" style={{ color: area.color }} />
                        <button
                          className="work-area-title"
                          data-area-title-id={area.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenArea?.(area, event.currentTarget)
                          }}
                        >
                          {area.label}
                        </button>
                        <span>
                          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                        </span>
                      </SortableCollectionDropProxy>
                    ) : null}

                    {renderTaskContext(looseContext, {
                      addLabel: `Add task to ${area.label}`,
                      emptyLabel: projectSections.length ? null : 'No standalone tasks yet.',
                      showAddRow: true,
                    })}

                    {area.id === areaId && projectSections.length ? (
                      <SortableCollectionLane
                        className="work-area-project-list"
                        collectionId={`area-projects-${area.id}`}
                        collectionSnapshot={objectives}
                        items={projectSections.map(({ project }) => project)}
                        laneId={area.id}
                        onMove={(move) =>
                          moveProjectsInArea(
                            projectSections.map(({ project }) => project.id),
                            move,
                          )
                        }
                        onRestore={setObjectives}
                        surfaceId={`backlog-area-projects-${area.id}`}
                      >
                        {({ collectionItemProps }) =>
                          projectSections.map(({ project, items }, index) =>
                            renderProjectSection(
                              area,
                              project,
                              items,
                              collectionItemProps(project, index, { type: 'objective' }),
                            ),
                          )
                        }
                      </SortableCollectionLane>
                    ) : (
                      projectSections.map(({ project, items }) => renderProjectSection(area, project, items))
                    )}

                    {renderAreaProjectDraft(area)}
                    {canCreateProjectInCurrentScope && projectDraft?.areaId !== area.id ? (
                      <button
                        aria-label={`New project in ${area.label}`}
                        className="work-area-add-project-button"
                        type="button"
                        onClick={(event) => startAddingProject(area, event.currentTarget)}
                      >
                        <Plus size={15} /> New project
                      </button>
                    ) : null}
                  </section>
                )
              })
            )}

            {!activeProject && !areaSections.length ? (
              <section className="work-index-empty">
                <ScopeIcon mirrored={ScopeIcon === PushPin} size={24} />
                <h2>Nothing here yet</h2>
                <p>
                  {isScheduledList
                    ? 'Tasks scheduled for today or later will appear here.'
                    : 'Add a task or create a project when this work becomes relevant.'}
                </p>
                {!isScheduledList && areas.length ? (
                  <button
                    type="button"
                    onClick={(event) => startAddingTask(defaultTaskContext(), event.currentTarget)}
                  >
                    <Plus size={15} /> Add task
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </section>
      <RightPanel
        activePane={activeRightPane}
        onPaneChange={onRightPaneChange}
        tasks={tasks}
        weeklyFocusedObjectives={weeklyFocusedObjectives}
        setWeeklyFocusedObjectives={setWeeklyFocusedObjectives}
      />
    </div>
  )
}
