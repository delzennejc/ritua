import { ArrowLeft, CalendarCheck, X } from "@phosphor-icons/react";

export function PlanningIntro({ step, onBack, onNext, onFinish, shutdownTime, onShutdownTimeChange, onScheduleShutdown, onRemoveShutdown, shutdownScheduled }) {
  const content = [
    ["What do you want to get done today?", "Add tasks you want to work on today."],
    ["What can wait?", "Bump back tasks that aren't essential to work on today."],
    ["Finalize your plan for today", "Arrange your tasks in the order that you want to work on them."],
  ][step];

  return (
    <div className={`planning-intro step-${step}`}>
      <h1>{content[0]}</h1>
      <p>{content[1]}</p>
      {step === 2 ? (
        <form className="shutdown-card" onSubmit={(event) => {
          event.preventDefault();
          onScheduleShutdown();
        }}>
          <div className="shutdown-card-heading">
            <strong>Shutdown time</strong>
            {shutdownScheduled ? (
              <button type="button" className="shutdown-remove" aria-label="Remove shutdown time" title="Remove shutdown time" onClick={onRemoveShutdown}><X size={14} /></button>
            ) : null}
          </div>
          <p>What time would you like to wrap up work by?</p>
          <div>
            <input
              className="shutdown-time-control"
              type="time"
              aria-label="Shutdown time"
              value={shutdownTime}
              onChange={(event) => onShutdownTimeChange(event.target.value)}
              required
            />
            <button type="submit" className="calendar-add"><CalendarCheck size={15} /> {shutdownScheduled ? "Update calendar" : "Add to calendar"}</button>
          </div>
        </form>
      ) : null}
      <div className="wizard-actions">
        <button className="back-button" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
        <button className="next-button" onClick={step === 2 ? onFinish : onNext}>{step === 2 ? "Looks good" : "Next"}</button>
      </div>
    </div>
  );
}
