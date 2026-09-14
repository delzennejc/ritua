import { ArrowLeft } from '@phosphor-icons/react'
import { SortableCollectionLane } from '../../components/SortableCollection'
import { TopControls } from '../../components/TopControls'
import { WeeklyObjectiveCard } from '../../components/WeeklyObjectiveCard'
import { WeeklyTextCard } from '../../components/WeeklyTextCard'
import { moveObjective } from '../../utils/collections'

export function WeeklyPlanStep({
  areaFilterProps,
  planText,
  setPlanText,
  objectives,
  setObjectives,
  onToggleObjective,
  onFocusObjectiveInWeek,
  onRemoveObjectiveFromWeek,
  onBack,
  onDone,
  onOpenObjective,
}) {
  const moveWeeklyObjective = (move) => setObjectives((items) => moveObjective(items, move))

  return (
    <section className="share-view weekly-document-view weekly-plan-step">
      <TopControls {...areaFilterProps} />
      <div className="weekly-document-content">
        <div className="weekly-document-headings">
          <div>
            <h1>Weekly plan</h1>
            <p>Document your plan for the week.</p>
          </div>
          <div>
            <h2>Projects in focus</h2>
            <p>Review the work you chose to advance</p>
          </div>
        </div>
        <div className="weekly-document-layout">
          <div className="weekly-document-primary">
            <WeeklyTextCard value={planText} onChange={setPlanText} ariaLabel="Weekly plan" />
            <div className="weekly-document-actions">
              <button className="back-button" aria-label="Back" onClick={onBack}>
                <ArrowLeft size={18} />
              </button>
              <button className="next-button weekly-done-button" onClick={onDone}>
                Done
              </button>
            </div>
          </div>
          <SortableCollectionLane
            className="weekly-objective-stack weekly-focus-objective-stack"
            collectionId="weekly-objectives"
            collectionSnapshot={objectives}
            externalDropData={{
              onFocusObjectiveInWeek,
              onRemoveObjectiveFromWeek,
            }}
            items={objectives}
            laneId="objectives"
            onMove={moveWeeklyObjective}
            onRestore={setObjectives}
            surfaceId="weekly-plan-objectives"
          >
            {({ collectionItemProps }) =>
              objectives.map((objective, index) => (
                <WeeklyObjectiveCard
                  collectionItem={collectionItemProps(objective, index)}
                  objective={objective}
                  key={objective.id}
                  onOpen={onOpenObjective}
                  onToggle={onToggleObjective}
                />
              ))
            }
          </SortableCollectionLane>
        </div>
      </div>
    </section>
  )
}
