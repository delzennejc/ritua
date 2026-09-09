import { Dropdown } from "./Dropdown";
import { ProfileAvatar, useProfile } from "../../desktop/Profile";
import { AttachmentPicker, AttachmentLink, useAttachmentDraft } from "../../desktop/Attachments";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  DotsThree,
  Archive,
  Trash,
  CalendarX,
  Circle,
  FolderSimple,
  Paperclip,
  Plus,
  PushPin,
  X,
} from "@phosphor-icons/react";
import { DEFAULT_AREAS } from "../../../../domain/workspace-defaults";
import { CURRENT_DATE_KEY, dateFromKey } from "../utils/dates";
import { completedTasksLast } from "../../../../domain/tasks";
import { minutesLabel } from "../utils/time";
import { weekDaysFrom } from "../utils/weeks";
import { FolderLabel, useAreaColor } from "./FolderLabel";
import { AutoGrowingTextarea, DetailsTitleInput } from "./DetailsTitleInput";

const normalizeTitle = (title = "") => title.trim().toLocaleLowerCase();

const longDateLabel = (dateKey) => (
  dateFromKey(dateKey).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
);

export function ObjectiveDetails({
  areas = DEFAULT_AREAS,
  backlogGroups = [],
  datedTasksByDate,
  entryMode = "direct",
  initialScrollTop = 0,
  objective,
  onAddComment,
  onAddTask,
  onArchive,
  onClose,
  onDelete,
  onOpenTask,
  onRemoveFromWeek,
  onToggle,
  onToggleTask,
  onUpdate,
  returnTaskFocusId,
  returnFocusElement,
  tasks,
}) {
  const profile = useProfile();
  const contentRef = useRef(null);
  const dialogRef = useRef(null);
  const deleteCancelButtonRef = useRef(null);
  const deleteMenuButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const moreOpenRef = useRef(false);
  const taskDraftInputRef = useRef(null);
  const taskDraftReturnFocusRef = useRef(null);
  const titleId = useId();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [attachmentName, setAttachmentName] = useAttachmentDraft();
  const [comment, setComment] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [taskDraftOpen, setTaskDraftOpen] = useState(false);
  const [taskDraftTitle, setTaskDraftTitle] = useState("");
  const resolvedChannel = objective.channel;
  const projectColor = useAreaColor(resolvedChannel);
  const areaOptions = areas.some((area) => area.label === resolvedChannel)
    ? areas
    : [
        DEFAULT_AREAS.find((area) => area.label === resolvedChannel),
        ...areas,
      ].filter(Boolean);
  const weekDays = useMemo(() => weekDaysFrom(CURRENT_DATE_KEY), []);
  const canonicalEntries = useMemo(() => {
    const seenTaskIds = new Set();
    return [
      ...tasks.map((task) => ({ task, dateKey: CURRENT_DATE_KEY })),
      ...Object.entries(datedTasksByDate).flatMap(([dateKey, dateTasks]) => (
        dateTasks.map((task) => ({ task, dateKey }))
      )),
      ...backlogGroups.flatMap((group) => group.items.map((task) => ({
        task,
        dateKey: null,
        listLabel: group.label,
      }))),
    ].filter(({ task }) => {
      if (seenTaskIds.has(task.id)) return false;
      seenTaskIds.add(task.id);
      return true;
    });
  }, [backlogGroups, datedTasksByDate, tasks]);

  const taskRows = useMemo(() => {
    const linkedCanonicalEntries = canonicalEntries.filter(({ task }) => (
      task.objectiveId === objective.id
    ));
    const objectiveTasks = objective.tasks || [];
    const matchedObjectiveTaskIds = new Set();
    const canonicalRows = linkedCanonicalEntries.map((canonicalEntry) => {
      const objectiveTask = objectiveTasks.find((task) => (
        canonicalEntry.task.id === task.taskId
        || canonicalEntry.task.id === task.id
        || normalizeTitle(canonicalEntry.task.title) === normalizeTitle(task.title)
      ));
      if (objectiveTask) matchedObjectiveTaskIds.add(objectiveTask.id);
      return {
        canonicalEntry,
        objectiveTask: objectiveTask || canonicalEntry.task,
      };
    });
    const objectiveOnlyRows = objectiveTasks
      .filter((objectiveTask) => !matchedObjectiveTaskIds.has(objectiveTask.id))
      .map((objectiveTask) => ({ canonicalEntry: null, objectiveTask }));
    const rowSources = [...canonicalRows, ...objectiveOnlyRows];

    return completedTasksLast(rowSources.map(({ canonicalEntry, objectiveTask }) => {
      const canonicalTask = canonicalEntry?.task;
      const complete = canonicalTask?.complete ?? objectiveTask.complete;
      const plannedMinutes = canonicalTask?.minutes ?? objectiveTask.minutes ?? 0;
      const actualMinutes = canonicalTask && "actualMinutes" in canonicalTask
        ? canonicalTask.actualMinutes
        : "actualMinutes" in objectiveTask
          ? objectiveTask.actualMinutes
          : complete
            ? plannedMinutes
            : null;
      const dateKey = canonicalEntry?.dateKey || objectiveTask.dateKey || null;
      return {
        ...objectiveTask,
        id: canonicalTask?.id || objectiveTask.id,
        objectiveTaskId: objectiveTask.id,
        title: canonicalTask?.title || objectiveTask.title,
        canonicalTaskId: canonicalTask?.id || null,
        complete,
        plannedMinutes,
        actualMinutes,
        dateKey,
        dateLabel: dateKey
          ? longDateLabel(dateKey)
          : canonicalEntry?.listLabel || "Not scheduled",
      };
    }));
  }, [canonicalEntries, objective.id, objective.tasks]);

  const taskProgressByDate = useMemo(() => taskRows.reduce((totals, task) => {
    if (!task.dateKey) return totals;

    const current = totals[task.dateKey] || {
      completedTasks: 0,
      plannedMinutes: 0,
      totalTasks: 0,
    };

    return {
      ...totals,
      [task.dateKey]: {
        completedTasks: current.completedTasks + (task.complete ? 1 : 0),
        plannedMinutes: current.plannedMinutes + task.plannedMinutes,
        totalTasks: current.totalTasks + 1,
      },
    };
  }, {}), [taskRows]);

  useEffect(() => {
    moreOpenRef.current = moreOpen;
  }, [moreOpen]);

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    deleteCancelButtonRef.current?.focus();
  }, [deleteConfirmOpen]);

  useEffect(() => {
    if (!objective.complete || !taskDraftOpen) return;
    setTaskDraftOpen(false);
    setTaskDraftTitle("");
  }, [objective.complete, taskDraftOpen]);

  useEffect(() => {
    const previousFocus = returnFocusElement || document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();

    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        if (moreOpenRef.current) {
          setMoreOpen(false);
          moreButtonRef.current?.focus();
          return;
        }
        onClose();
        return;
      }
      if (keyboardEvent.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        keyboardEvent.preventDefault();
        (keyboardEvent.shiftKey ? last : first).focus();
      } else if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const objectiveTitle = Array.from(
        document.querySelectorAll("[data-objective-title-id]"),
      ).find((element) => element.dataset.objectiveTitleId === objective.id);
      const fallback = objectiveTitle
        || document.querySelector(".app-workspace button:not([disabled])");
      const returnTarget = previousFocus?.isConnected ? previousFocus : fallback;
      returnTarget?.focus?.();
    };
  }, [objective.id, onClose, returnFocusElement]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    content.scrollTop = initialScrollTop;
    if (!returnTaskFocusId) return undefined;

    const frame = requestAnimationFrame(() => {
      const taskTitle = Array.from(
        content.querySelectorAll("[data-objective-task-open-id]"),
      ).find((element) => element.dataset.objectiveTaskOpenId === returnTaskFocusId);
      taskTitle?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialScrollTop, objective.id, returnTaskFocusId]);

  const completeTaskCount = taskRows.filter((task) => task.complete).length;
  const startTaskDraft = (returnFocusElement) => {
    taskDraftReturnFocusRef.current = returnFocusElement || document.activeElement;
    setTaskDraftOpen(true);
    setTaskDraftTitle("");
    requestAnimationFrame(() => taskDraftInputRef.current?.focus());
  };
  const cancelTaskDraft = () => {
    setTaskDraftOpen(false);
    setTaskDraftTitle("");
    requestAnimationFrame(() => taskDraftReturnFocusRef.current?.focus?.());
  };
  const submitTaskDraft = (event) => {
    event.preventDefault();
    const title = taskDraftTitle.trim();
    if (!title || objective.complete) return;
    onAddTask(title);
    setTaskDraftTitle("");
    requestAnimationFrame(() => taskDraftInputRef.current?.focus());
  };
  const submitComment = (event) => {
    event.preventDefault();
    const nextComment = comment.trim();
    if (!nextComment && !attachmentName) return;
    onAddComment(nextComment, attachmentName);
    setComment("");
    setAttachmentName("");
  };
  const cancelDeleteConfirmation = () => {
    setDeleteConfirmOpen(false);
    requestAnimationFrame(() => deleteMenuButtonRef.current?.focus());
  };

  return (
    <div
      className="task-details-backdrop objective-details-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`objective-details ${taskRows.length ? "has-tasks" : "empty"} ${entryMode === "from-task" ? "from-task" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 className="sr-only" id={titleId}>Project details for {objective.title}</h2>
        <header className="objective-details-header">
          <div className="task-details-folder-picker objective-details-folder-picker">
            <span className="task-details-eyebrow">Area</span>
            <Dropdown
              title="Areas"
              label="Project area"
              triggerClassName="task-details-folder-value task-details-area-trigger"
              trigger={<> <FolderLabel channel={resolvedChannel} /><CaretDown size={12} aria-hidden="true" /> </>}
              items={areaOptions.map((folder) => ({
                id: folder.id,
                label: folder.label,
                icon: <FolderSimple size={15} weight="fill" style={{ color: folder.color }} />,
                role: "menuitemradio",
                checked: folder.label === resolvedChannel,
                onSelect: () => {
                  const nextChannel = folder.label;
                  onUpdate({ channel: nextChannel });
                },
              }))}
            />
          </div>

          <div className="task-details-actions objective-details-actions">
            <Dropdown
              className="task-details-more"
              triggerClassName="task-details-icon-action"
              triggerRef={moreButtonRef}
              label="More project actions"
              trigger={<DotsThree size={21} weight="bold" />}
              align="end"
              menuWidth={deleteConfirmOpen ? 320 : 240}
              open={moreOpen}
              onOpenChange={(open) => { setMoreOpen(open); setDeleteConfirmOpen(false); }}
              items={[
                { id: "complete", label: objective.complete ? "Mark incomplete" : "Mark complete", icon: objective.complete ? <Circle size={16} /> : <CheckCircle size={16} />, onSelect: onToggle },
                ...(objective.focusedThisWeek !== false && onRemoveFromWeek ? [{ id: "remove-week", label: "Remove from this week", icon: <CalendarX size={16} />, onSelect: onRemoveFromWeek }] : []),
                ...(onArchive ? [{ id: "archive", label: "Archive project", icon: <Archive size={16} />, onSelect: onArchive }] : []),
                ...(onDelete ? [{ id: "delete", label: "Delete project", icon: <Trash size={16} />, danger: true, buttonRef: deleteMenuButtonRef, closeOnSelect: false, onSelect: () => setDeleteConfirmOpen(true) }] : []),
              ]}
            >
              {deleteConfirmOpen ? (
                    <div className="task-details-delete-confirmation" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDeleteConfirmation(); } }}>
                      <p>Delete this project? Its tasks will stay in their Area.</p>
                      <button
                        className="dropdown-option" ref={deleteCancelButtonRef}

                        type="button"
                        onClick={cancelDeleteConfirmation}
                      >
                        <X size={16} aria-hidden="true" /> Cancel
                      </button>
                      <button
                        className="dropdown-option dropdown-option-danger"

                        type="button"
                        onClick={onDelete}
                      >
                        <Trash size={16} aria-hidden="true" /> Delete project
                      </button>
                    </div>
              ) : null}
            </Dropdown>
            <button
              className="task-details-icon-action"
              type="button"
              aria-label="Close project details"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div ref={contentRef} className="objective-details-content">
          <section className="objective-details-primary">
            <div
              className="objective-details-kicker"
              style={{ "--project-color": projectColor }}
            >
              <PushPin mirrored size={18} weight="duotone" aria-hidden="true" />
              <span>Project</span>
              {taskRows.length ? (
                <small>{completeTaskCount} of {taskRows.length} tasks complete</small>
              ) : null}
            </div>
            <div className="objective-details-title-row">
              <button
                className={`objective-details-completion ${objective.complete ? "complete" : ""}`}
                type="button"
                aria-label={objective.complete ? "Mark project incomplete" : "Mark project complete"}
                onClick={onToggle}
              >
                <CheckCircle size={28} weight={objective.complete ? "fill" : "regular"} />
              </button>
              <DetailsTitleInput
                className="objective-details-title-input"
                aria-label="Project title"
                value={objective.title}
                onChange={(changeEvent) => onUpdate({ title: changeEvent.target.value })}
                onBlur={(blurEvent) => {
                  if (!blurEvent.target.value.trim()) onUpdate({ title: "Untitled project" });
                }}
              />
            </div>

            <section className="objective-details-week" aria-label="Project time by day">
              {weekDays.map((day) => {
                const {
                  completedTasks = 0,
                  plannedMinutes = 0,
                  totalTasks = 0,
                } = taskProgressByDate[day.dateKey] || {};
                const allTasksComplete = totalTasks > 0 && completedTasks === totalTasks;
                const progress = totalTasks ? (completedTasks / totalTasks) * 100 : 0;

                return (
                  <div className={allTasksComplete ? "complete" : ""} key={day.dateKey}>
                    <strong>{day.label}</strong>
                    <span className="objective-details-day-total">
                      {minutesLabel(plannedMinutes)}
                    </span>
                    <div
                      className="objective-details-day-progress"
                      role={totalTasks ? "progressbar" : undefined}
                      aria-label={totalTasks
                        ? `${day.label} task completion`
                        : undefined}
                      aria-valuemin={totalTasks ? 0 : undefined}
                      aria-valuemax={totalTasks || undefined}
                      aria-valuenow={totalTasks ? completedTasks : undefined}
                      aria-valuetext={totalTasks
                        ? `${completedTasks} of ${totalTasks} tasks complete`
                        : undefined}
                    >
                      <span aria-hidden="true" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </section>

            {taskRows.length ? (
              <ul className="objective-details-tasks">
                {taskRows.map((task) => (
                  <li
                    className={task.complete ? "complete" : ""}
                    data-task-layout-complete={String(Boolean(task.complete))}
                    data-task-layout-id={task.id}
                    key={task.id}
                  >
                    <button
                      className="objective-details-task-completion"
                      type="button"
                      aria-label={task.complete ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                      onClick={() => onToggleTask(task.objectiveTaskId, task.canonicalTaskId)}
                    >
                      <CheckCircle size={19} weight={task.complete ? "fill" : "regular"} />
                    </button>
                    {task.canonicalTaskId && onOpenTask ? (
                      <button
                        className="objective-details-task-title"
                        type="button"
                        aria-label={`Open task details for ${task.title}`}
                        data-objective-task-open-id={task.id}
                        onClick={(clickEvent) => onOpenTask(
                          task,
                          clickEvent.currentTarget,
                          contentRef.current?.scrollTop || 0,
                        )}
                      >
                        {task.title}
                      </button>
                    ) : (
                      <span className="objective-details-task-title-static">{task.title}</span>
                    )}
                    {task.dateKey ? (
                      <time className="objective-details-task-date" dateTime={task.dateKey}>
                        {task.dateLabel}
                      </time>
                    ) : (
                      <span className="objective-details-task-date">{task.dateLabel}</span>
                    )}
                    <span className="objective-details-task-duration">
                      {minutesLabel(task.actualMinutes)} / {minutesLabel(task.plannedMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : !taskDraftOpen ? (
              <p className="objective-details-empty">No linked tasks yet.</p>
            ) : null}
            {taskDraftOpen ? (
              <form
                className="objective-details-task-draft"
                onBlur={(event) => {
                  if (
                    !taskDraftTitle.trim()
                    && !event.currentTarget.contains(event.relatedTarget)
                  ) {
                    cancelTaskDraft();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelTaskDraft();
                  }
                }}
                onSubmit={submitTaskDraft}
              >
                <span className="objective-details-task-draft-check" aria-hidden="true">
                  <CheckCircle size={19} />
                </span>
                <AutoGrowingTextarea
                  ref={taskDraftInputRef}
                  aria-label={`New task in ${objective.title}`}
                  autoComplete="off"
                  placeholder="Type a task title"
                  value={taskDraftTitle}
                  onChange={(event) => setTaskDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      submitTaskDraft(event);
                    }
                  }}
                />
                <span className="objective-details-task-date">Anytime</span>
                <span className="objective-details-task-duration">--:-- / --:--</span>
              </form>
            ) : null}
            {!objective.complete && onAddTask ? (
              <button
                className="objective-details-add-task"
                type="button"
                onClick={(event) => startTaskDraft(event.currentTarget)}
              >
                <Plus size={19} aria-hidden="true" />
                Add task
              </button>
            ) : null}

            <section className="objective-details-notes">
              <textarea maxLength={200000}
                aria-label="Project notes and context"
                placeholder="Add notes, context, or links…"
                value={objective.notes || ""}
                onChange={(event) => onUpdate({ notes: event.target.value })}
              />
            </section>

            {(objective.comments || []).length ? (
              <ol className="task-details-comments objective-details-comments" aria-label="Project comments">
                {objective.comments.map((item) => (
                  <li key={item.id}>
                    <ProfileAvatar decorative />
                    <div>
                      <strong>{item.authorName || profile.displayName} <time>{item.time}</time></strong>
                      <p>{item.text}</p>
                      {item.attachment ? <AttachmentLink attachment={item.attachment} /> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}

            <form
              className="task-details-comment-form objective-details-comment-form"
              onSubmit={submitComment}
            >
              <ProfileAvatar />
              <div>
                <input
                  maxLength={200000}
                  aria-label="Add a project comment"
                  placeholder="Add a comment…"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
                {attachmentName ? (
                  <span className="task-details-attachment-name">{attachmentName.name || attachmentName}</span>
                ) : null}
              </div>
              <AttachmentPicker onChange={setAttachmentName} />
              <button
                className="task-details-comment-submit"
                type="submit"
                disabled={!comment.trim() && !attachmentName}
              >
                Send
              </button>
            </form>
          </section>
        </div>
      </section>
    </div>
  );
}
