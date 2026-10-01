import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  MagnifyingGlass,
  Star,
  SunHorizon,
  X,
} from '@phosphor-icons/react'
import { useWorkspaceState } from '../../../desktop/workspace-store'
import { finishYesterdayReview, startPlannedDay } from '../../../desktop/daily-plan-actions'
import { useDailyPlan } from '../../hooks/useDailyPlan'
import { useWorkspaceCollections } from '../../hooks/useWorkspaceCollections'
import { useWorkspaceTaskActions } from '../../hooks/useWorkspaceTaskActions'
import { DailyReviewBoard } from './DailyReviewBoard'
import { DailyReviewTimeSummary } from './DailyReviewTimeSummary'
import { DailyActivityGrid } from './DailyActivityGrid'
import {
  dispatchTaskCommand,
  toggleTaskCompletion,
  toggleTaskSubtask,
} from '../../../desktop/workspace-actions'
import { InlineTaskStack } from '../../components/InlineTaskStack'
import { SortableCollectionLane } from '../../components/SortableCollection'
import { moveItemBetweenLanes } from '../../utils/collections'
import { TaskCard } from '../../components/TaskCard'
import { TopControls } from '../../components/TopControls'
import { ReviewCheckVisual } from '../../components/ReviewCheckVisual'
import { animateReviewCheck } from '../../utils/review-check-animation'
import { CURRENT_DATE_KEY, addDays, dateFromKey } from '../../utils/dates'
import './daily-planning.css'

function groupTasks(items, key) {
  const groups = new Map()
  for (const item of items) {
    const label = key(item)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(item)
  }
  return [...groups]
}

function groupCandidates(candidates) {
  const groups = groupTasks(candidates, ({ source }) =>
    source.startsWith('Unfinished') ? 'Unfinished' : source,
  )
  if (!groups.some(([source]) => source === 'Anytime')) groups.push(['Anytime', []])
  const rank = (label) => (label === 'Unfinished' ? 0 : label === 'Anytime' ? 1 : label === 'Someday' ? 3 : 2)
  return groups.sort(([a], [b]) => rank(a) - rank(b))
}

function PlanningCard({ task, projects, onOpen, footer, collectionItem, highlight = false }) {
  const { onAssignObjective, onQuickSchedule, onUnscheduleTask, onCompleteUndatedTask } =
    useWorkspaceTaskActions()
  return (
    <TaskCard
      task={task}
      className={`daily-planning-task-card ${highlight ? 'is-highlight' : ''}`}
      projects={projects}
      collectionItem={collectionItem}
      onToggle={(id) => {
        if (!onCompleteUndatedTask(id)) toggleTaskCompletion(id)
      }}
      onToggleSubtask={toggleTaskSubtask}
      onAssignObjective={onAssignObjective}
      onSchedule={(source) => onQuickSchedule(task, task.scheduledDateKey || CURRENT_DATE_KEY, source)}
      onUnschedule={onUnscheduleTask}
      onOpen={onOpen}
      footer={footer}
    />
  )
}

