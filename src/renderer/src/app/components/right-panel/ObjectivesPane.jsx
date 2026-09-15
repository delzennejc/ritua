import { useRef } from 'react'
import { Plus } from '@phosphor-icons/react'

import { moveItemBetweenLanes } from '../../utils/collections'

import { useInlineProjectComposer } from '../../hooks/useInlineProjectComposer'
import { AutoGrowingTextarea } from '.././DetailsTitleInput'

import { SortableCollectionLane } from '.././SortableCollection'

import { WeeklyObjectiveCard } from '.././WeeklyObjectiveCard'
import { UtilityPaneToolbar } from './PaneChrome.jsx'

import { isFocusedThisWeek } from './project-order.js'
import { orderObjectivesForPanel } from './project-order.js'
const THIS_WEEK_OBJECTIVE_LANE = 'this-week-projects'

const OTHER_OBJECTIVE_LANE = 'other-projects'

function applyObjectiveGroupOrder(objectives, orderedGroup, matchesGroup) {
  const objectivesById = new Map(objectives.map((objective) => [objective.id, objective]))
  let groupIndex = 0

  return objectives.map((objective) =>
    matchesGroup(objective) ? objectivesById.get(orderedGroup[groupIndex++]?.id) || objective : objective,
  )
}

function applyPanelObjectiveLanes(objectives, lanes, preserveFocusedOrder) {
  const focusedIds = new Set(lanes[THIS_WEEK_OBJECTIVE_LANE].map((objective) => objective.id))
  let nextObjectives = objectives.map((objective) => ({
    ...objective,
    focusedThisWeek: focusedIds.has(objective.id),
  }))
  nextObjectives = applyObjectiveGroupOrder(
    nextObjectives,
    lanes[OTHER_OBJECTIVE_LANE],
    (objective) => !isFocusedThisWeek(objective),
  )

  return preserveFocusedOrder
    ? nextObjectives
    : applyObjectiveGroupOrder(nextObjectives, lanes[THIS_WEEK_OBJECTIVE_LANE], isFocusedThisWeek)
}

