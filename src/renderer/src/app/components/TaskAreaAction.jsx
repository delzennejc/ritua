import { createContext, useContext, useId, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { FolderLabel, useAreaColor } from "./FolderLabel";
import { TaskActionConfirmation, TaskActionPopover } from "./TaskActionConfirmation";

const TaskAreaActionsContext = createContext(null);

export function TaskAreaActionsProvider({ areas, projects, onMove, children }) {
  return (
    <TaskAreaActionsContext.Provider value={{ areas, projects, onMove }}>
      {children}
    </TaskAreaActionsContext.Provider>
  );
}

export function TaskAreaAction({ task }) {
  const actions = useContext(TaskAreaActionsContext);
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(null);
  const [pendingArea, setPendingArea] = useState(null);
  const triggerRef = useRef(null);
  const id = useId();
  const channel = task.channel;
  const project = actions?.projects.find((item) => item.id === task.objectiveId);
  const projectChannel = project?.channel;
  const projectColor = useAreaColor(projectChannel || channel);
  const close = (restoreFocus = false) => {
    setPendingArea(null);
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  if (!actions) return <FolderLabel channel={task.channel} className="task-folder" />;

  return (
    <>
      <button
        ref={triggerRef}
        className="task-folder task-area-picker"
        type="button"
        title={`Move to another Area (${channel})`}
        aria-label={`Area for ${task.title}: ${channel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open || pendingArea ? id : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onClick={(event) => {
          event.stopPropagation();
          setPendingArea(null);
          setOpen((current) => !current);
        }}
      >
        <FolderLabel channel={task.channel} />
      </button>
      {open ? (
        <TaskActionPopover
          id={id}
          triggerRef={triggerRef}
          focusRef={selectedRef}
          role="menu"
          label={`Choose Area for ${task.title}`}
          className="task-area-menu"
          onClose={close}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
            const index = buttons.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === "ArrowDown") nextIndex = (index + 1) % buttons.length;
            if (event.key === "ArrowUp") nextIndex = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = buttons.length - 1;
            if (nextIndex !== undefined) {
              event.preventDefault();
              buttons[nextIndex]?.focus();
            }
          }}
        >
          {actions.areas.map((area, index) => (
            <button
              key={area.id}
              ref={area.label === channel || (!actions.areas.some((item) => item.label === channel) && index === 0) ? selectedRef : undefined}
              type="button"
              role="menuitemradio"
              aria-checked={area.label === channel}
              onClick={() => {
                if (area.label === channel) { close(true); return; }
                if (project && projectChannel !== area.label) {
                  setOpen(false);
                  setPendingArea(area);
                  return;
                }
                close(true);
                actions.onMove(task.id, area.label);
              }}
            >
              <FolderLabel channel={area.label} />
              {area.label === channel ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </TaskActionPopover>
      ) : null}
      {pendingArea ? (
        <TaskActionConfirmation
          id={id}
          triggerRef={triggerRef}
          title={`Move task to ${pendingArea.label}?`}
          description={project ? (
            <>
              It will be <strong className="task-area-removal">removed</strong> from the{" "}
              <strong className="task-area-project-name" style={{ "--project-color": projectColor }}>
                {project.title}
              </strong> Project.
            </>
          ) : undefined}
          confirmLabel="Move"
          onClose={close}
          onConfirm={() => actions.onMove(task.id, pendingArea.label, { unlinkFromProject: true })}
        />
      ) : null}
    </>
  );
}