export function DailyPlanningView({ step, setStep, onDone }) {
  const { reviewTasks, reviewCompleted, reviewTime, reviewActivity, candidates, selection } = useDailyPlan()
  const [, saveSelection] = useWorkspaceState('daily.selection', null)
  const { areas, objectives, backlogGroups } = useWorkspaceCollections()
  const { onOpenTask, onCreateBoardTask } = useWorkspaceTaskActions()
  const [selectedAreaIds, setSelectedAreaIds] = useState([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [dragPreview, setDragPreview] = useState(null)
  const [advancing, setAdvancing] = useState(false)
  const [validatingStep, setValidatingStep] = useState(false)
  const [arrived, setArrived] = useState(false)
  const ritualRef = useRef(null)
  const advanceLock = useRef(false)
  const advanceAnimations = useRef([])
  const dragPreviewRef = useRef(null)
  const planningRef = useRef(null)
  const headingRef = useRef(null)
  const searchRef = useRef(null)
  useEffect(() => () => advanceAnimations.current.forEach((animation) => animation.cancel()), [])
  const review = step === 0
  const completedReviewCount = reviewTasks.filter((task) => task.complete).length
  const headerDateKey = review ? addDays(CURRENT_DATE_KEY, -1) : CURRENT_DATE_KEY
  const headerDate = dateFromKey(headerDateKey)
  const dateLabel = (
    <time
      className="daily-ritual-date daily-review-date"
      dateTime={headerDateKey}
      aria-label={headerDate.toLocaleDateString('en-US', { dateStyle: 'full' })}
    >
      {headerDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
    </time>
  )
  const byId = new Map(candidates.map(({ task }) => [task.id, task]))
  const selectedTasks = selection.taskIds.map((id) => byId.get(id)).filter(Boolean)
  const selectedIds = new Set(selection.taskIds)
  const projectNames = new Map(objectives.map((project) => [project.id, project.title]))
  const searchQuery = query.trim().toLowerCase()
  const visibleCandidates = candidates.filter(
    ({ task, source }) =>
      !selectedIds.has(task.id) &&
      (source !== 'Someday' || searchQuery.length > 0) &&
      (!selectedAreaIds.length ||
        areas.some((area) => selectedAreaIds.includes(area.id) && area.label === task.channel)) &&
      `${task.title} ${task.channel ?? ''} ${projectNames.get(task.objectiveId) ?? ''}`
        .toLowerCase()
        .includes(searchQuery),
  )
  const lanes = {
    available: groupCandidates(visibleCandidates).flatMap(([, items]) => items.map(({ task }) => task)),
    plan: selectedTasks,
  }
  const displayedLanes = dragPreview || lanes
  const orderedTasks = displayedLanes.plan
  const displayedCandidates = displayedLanes.available.flatMap((task) => {
    const candidate = candidates.find((item) => item.task.id === task.id)
    return candidate
      ? [{ ...candidate, source: task.id === dragPreview?.returnedTaskId ? 'Anytime' : candidate.source }]
      : []
  })
  const candidateGroups = groupCandidates(displayedCandidates)
  const unfinished = candidates.filter(({ source }) => source === 'Unfinished from yesterday').length
  const needsHighlight = selectedTasks.length > 0 && !selection.highlightId
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [review])
  const update = (next) => {
    saveSelection((current) => (typeof next === 'function' ? next(current ?? selection) : next))
    setError('')
  }
  const clearDragPreview = () => {
    dragPreviewRef.current = null
    setDragPreview(null)
  }
  const movePlanningTask = (move) => {
    const current = dragPreviewRef.current?.lanes || lanes
    const sourceLaneId = current.plan.some((task) => task.id === move.itemId) ? 'plan' : 'available'
    const moved = moveItemBetweenLanes({ ...move, sourceLaneId, lanes: current })
    if (moved === current) return
    const returnedTaskId =
      selectedIds.has(move.itemId) && move.targetLaneId === 'available' ? move.itemId : null
    const available = returnedTaskId
      ? [byId.get(returnedTaskId), ...moved.available.filter((task) => task.id !== returnedTaskId)]
      : moved.available
    // Keep sortable indices in the same order as the rendered source sections.
    const next = {
      ...moved,
      available: groupCandidates(
        available.map((task) => {
          const candidate = candidates.find((item) => item.task.id === task.id)
          return { ...candidate, source: task.id === returnedTaskId ? 'Anytime' : candidate.source }
        }),
      ).flatMap(([, items]) => items.map(({ task }) => task)),
    }
    dragPreviewRef.current = { lanes: next, taskId: move.itemId, returnedTaskId }
    setDragPreview({ ...next, returnedTaskId })
  }
  const commitPlanningDrag = () => {
    const preview = dragPreviewRef.current
    clearDragPreview()
    if (!preview) return
    const taskIds = preview.lanes.plan.map((task) => task.id)
    const reorderedIds = preview.lanes.available.map((task) => task.id)
    const reorderedSet = new Set(reorderedIds)
    let visibleIndex = 0
    // Reorder visible slots without discarding or shuffling tasks hidden by filters.
    const availableOrder = candidates
      .filter(({ task }) => !taskIds.includes(task.id))
      .map(({ task }) => (reorderedSet.has(task.id) ? reorderedIds[visibleIndex++] : task.id))
    const availableTaskIds = preview.returnedTaskId
      ? [preview.returnedTaskId, ...availableOrder.filter((id) => id !== preview.returnedTaskId)]
      : availableOrder
    update((current) => ({
      ...current,
      taskIds,
      availableTaskIds,
      anytimeTaskIds: preview.returnedTaskId
        ? [...new Set([...(current.anytimeTaskIds ?? []), preview.returnedTaskId])]
        : (current.anytimeTaskIds ?? []),
      highlightId: taskIds.includes(current.highlightId) ? current.highlightId : null,
    }))
    setAnnouncement(taskIds.includes(preview.taskId) ? 'Today’s plan updated.' : 'Available tasks updated.')
    requestAnimationFrame(() => {
      const card = [...(planningRef.current?.querySelectorAll('[data-collection-item-id]') || [])].find(
        (node) => node.dataset.collectionItemId === preview.taskId,
      )
      ;(card || searchRef.current)?.focus({ preventScroll: true })
    })
  }
  const dragLaneProps = {
    collectionId: 'daily-plan',
    surfaceId: 'daily-plan',
    collectionSnapshot: lanes,
    onMove: movePlanningTask,
    onCommit: commitPlanningDrag,
    onRestore: clearDragPreview,
  }
  const chooseHighlight = (task) => {
    update((current) => ({
      ...current,
      highlightId: task.id,
    }))
    setAnnouncement(`${task.title} is your daily highlight.`)
  }
  const createAnytimeTask = ({ title, area }) => {
    const group = backlogGroups.find((item) => item.id === 'anytime' || item.label === 'Anytime')
    if (!group) return null
    const id = `task-${crypto.randomUUID()}`
    dispatchTaskCommand({
      type: 'task.create',
      placement: 'first',
      tasks: [{ task: { id, title, channel: area, complete: false }, lane: `backlog:${group.id}` }],
    })
    update((current) => ({
      ...current,
      availableTaskIds: [
        id,
        ...(current.availableTaskIds ?? candidates.map(({ task }) => task.id)).filter(
          (taskId) => taskId !== id,
        ),
      ],
    }))
    setAnnouncement(`${title} added to Anytime.`)
    return id
  }
  const advance = async () => {
    if (advanceLock.current) return
    advanceLock.current = true
    setAdvancing(true)
    try {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const root = ritualRef.current
        const markers = root.querySelectorAll('.daily-step-marker')
        const source = markers[review ? 0 : 1]
        const target = review ? markers[1] : null
        const animate = (element, frames, duration, delay = 0) => {
          if (!element) return
          advanceAnimations.current.push(
            element.animate(frames, {
              duration,
              delay,
              easing: 'cubic-bezier(.22, 1, .36, 1)',
              fill: 'both',
            }),
          )
        }
        if (review) {
          advanceAnimations.current.push(...animateReviewCheck(root.querySelector('.daily-title-check')))
          await Promise.all(advanceAnimations.current.map((animation) => animation.finished))
        }
        setValidatingStep(true)
        animate(
          source,
          [
            { opacity: 0, transform: 'scale(.65)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          260,
          140,
        )
        if (target) {
          const from = source.getBoundingClientRect()
          const to = target.getBoundingClientRect()
          const nav = root.querySelector('.daily-ritual-topline').getBoundingClientRect()
          const flight = root.querySelector('.daily-step-flight')
          flight.style.left = `${from.left - nav.left}px`
          flight.style.top = `${from.top - nav.top}px`
          animate(
            flight,
            [
              { opacity: 0, transform: 'translate(0, 0) scale(.8)' },
              { opacity: 1, offset: 0.15 },
              { opacity: 1, offset: 0.8 },
              {
                opacity: 0,
                transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(1)`,
              },
            ],
            420,
            300,
          )
          animate(
            target,
            [{ transform: 'scale(1)' }, { transform: 'scale(1.15)', offset: 0.5 }, { transform: 'scale(1)' }],
            240,
            600,
          )
        }
        animate(
          root.querySelector(review ? '.daily-review-body' : '.daily-planning-workspace'),
          [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-4px)' },
          ],
          180,
          review ? 660 : 380,
        )
        await Promise.all(advanceAnimations.current.map((animation) => animation.finished))
      }
      if (review) {
        setArrived(true)
        finishYesterdayReview()
      } else {
        startPlannedDay(selection)
        onDone()
      }
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message)
    } finally {
      advanceAnimations.current.forEach((animation) => animation.cancel())
      advanceAnimations.current = []
      advanceLock.current = false
      setAdvancing(false)
      setValidatingStep(false)
    }
  }
  return (
    <section
      ref={ritualRef}
      data-advancing={advancing || undefined}
      data-arrived={(!review && arrived) || undefined}
      className={`planning-surface daily-ritual ${review ? 'yesterday-review' : 'daily-selection'}`}
    >
      <nav className="daily-ritual-topline" aria-label="Daily planning progress">
        <button
          type="button"
          disabled={advancing}
          onClick={() => setStep(0)}
          aria-current={review ? 'step' : undefined}
          className={review ? 'current' : reviewCompleted ? 'finished' : ''}
        >
          <span
            className={`daily-step-marker ${reviewCompleted || (review && validatingStep) ? 'is-validated' : 'daily-step-number'}`}
          >
            {reviewCompleted || (review && validatingStep) ? <Check size={14} aria-hidden="true" /> : '1'}
          </span>{' '}
          Yesterday
        </button>
        <ArrowRight size={13} aria-hidden="true" />
        <button
          type="button"
          disabled={advancing}
          onClick={() => {
            try {
              finishYesterdayReview()
            } catch (cause) {
              setError(cause.message)
            }
          }}
          aria-current={!review ? 'step' : undefined}
          className={!review ? 'current' : ''}
        >
          <span
            className={`daily-step-marker ${!review && validatingStep ? 'is-validated' : 'daily-step-number'}`}
          >
            {!review && validatingStep ? <Check size={14} aria-hidden="true" /> : '2'}
          </span>{' '}
          Plan today
        </button>
        <span className="daily-step-flight" aria-hidden="true">
          <Check size={14} weight="bold" />
        </span>
      </nav>
      <header className="daily-ritual-heading">
        <div>
          <div className="daily-ritual-title-row">
            <h1 ref={headingRef} tabIndex={-1}>
              {review ? (
                <button
                  type="button"
                  className="icon-button daily-title-check"
                  role="checkbox"
                  aria-label="Yesterday’s review"
                  aria-checked={reviewCompleted}
                  title={reviewCompleted ? 'Review completed · Plan today' : 'Complete review and plan today'}
                  disabled={advancing}
                  onClick={advance}
                >
                  <ReviewCheckVisual>
                    <CheckCircle
                      size={24}
                      weight={reviewCompleted || advancing ? 'fill' : 'regular'}
                      aria-hidden="true"
                    />
                  </ReviewCheckVisual>
                </button>
              ) : (
                <SunHorizon size={24} aria-hidden="true" />
              )}
              {review ? 'Yesterday' : 'Plan today'}
            </h1>
            {dateLabel}
          </div>
          <p className="daily-review-summary">
            {review ? (
              <>
                {completedReviewCount} done · {reviewTasks.length - completedReviewCount} to review
              </>
            ) : (
              <>
                {selectedTasks.length} selected ·{' '}
                {selection.highlightId ? '1 daily highlight' : 'Choose a daily highlight'}
              </>
            )}
          </p>
        </div>
        {review ? (
          <DailyReviewTimeSummary areas={areas} {...reviewTime} activity={reviewActivity} />
        ) : (
          <DailyActivityGrid days={reviewActivity} areas={areas} />
        )}
      </header>
      {review ? (
        <div className="daily-review-body" data-board-scroll-container="true" inert={advancing}>
          <DailyReviewBoard tasks={reviewTasks} areas={areas} projects={objectives} />
          <aside className="daily-review-next">
            <SunHorizon size={24} aria-hidden="true" />
            <h2>A fresh plan for today</h2>
            <p>Choose what you want to work on, then pick one daily highlight.</p>
            {unfinished > 0 ? (
              <p className="daily-review-carry">
                {unfinished} unfinished {unfinished === 1 ? 'task is' : 'tasks are'} available to carry
                forward in the next step.
              </p>
            ) : null}
          </aside>
        </div>
      ) : (
        <div className="daily-planning-workspace" ref={planningRef} inert={advancing}>
          <section className="daily-source-pane" aria-labelledby="daily-available-title">
            <div className="daily-pane-heading">
              <h2 id="daily-available-title">Available tasks</h2>
            </div>
            <div className="daily-source-toolbar">
              <div className="daily-search">
                <MagnifyingGlass size={16} aria-hidden="true" />
                <input
                  ref={searchRef}
                  aria-label="Search tasks"
                  placeholder="Search tasks or projects…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button
                    className="icon-button"
                    aria-label="Clear task search"
                    onClick={() => {
                      setQuery('')
                      searchRef.current?.focus()
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <TopControls
                showDate={false}
                areas={areas}
                selectedAreaIds={selectedAreaIds}
                onAreaFilterChange={setSelectedAreaIds}
              />
            </div>
            <SortableCollectionLane
              {...dragLaneProps}
              laneId="available"
              items={displayedLanes.available}
              className="daily-source-scroll"
              aria-label="Available tasks"
              data-board-scroll-container="true"
            >
              {({ collectionItemProps }) => (
                <>
                  {candidateGroups.map(([source, items]) => {
                    const cards = items.map(({ task }) => (
                      <li key={task.id} className="daily-source-task" data-task-layout-id={task.id}>
                        <PlanningCard
                          task={task}
                          projects={objectives}
                          onOpen={onOpenTask}
                          collectionItem={collectionItemProps(
                            task,
                            displayedLanes.available.findIndex((item) => item.id === task.id),
                          )}
                        />
                      </li>
                    ))
                    return (
                      <section className="daily-source-group" key={source} aria-label={source}>
                        <h3>
                          {source}
                          <span>{items.length}</span>
                        </h3>
                        {source === 'Anytime' ? (
                          <InlineTaskStack
                            firstTaskId={items[0]?.task.id}
                            stackAs="ul"
                            stackClassName="daily-task-rows"
                            onCreateTask={createAnytimeTask}
                          >
                            {cards}
                          </InlineTaskStack>
                        ) : (
                          <ul className="daily-task-rows">{cards}</ul>
                        )}
                      </section>
                    )
                  })}
                  {!displayedCandidates.length ? (
                    <div className="daily-empty">
                      <MagnifyingGlass size={23} aria-hidden="true" />
                      <p>{query || selectedAreaIds.length ? 'No matching tasks.' : 'No available tasks.'}</p>
                      <span>
                        {query || selectedAreaIds.length
                          ? 'Try another search or clear the area filter.'
                          : 'Drag a task here to leave it out of today’s plan.'}
                      </span>
                      {query || selectedAreaIds.length ? (
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setQuery('')
                            setSelectedAreaIds([])
                            searchRef.current?.focus()
                          }}
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </SortableCollectionLane>
          </section>
          <section className="daily-plan-pane" aria-labelledby="daily-plan-title">
            <div className="daily-pane-heading">
              <h2 id="daily-plan-title">
                Today’s plan <span className="daily-plan-count">{selectedTasks.length}</span>
              </h2>
            </div>
            <SortableCollectionLane
              {...dragLaneProps}
              laneId="plan"
              items={orderedTasks}
              className="daily-plan-scroll"
              aria-label="Today’s planned tasks"
              data-board-scroll-container="true"
            >
              {({ collectionItemProps }) => (
                <>
                  {needsHighlight ? (
                    <p className="daily-highlight-hint" id="daily-highlight-required">
                      <Star size={17} aria-hidden="true" />
                      <span>
                        Which task is your daily highlight?
                        <small>Use the star on one of your tasks below.</small>
                      </span>
                    </p>
                  ) : null}
                  <InlineTaskStack
                    dateKey={CURRENT_DATE_KEY}
                    firstTaskId={orderedTasks[0]?.id}
                    stackClassName="daily-selected-tasks"
                    onCreateTask={(draft) => {
                      const id = onCreateBoardTask({ ...draft, todayStatus: 'todo' })
                      if (id) {
                        update((current) => ({
                          ...current,
                          taskIds: [id, ...current.taskIds.filter((taskId) => taskId !== id)],
                        }))
                        setAnnouncement(`${draft.title} added to today’s plan.`)
                      }
                      return id
                    }}
                  >
                    {orderedTasks.map((task, index) => (
                      <div
                        className={`daily-selected-task ${selection.highlightId === task.id ? 'is-highlight' : ''}`}
                        key={task.id}
                        data-task-layout-id={task.id}
                      >
                        <PlanningCard
                          task={task}
                          highlight={selection.highlightId === task.id}
                          projects={objectives}
                          collectionItem={collectionItemProps(task, index)}
                          onOpen={onOpenTask}
                          footer={
                            <div className="daily-plan-task-controls">
                              <button
                                className="daily-star"
                                aria-label={`Make ${task.title} the daily highlight`}
                                aria-pressed={selection.highlightId === task.id}
                                onClick={() => chooseHighlight(task)}
                              >
                                <Star
                                  size={15}
                                  weight={selection.highlightId === task.id ? 'fill' : 'regular'}
                                />
                                {selection.highlightId === task.id ? 'Daily highlight' : 'Make highlight'}
                              </button>
                            </div>
                          }
                        />
                      </div>
                    ))}
                  </InlineTaskStack>
                  {!orderedTasks.length ? (
                    <div className="daily-empty daily-plan-empty">
                      <SunHorizon size={30} aria-hidden="true" />
                      <p>What would make today a good day?</p>
                      <span>Drag tasks here, or create one above.</span>
                    </div>
                  ) : null}
                </>
              )}
            </SortableCollectionLane>
          </section>
        </div>
      )}
      <footer className="daily-ritual-actions">
        {!review ? (
          <button
            className="daily-back"
            disabled={advancing}
            aria-label="Back to yesterday"
            onClick={() => setStep(0)}
          >
            <ArrowLeft size={15} /> Yesterday
          </button>
        ) : null}
        <div className="daily-finish">
          {error ? (
            <span role="alert" className="daily-plan-error">
              {error}
            </span>
          ) : null}
          <button
            className="next-button"
            disabled={advancing || (!review && needsHighlight)}
            aria-describedby={!review && needsHighlight ? 'daily-highlight-required' : undefined}
            onClick={advance}
          >
            {review ? 'Plan today' : 'Start my day'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
      <span className="daily-announcement" role="status">
        {announcement}
      </span>
    </section>
  )
}