export function ObjectivesPane({
  objectives,
  setObjectives,
  onFocusObjectiveInWeek,
  onOpenObjective,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  toolbarContent,
}) {
  const sharesWeeklyOrder = Boolean(weeklyFocusedObjectives && setWeeklyFocusedObjectives)
  const panelObjectives = orderObjectivesForPanel(objectives, weeklyFocusedObjectives)
  const panelFocusedObjectives = panelObjectives.filter(isFocusedThisWeek)
  const completeCount = panelFocusedObjectives.filter((objective) => objective.complete).length
  const completionProgress = panelFocusedObjectives.length
    ? Math.round((completeCount / panelFocusedObjectives.length) * 100)
    : 0
  const panelOtherObjectives = panelObjectives.filter((objective) => !isFocusedThisWeek(objective))
  const panelLanesRef = useRef({
    [THIS_WEEK_OBJECTIVE_LANE]: panelFocusedObjectives,
    [OTHER_OBJECTIVE_LANE]: panelOtherObjectives,
  })
  panelLanesRef.current = {
    [THIS_WEEK_OBJECTIVE_LANE]: panelFocusedObjectives,
    [OTHER_OBJECTIVE_LANE]: panelOtherObjectives,
  }
  const addObjective = (title) => {
    const id = `objective-${Date.now()}`
    const objective = {
      id,
      title,
      channel: 'Ritua',
      complete: false,
      focusedThisWeek: true,
      tasks: [],
    }
    setObjectives?.((items) => [objective, ...items])
    if (sharesWeeklyOrder) {
      setWeeklyFocusedObjectives((items) => [objective, ...items])
    }
    return id
  }
  const {
    addingObjective,
    cancelAdding,
    draftInputRef,
    draftTitle,
    finishAdding,
    setDraftTitle,
    settlingObjectiveId,
    startAdding,
    submitObjective,
  } = useInlineProjectComposer(addObjective)
  const toggleObjective = (id) =>
    setObjectives?.((items) =>
      items.map((objective) =>
        objective.id === id ? { ...objective, complete: !objective.complete } : objective,
      ),
    )
  const moveWeeklyObjective = (move) => {
    const currentLanes = panelLanesRef.current
    const sourceLaneId = currentLanes[THIS_WEEK_OBJECTIVE_LANE].some(
      (objective) => objective.id === move.itemId,
    )
      ? THIS_WEEK_OBJECTIVE_LANE
      : OTHER_OBJECTIVE_LANE
    const nextLanes = moveItemBetweenLanes({
      lanes: currentLanes,
      ...move,
      sourceLaneId,
    })
    panelLanesRef.current = nextLanes

    if (sharesWeeklyOrder) {
      setWeeklyFocusedObjectives(nextLanes[THIS_WEEK_OBJECTIVE_LANE])
    }
    setObjectives?.((items) => applyPanelObjectiveLanes(items, nextLanes, sharesWeeklyOrder))
  }
  const panelCollectionSnapshot = sharesWeeklyOrder ? { objectives, weeklyFocusedObjectives } : objectives
  const restorePanelObjectives = (snapshot) => {
    if (!sharesWeeklyOrder) {
      setObjectives?.(snapshot)
      return
    }
    setObjectives?.(snapshot.objectives)
    setWeeklyFocusedObjectives(snapshot.weeklyFocusedObjectives)
  }

  return (
    <div className="utility-pane objectives-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content objectives-pane-content">
        <header className="right-panel-objectives-heading">
          <h2>Projects</h2>
          <p>Your focused projects</p>
          <span
            className="day-progress right-panel-objectives-progress"
            role="progressbar"
            aria-label="Projects completed"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={completionProgress}
          >
            <span style={{ width: `${completionProgress}%` }} />
          </span>
        </header>
        {addingObjective ? (
          <form
            className="add-row right-panel-add-objective weekly-objective-create-form"
            onSubmit={submitObjective}
          >
            <Plus size={15} />
            <AutoGrowingTextarea
              ref={draftInputRef}
              aria-label="New project"
              autoComplete="off"
              placeholder="New project"
              value={draftTitle}
              onBlur={finishAdding}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  finishAdding()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelAdding()
                }
              }}
            />
          </form>
        ) : (
          <button
            className={`add-row right-panel-add-objective ${settlingObjectiveId ? 'is-reappearing' : ''}`.trim()}
            type="button"
            onClick={startAdding}
          >
            <Plus size={15} /> New project
          </button>
        )}
        <div className="weekly-objective-stack right-panel-objective-stack">
          <div aria-label="Focused projects" className="right-panel-objective-divider" role="separator">
            <span>Focused</span>
          </div>
          <SortableCollectionLane
            className={`right-panel-objective-group weekly-focus-objective-stack ${settlingObjectiveId ? 'is-settling-project' : ''}`.trim()}
            collectionId="weekly-objectives"
            collectionSnapshot={panelCollectionSnapshot}
            externalDropData={onFocusObjectiveInWeek ? { onFocusObjectiveInWeek } : undefined}
            items={panelFocusedObjectives}
            laneId={THIS_WEEK_OBJECTIVE_LANE}
            onMove={moveWeeklyObjective}
            onRestore={restorePanelObjectives}
            surfaceId="right-panel-objectives"
          >
            {({ collectionItemProps }) =>
              panelFocusedObjectives.map((objective, index) => (
                <WeeklyObjectiveCard
                  className={objective.id === settlingObjectiveId ? 'newly-created' : ''}
                  collectionItem={collectionItemProps(objective, index)}
                  key={objective.id}
                  objective={objective}
                  onOpen={onOpenObjective}
                  onToggle={toggleObjective}
                />
              ))
            }
          </SortableCollectionLane>
          {!panelFocusedObjectives.length ? (
            <p className="utility-empty">No focused projects. Star a project in an Area to show it here.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
