import { ArrowLeft } from "@phosphor-icons/react";
import { SortableCollectionLane } from "../../components/SortableCollection";
import { TopControls } from "../../components/TopControls";
import { WeeklyObjectiveCard } from "../../components/WeeklyObjectiveCard";
import { WeeklyTextCard } from "../../components/WeeklyTextCard";
import { moveObjective } from "../../utils/collections";

export function WeeklyReviewStep({
  areaFilterProps,
  reviewText,
  setReviewText,
  accomplishedObjectives,
  setAccomplishedObjectives,
  onBack,
  onNext,
}) {
  const moveAccomplishedObjective = (move) => (
    setAccomplishedObjectives((items) => moveObjective(items, move))
  );

  return (
    <section className="share-view weekly-document-view weekly-review-step">
      <TopControls {...areaFilterProps} />
      <div className="weekly-document-content">
        <div className="weekly-document-headings">
          <div>
            <h1>Weekly review</h1>
            <p>Reflect on how the week went and document your progress.</p>
          </div>
          <div>
            <h2>Projects</h2>
            <p>Projects worked on last week</p>
          </div>
        </div>
        <div className="weekly-document-layout">
          <div className="weekly-document-primary">
            <WeeklyTextCard
              value={reviewText}
              onChange={setReviewText}
              ariaLabel="Tasks finished this week"
            />
            <div className="weekly-document-actions">
              <button className="back-button" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
              <button className="next-button" onClick={onNext}>Wrap up</button>
            </div>
          </div>
          <SortableCollectionLane
            className="weekly-objective-stack"
            collectionId="weekly-accomplished-objectives"
            collectionSnapshot={accomplishedObjectives}
            items={accomplishedObjectives}
            laneId="objectives"
            onMove={moveAccomplishedObjective}
            onRestore={setAccomplishedObjectives}
            surfaceId="weekly-review-objectives"
          >
            {({ collectionItemProps }) => accomplishedObjectives.map((objective, index) => (
              <WeeklyObjectiveCard
                collectionItem={collectionItemProps(objective, index)}
                objective={objective}
                key={objective.id}
              />
            ))}
          </SortableCollectionLane>
        </div>
      </div>
    </section>
  );
}
