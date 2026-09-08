import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { useInlineCapture } from "../hooks/useInlineCapture";
import { AutoGrowingTextarea } from "./DetailsTitleInput";

export function InlineTaskStack({
  children,
  dateKey,
  firstTaskId,
  onCreateTask,
  total,
  addRowClassName = "",
  stackClassName = "",
}) {
  const draftDateKeyRef = useRef(dateKey);
  const taskStackRef = useRef(null);
  const [totalReturning, setTotalReturning] = useState(false);
  const {
    isAdding,
    draftTitle,
    inputRef,
    finishAdding,
    handleKeyDown,
    setDraftTitle,
    settlingItemId,
    startAdding,
    submit,
  } = useInlineCapture((title) => onCreateTask({
    title,
    dateKey: draftDateKeyRef.current,
  }));

  // Date navigation must save a typed draft to the day where capture began.
  useEffect(() => {
    if (isAdding && draftDateKeyRef.current !== dateKey) {
      setTotalReturning(true);
      finishAdding();
    }
  }, [isAdding, dateKey, finishAdding]);

  useLayoutEffect(() => {
    if (!settlingItemId) return;
    const stack = taskStackRef.current;
    const card = stack?.firstElementChild;
    if (card?.dataset.taskLayoutId !== settlingItemId) return;
    const gap = parseFloat(window.getComputedStyle(stack).rowGap) || 0;
    stack.style.setProperty("--created-task-offset", `${card.offsetHeight + gap}px`);
  }, [settlingItemId]);

  const rowClassName = `add-row inline-task-add ${addRowClassName}`.trim();
  const settlingVisibleTask = Boolean(settlingItemId && firstTaskId === settlingItemId);
  const finishWithReturningTotal = () => {
    setTotalReturning(true);
    finishAdding();
  };
  const handleCaptureKeyDown = (event) => {
    if (event.key === "Enter" || event.key === "Escape") setTotalReturning(true);
    handleKeyDown(event);
  };

  return (
    <>
      {isAdding ? (
        <form
          className={`${rowClassName} inline-capture-form`}
          onSubmit={(event) => {
            setTotalReturning(true);
            submit(event);
          }}
        >
          <Plus size={15} />
          <AutoGrowingTextarea
            ref={inputRef}
            aria-label="New task"
            autoComplete="off"
            placeholder="Add task"
            value={draftTitle}
            onBlur={finishWithReturningTotal}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleCaptureKeyDown}
          />
          <span>{total}</span>
        </form>
      ) : (
        <button
          className={`${rowClassName} ${settlingItemId ? "is-reappearing" : ""} ${totalReturning ? "is-total-returning" : ""}`.trim()}
          type="button"
          onClick={() => {
            draftDateKeyRef.current = dateKey;
            setTotalReturning(false);
            startAdding();
          }}
        >
          <Plus size={15} /> Add task <span>{total}</span>
        </button>
      )}
      <div
        ref={taskStackRef}
        className={`task-stack inline-task-stack ${stackClassName} ${settlingVisibleTask ? "is-settling-task" : ""}`.trim()}
      >
        {children}
      </div>
    </>
  );
}
