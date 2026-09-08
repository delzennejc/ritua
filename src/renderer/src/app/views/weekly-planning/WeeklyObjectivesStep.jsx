import { ArrowLeft, Plus } from "@phosphor-icons/react";
import {
  SortableCollectionDropProxy,
  SortableCollectionLane,
} from "../../components/SortableCollection";
import { TopControls } from "../../components/TopControls";
import { WeeklyObjectiveCard } from "../../components/WeeklyObjectiveCard";
import { AutoGrowingTextarea } from "../../components/DetailsTitleInput";
import { useInlineProjectComposer } from "../../hooks/useInlineProjectComposer";
import { moveObjective } from "../../utils/collections";

export function WeeklyObjectivesStep({
  areaFilterProps,
  objectives,
  setObjectives,
  onToggleObjective,
  onAddObjective,
  onFocusObjectiveInWeek,
  onRemoveObjectiveFromWeek,
  onBack,
  onNext,
  onOpenObjective,
}) {
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
  } = useInlineProjectComposer(onAddObjective);
  const moveWeeklyObjective = (move) => setObjectives((items) => moveObjective(items, move));

  return (
    <SortableCollectionDropProxy
      as="section"
      className="planning-surface weekly-planning-view weekly-objectives-view"
      collectionId="weekly-objectives"
      insertionIndex={objectives.length}
      laneId="objectives"
      lowPriority
      proxyId="weekly-page"
      surfaceId="weekly-objectives-step"
    >
      <TopControls {...areaFilterProps} />
      <div className="weekly-objectives-body">
        <div className="weekly-objectives-intro planning-intro">
          <h1>This week's projects</h1>
          <p>Choose the projects you want to advance.</p>
          <div className="wizard-actions">
            <button className="back-button" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
            <button className="next-button" onClick={onNext}>Next</button>
          </div>
        </div>
        <section className="weekly-objective-column">
          <h2>This week</h2>
          <p>Projects in focus</p>
          {addingObjective ? (
            <form
              className="add-row weekly-add-objective weekly-objective-create-form"
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
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    finishAdding();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelAdding();
                  }
                }}
              />
            </form>
          ) : (
            <button
              className={`add-row weekly-add-objective ${settlingObjectiveId ? "is-reappearing" : ""}`.trim()}
              onClick={startAdding}
            >
              <Plus size={15} /> New project
            </button>
          )}
          <SortableCollectionLane
            className={`weekly-objective-stack weekly-focus-objective-stack ${settlingObjectiveId ? "is-settling-project" : ""}`.trim()}
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
            surfaceId="weekly-objectives-step"
          >
            {({ collectionItemProps }) => (
              <>
                {objectives.map((objective, index) => (
                  <WeeklyObjectiveCard
                    className={objective.id === settlingObjectiveId ? "newly-created" : ""}
                    collectionItem={collectionItemProps(objective, index)}
                    objective={objective}
                    key={objective.id}
                    onOpen={onOpenObjective}
                    onToggle={onToggleObjective}
                  />
                ))}
                {!objectives.length ? (
                  <p className="weekly-objective-empty">
                    Drag projects from the right panel or create a new one.
                  </p>
                ) : null}
              </>
            )}
          </SortableCollectionLane>
        </section>
      </div>
    </SortableCollectionDropProxy>
  );
}
