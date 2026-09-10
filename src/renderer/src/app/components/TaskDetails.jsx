import { hasPendingMediaImports, waitForMediaImports } from '../../desktop/pending-media';
import { TaskMedia } from '../../desktop/TaskMedia';
import { Dropdown, ChoiceDropdown } from "./Dropdown";
import { TaskActionPopover } from "./TaskActionConfirmation";
import { SortableCollectionItem, SortableCollectionLane } from "./SortableCollection";
import { useDragDropManager } from "@dnd-kit/react";
import { ProfileAvatar, useProfile } from "../../desktop/Profile";
import { AttachmentPicker, AttachmentLink, useAttachmentDraft } from "../../desktop/Attachments";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  ArrowsClockwise,
  CalendarBlank,
  CalendarX,
  Circle,
  Eraser,
  Trash,
  CaretDown,
  CheckCircle,
  Clock,
  DotsThree,
  DotsSixVertical,
  FolderSimple,
  Paperclip,
  Plus,
  PushPin,
  Prohibit,
  X,
} from "@phosphor-icons/react";
import { DEFAULT_AREAS } from "../../../../domain/workspace-defaults";
import { nextAvailableCalendarStart } from "../utils/calendar";
import { dateFromKey } from "../utils/dates";
import {
  noRecurrence,
  recurrenceForPreset,
  recurrenceLabel,
  recurrenceOptions,
  RECURRENCE_PRESETS,
} from "../../../../domain/recurrence";
import { minutesLabel, timeLabel } from "../utils/time";
import { taskActivityWithCreation } from "../utils/taskActivity";
import { FolderLabel, useAreaColor } from "./FolderLabel";
import { DetailsTitleInput } from "./DetailsTitleInput";
import { RecurrenceCustomFields } from "./RecurrenceCustomFields";

const EMPTY_CALENDAR_EVENTS = [];

const minuteValue = (value) => {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const scheduleTimeLabel = (minutes) => (
  minutes === 24 * 60 ? "00:00" : timeLabel(minutes)
);

const durationDraftFrom = (minutes) => (
  Number.isFinite(minutes) && minutes > 0 ? minutesLabel(minutes) : ""
);

const durationMinutesFrom = (value) => {
  const normalized = value.trim();
  if (!normalized || normalized === "--:--") return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const match = /^(\d+):([0-5]\d)$/.exec(normalized);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
};

function InlineDurationEditor({
  allowEmpty = false,
  label,
  maxMinutes,
  minMinutes = 1,
  onCommit,
  value,
}) {
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const hintId = useId();
  const [draft, setDraft] = useState(() => durationDraftFrom(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const displayValue = minutesLabel(value);

  useEffect(() => {
    if (!editing) setDraft(durationDraftFrom(value));
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const returnFocusToTrigger = () => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const commitDraft = ({ revertInvalid = false } = {}) => {
    const nextMinutes = durationMinutesFrom(draft);
    const validEmpty = nextMinutes === null && allowEmpty;
    const validDuration = Number.isFinite(nextMinutes)
      && nextMinutes >= minMinutes
      && (maxMinutes === undefined || nextMinutes <= maxMinutes);

    if (!validEmpty && !validDuration) {
      if (revertInvalid) {
        setDraft(durationDraftFrom(value));
        setError("");
        setEditing(false);
        return true;
      }
      if (nextMinutes === null) {
        setError("Enter a duration in minutes or H:MM.");
      } else if (!Number.isFinite(nextMinutes)) {
        setError("Use minutes or H:MM.");
      } else if (nextMinutes < minMinutes) {
        setError(`Enter at least ${minutesLabel(minMinutes)}.`);
      } else {
        setError(`Enter no more than ${minutesLabel(maxMinutes)} so this task ends by midnight.`);
      }
      return false;
    }

    onCommit(validEmpty ? null : nextMinutes);
    setError("");
    setEditing(false);
    return true;
  };

  const startEditing = () => {
    setDraft(durationDraftFrom(value));
    setError("");
    setEditing(true);
  };

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        className="task-details-duration-trigger"
        type="button"
        aria-label={`Edit ${label}, currently ${displayValue}`}
        title="Click to edit"
        onClick={startEditing}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
          keyboardEvent.preventDefault();
          startEditing();
        }}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <span className="task-details-duration-editor">
      <input
        ref={inputRef}
        className="task-details-duration-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={hintId}
        aria-invalid={Boolean(error)}
        aria-label={label}
        placeholder="--:--"
        title={error || "Use minutes or H:MM"}
        value={draft}
        onBlur={() => commitDraft({ revertInvalid: true })}
        onChange={(changeEvent) => {
          setDraft(changeEvent.target.value);
          setError("");
        }}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key === "Enter") {
            keyboardEvent.preventDefault();
            if (commitDraft()) returnFocusToTrigger();
            return;
          }
          if (keyboardEvent.key !== "Escape") return;
          keyboardEvent.preventDefault();
          keyboardEvent.stopPropagation();
          setDraft(durationDraftFrom(value));
          setError("");
          setEditing(false);
          returnFocusToTrigger();
        }}
      />
      {error ? (
        <span className="task-details-duration-error" id={hintId} role="alert">
          {error}
        </span>
      ) : (
        <span className="sr-only" id={hintId}>
          Enter minutes or a duration in H:MM format.
        </span>
      )}
    </span>
  );
}

function InlineSubtaskTitleEditor({
  onCommit,
  value,
}) {
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const editingRef = useRef(false);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const returnFocusToTrigger = () => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const finishEditing = ({ cancel = false, returnFocus = false } = {}) => {
    if (!editingRef.current) return;
    editingRef.current = false;
    const nextTitle = draft.trim();
    const addSubtaskButton = inputRef.current?.closest(".task-details")
      ?.querySelector(".task-details-add-subtask");
    if (!cancel && (!nextTitle || nextTitle !== value)) onCommit(nextTitle);
    setDraft(cancel ? value : nextTitle);
    setEditing(false);
    if (returnFocus) {
      if (!cancel && !nextTitle) requestAnimationFrame(() => addSubtaskButton?.focus());
      else returnFocusToTrigger();
    }
  };

  const startEditing = () => {
    editingRef.current = true;
    setDraft(value);
    setEditing(true);
  };

  return (
    <span className="task-details-subtask-title">
      {editing ? (
        <input
          ref={inputRef}
          className="task-details-subtask-title-input"
          type="text"
          autoComplete="off"
          aria-label={`Subtask title for ${value}`}
          value={draft}
          onBlur={() => finishEditing()}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key === "Enter") {
              if (keyboardEvent.nativeEvent.isComposing) return;
              keyboardEvent.preventDefault();
              finishEditing({ returnFocus: true });
              return;
            }
            if (keyboardEvent.key !== "Escape") return;
            keyboardEvent.preventDefault();
            keyboardEvent.stopPropagation();
            finishEditing({ cancel: true, returnFocus: true });
          }}
        />
      ) : (
        <button
          ref={triggerRef}
          className="task-details-subtask-title-trigger"
          type="button"
          aria-label={`Edit subtask title: ${value}`}
          title="Click to edit"
          onClick={startEditing}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
            keyboardEvent.preventDefault();
            startEditing();
          }}
        >
          {value}
        </button>
      )}
    </span>
  );
}

const scheduleDraftFrom = (task, event, taskDateKey, calendarEvents) => {
  const dateKey = event?.dateKey || taskDateKey;
  const duration = task.minutes > 0 ? task.minutes : 30;
  const start = event?.start
    ?? (task.time ? minuteValue(task.time) : nextAvailableCalendarStart(
      calendarEvents, duration, dateKey, { taskId: task.id },
    ));
  const end = event?.end ?? (start === null ? null : Math.min(24 * 60, start + duration));

  return {
    dateKey,
    start: start === null ? "" : timeLabel(start),
    end: end === null ? "" : scheduleTimeLabel(end),
    error: start === null
      ? `No ${minutesLabel(duration)} opening is available on this day. Choose another date or enter a time.`
      : "",
  };
};

const formatDate = (dateKey, options) => dateFromKey(dateKey).toLocaleDateString(
  "en-US",
  options,
);

function ScheduleEditor({
  draft,
  error,
  onCancel,
  onClearError,
  onSubmit,
}) {
  return (
    <form
      className="task-details-schedule-editor"
      noValidate
      onChange={onClearError}
      onSubmit={onSubmit}
    >
      <label>
        <span>Date</span>
        <input
          name="dateKey"
          type="date"
          required
          defaultValue={draft.dateKey}
        />
      </label>
      <label>
        <span>Starts</span>
        <input
          name="start"
          type="time"
          step="300"
          required
          defaultValue={draft.start}
        />
      </label>
      <label>
        <span>Ends</span>
        <input
          name="end"
          type="time"
          step="300"
          required
          defaultValue={draft.end}
        />
      </label>
      {error ? <p className="task-details-schedule-error" role="alert">{error}</p> : null}
      <div className="task-details-schedule-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          Save time
        </button>
      </div>
    </form>
  );
}

function RecurrenceEditor({ dateKey, onCancel, onChange, recurrence }) {
  return (
    <form
      className="task-details-recurrence-editor"
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key !== "Escape") return;
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        onCancel();
      }}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        onChange(recurrence);
      }}
    >
      <div className="task-details-recurrence-preset">
        <span>Repeat</span>
        <Dropdown
          label="Task recurrence"
          triggerClassName="task-details-recurrence-trigger"
          menuWidth={320}
          trigger={<><span>{recurrenceOptions(dateKey).find((option) => option.value === (recurrence?.preset || RECURRENCE_PRESETS.NONE))?.label}</span><CaretDown size={14} /></>}
          items={recurrenceOptions(dateKey).map((option) => ({
            id: option.value, label: option.label,
            icon: option.value === RECURRENCE_PRESETS.NONE
              ? <Prohibit size={16} />
              : <ArrowsClockwise size={16} />,
            role: "menuitemradio",
            checked: option.value === (recurrence?.preset || RECURRENCE_PRESETS.NONE),
            onSelect: () => onChange(recurrenceForPreset(option.value, dateKey, recurrence), false),
          }))}
        />
      </div>
      {recurrence?.preset === RECURRENCE_PRESETS.CUSTOM ? (
        <RecurrenceCustomFields
          dateKey={dateKey}
          onChange={(nextRecurrence) => onChange(nextRecurrence, false)}
          recurrence={recurrence}
        />
      ) : null}
      <p>Changes apply from this occurrence or today, whichever is later. Past and completed tasks keep their history; individually edited future tasks are preserved.</p>
      <div className="task-details-recurrence-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="submit">Save repeat</button>
      </div>
    </form>
  );
}

export function TaskDetails({
  areas = DEFAULT_AREAS,
  calendarEvents = EMPTY_CALENDAR_EVENTS,
  entryMode = "direct",
  event,
  objective,
  projects = [],
  onAddComment,
  onAddSubtask,
  onAssignProject,
  onChangeArea,
  onClose,
  onDelete,
  onOpenObjective,
  onRemoveSchedule,
  onReorderSubtasks,
  onSchedule,
  onToggle,
  onToggleSubtask,
  onUpdateRecurrence,
  onUpdateSubtask,
  onUpdateTask,
  returnFocusElement,
  task,
  taskDateKey,
}) {
  const dragManager = useDragDropManager();
  const profile = useProfile();
  const areaChangeCancelButtonRef = useRef(null);
  const areaPickerRef = useRef(null);
  const dialogRef = useRef(null);
  const deleteCancelButtonRef = useRef(null);
  const moreTriggerRef = useRef(null);
  const recurrenceTriggerRef = useRef(null);
  const scheduleTriggerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const pendingAreaChangeRef = useRef(null);
  const subtaskDraftRef = useRef({
    title: "",
    actualMinutes: null,
    minutes: 20,
  });
  const subtaskInputRef = useRef(null);
  const areaChangeDescriptionId = useId();
  const areaChangeTitleId = useId();
  const titleId = useId();
  const deleteConfirmationId = useId();
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [comment, setComment] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingAreaChange, setPendingAreaChange] = useState(null);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [attachmentName, setAttachmentName] = useAttachmentDraft();
  const [subtaskActualMinutes, setSubtaskActualMinutes] = useState(null);
  const [subtaskMinutes, setSubtaskMinutes] = useState(20);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState(() => (
    scheduleDraftFrom(task, event, taskDateKey, calendarEvents)
  ));
  const recurrenceDateKey = task.recurrenceStartDateKey || taskDateKey;
  const [recurrenceDraft, setRecurrenceDraft] = useState(() => (
    task.recurrence || noRecurrence()
  ));

  useEffect(() => {
    const draft = scheduleDraftFrom(task, event, taskDateKey, calendarEvents);
    setScheduleDraft(draft);
    setScheduleError(draft.error);
  }, [
    calendarEvents,
    event?.dateKey,
    event?.end,
    event?.start,
    task.id,
    task.minutes,
    task.time,
    taskDateKey,
  ]);

  useEffect(() => {
    setRecurrenceDraft(task.recurrence || noRecurrence());
    setRecurrenceOpen(false);
  }, [task.id, task.recurrence]);

  useEffect(() => {
    if (addingSubtask) subtaskInputRef.current?.focus();
  }, [addingSubtask]);

  useEffect(() => {
    pendingAreaChangeRef.current = pendingAreaChange;
    if (pendingAreaChange) areaChangeCancelButtonRef.current?.focus();
  }, [pendingAreaChange]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const startAddingSubtask = () => {
    setAddingSubtask(true);
    requestAnimationFrame(() => subtaskInputRef.current?.focus());
  };

  const resetSubtaskDraft = () => {
    subtaskDraftRef.current = {
      title: "",
      actualMinutes: null,
      minutes: 20,
    };
    setSubtaskTitle("");
    setSubtaskActualMinutes(null);
    setSubtaskMinutes(20);
  };

  const cancelSubtaskDraft = () => {
    setAddingSubtask(false);
    resetSubtaskDraft();
  };

  const updateSubtaskDraft = (field, value) => {
    subtaskDraftRef.current = {
      ...subtaskDraftRef.current,
      [field]: value,
    };
    if (field === "title") setSubtaskTitle(value);
    if (field === "actualMinutes") setSubtaskActualMinutes(value);
    if (field === "minutes") setSubtaskMinutes(value);
  };

  const createSubtaskFromDraft = ({ continueAdding }) => {
    const { actualMinutes, minutes, title: draftTitle } = subtaskDraftRef.current;
    const title = draftTitle.trim();
    if (!title) return false;
    onAddSubtask({
      title,
      actualMinutes,
      minutes,
    });
    resetSubtaskDraft();
    if (continueAdding) {
      requestAnimationFrame(() => subtaskInputRef.current?.focus());
    } else {
      setAddingSubtask(false);
    }
    return true;
  };

  const cancelDeleteConfirmation = (restoreFocus = false) => {
    setDeleteConfirmOpen(false);
    if (restoreFocus) requestAnimationFrame(() => moreTriggerRef.current?.focus());
  };

  const cancelAreaChange = () => {
    setPendingAreaChange(null);
    requestAnimationFrame(() => areaPickerRef.current?.focus());
  };

  const closeTaskDetails = async () => {
    if (hasPendingMediaImports()) await waitForMediaImports();
    createSubtaskFromDraft({ continueAdding: false });
    onCloseRef.current();
  };

  useEffect(() => {
    const previousFocus = returnFocusElement || document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();

    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.defaultPrevented || (dragManager && !dragManager.dragOperation.status.idle)) return;
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        if (pendingAreaChangeRef.current) {
          setPendingAreaChange(null);
          requestAnimationFrame(() => areaPickerRef.current?.focus());
          return;
        }
        closeTaskDetails();
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
      const taskTitle = Array.from(
        document.querySelectorAll("[data-task-title-id]"),
      ).find((element) => element.dataset.taskTitleId === task.id);
      const fallback = taskTitle
        || document.querySelector(".app-workspace button:not([disabled])");
      const returnTarget = previousFocus?.isConnected ? previousFocus : fallback;
      returnTarget?.focus?.();
    };
  }, [dragManager, returnFocusElement, task.id]);

  const submitSubtask = (submitEvent) => {
    submitEvent.preventDefault();
    createSubtaskFromDraft({ continueAdding: true });
  };

  const openScheduleEditor = () => {
    const draft = scheduleDraftFrom(task, event, taskDateKey, calendarEvents);
    setScheduleDraft(draft);
    setScheduleError(draft.error);
    setScheduleOpen(true);
  };

  const submitSchedule = (submitEvent) => {
    submitEvent.preventDefault();
    const form = submitEvent.currentTarget;
    const dateKey = form.elements.namedItem("dateKey")?.value ?? scheduleDraft.dateKey;
    const start = minuteValue(
      form.elements.namedItem("start")?.value ?? scheduleDraft.start,
    );
    const parsedEnd = minuteValue(
      form.elements.namedItem("end")?.value ?? scheduleDraft.end,
    );
    const end = parsedEnd === 0 && start > 0 ? 24 * 60 : parsedEnd;
    if (!dateKey || !Number.isFinite(start) || !Number.isFinite(end)) {
      setScheduleError("Choose a date, start time, and end time.");
      return;
    }
    if (end <= start) {
      setScheduleError("Choose an end time after the start time.");
      return;
    }
    setScheduleError("");
    onSchedule({
      dateKey,
      start,
      end,
    });
    setScheduleOpen(false);
  };

  const submitComment = (submitEvent) => {
    submitEvent.preventDefault();
    const nextComment = comment.trim();
    if (!nextComment && !attachmentName) return;
    onAddComment(nextComment, attachmentName);
    setComment("");
    setAttachmentName("");
  };

  const actualMinutes = task.actualMinutes ?? null;
  const plannedMaxMinutes = event ? 24 * 60 - event.start : undefined;
  const plannedMinMinutes = event ? Math.min(5, plannedMaxMinutes) : 1;
  const activity = taskActivityWithCreation(task);
  const comments = task.comments || [];
  const resolvedChannel = task.channel;
  const resolvedObjectiveChannel = objective?.channel;
  const projectColor = useAreaColor(objective?.channel || resolvedChannel);
  const areaOptions = areas.some((area) => area.label === resolvedChannel)
    ? areas
    : [
        DEFAULT_AREAS.find((area) => area.label === resolvedChannel),
        ...areas,
      ].filter(Boolean);
  const projectOptions = [
    ...projects,
    ...(objective && !projects.some((project) => project.id === objective.id)
      ? [objective]
      : []),
  ].filter((project) => {
    const projectChannel = project.channel;
    return projectChannel === resolvedChannel
      && (!project.complete || project.id === objective?.id);
  });
  const scheduledDateLabel = formatDate(
    event?.dateKey || taskDateKey,
    { weekday: "long", month: "short", day: "numeric" },
  );

  return (
    <div
      className={`task-details-backdrop ${expanded ? "expanded" : ""}`}
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) closeTaskDetails();
      }}
    >
      <section
        ref={dialogRef}
        className={`task-details ${expanded ? "expanded" : ""} ${entryMode === "from-project" ? "from-project" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 className="sr-only" id={titleId}>Task details for {task.title}</h2>
        <header className="task-details-header">
          <div className="task-details-folder-picker">
            <span className="task-details-eyebrow">Area</span>
            <Dropdown
              title="Areas"
              label="Task area"
              triggerRef={areaPickerRef}
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
                  if (nextChannel === resolvedChannel) {
                    setPendingAreaChange(null);
                    return;
                  }
                  if (objective && resolvedObjectiveChannel !== nextChannel) {
                    setPendingAreaChange(nextChannel);
                    return;
                  }
                  setPendingAreaChange(null);
                  onChangeArea(nextChannel);
                },
              }))}
            />
          </div>
          <div className="task-details-actions">
            <Dropdown
              className="task-details-more task-details-schedule"
              triggerClassName={scheduleOpen ? "active" : ""}
              triggerRef={scheduleTriggerRef}
              label="Schedule task"
              trigger={<><CalendarBlank size={17} /> {event ? "Scheduled" : "Schedule"}</>}
              open={scheduleOpen}
              align="end"
              menuWidth={520}
              onOpenChange={(open) => {
                if (open) openScheduleEditor();
                else setScheduleOpen(false);
                setMoreOpen(false);
                setDeleteConfirmOpen(false);
                setRecurrenceOpen(false);
              }}
            >

          <ScheduleEditor
            draft={scheduleDraft}
            error={scheduleError}
            onCancel={() => {
              setScheduleError("");
              setScheduleOpen(false);
              scheduleTriggerRef.current?.focus();
            }}
            onClearError={() => setScheduleError("")}
            onSubmit={submitSchedule}
          />
            </Dropdown>
            <Dropdown
              className="task-details-more task-details-repeat"
              triggerClassName={recurrenceOpen ? "active" : ""}
              triggerRef={recurrenceTriggerRef}
              triggerTitle={recurrenceLabel(task.recurrence, recurrenceDateKey)}
              label="Repeat task"
              trigger={<><ArrowsClockwise size={17} /> {task.recurrenceSeriesId ? "Repeats" : "Repeat"}</>}
              align="end"
              menuWidth={420}
              open={recurrenceOpen}
              onOpenChange={(open) => {
                setRecurrenceDraft(task.recurrence || noRecurrence());
                setRecurrenceOpen(open);
                if (open) {
                  setScheduleOpen(false);
                  setMoreOpen(false);
                  setDeleteConfirmOpen(false);
                }
              }}
            >
              <RecurrenceEditor
                dateKey={recurrenceDateKey}
                recurrence={recurrenceDraft}
                onCancel={() => {
                  setRecurrenceDraft(task.recurrence || noRecurrence());
                  setRecurrenceOpen(false);
                  recurrenceTriggerRef.current?.focus();
                }}
                onChange={(nextRecurrence, save = true) => {
                  if (!save) {
                    setRecurrenceDraft(nextRecurrence);
                    return;
                  }
                  onUpdateRecurrence(nextRecurrence);
                  setRecurrenceOpen(false);
                  recurrenceTriggerRef.current?.focus();
                }}
              />
            </Dropdown>
            <button
              type="button"
              onClick={() => {
                startAddingSubtask();
                setMoreOpen(false);
                setDeleteConfirmOpen(false);
                setRecurrenceOpen(false);
              }}
            >
              <Plus size={17} /> Subtask
            </button>
            <Dropdown
              className="task-details-more"
              triggerClassName="task-details-icon-action"
              triggerRef={moreTriggerRef}
              label="More task actions"
              trigger={<DotsThree size={21} weight="bold" />}
              align="end"
              open={moreOpen}
              onOpenChange={(open) => {
                setMoreOpen(open);
                setDeleteConfirmOpen(false);
                if (open) {
                  setScheduleOpen(false);
                  setRecurrenceOpen(false);
                }
              }}
              items={[
                {
                  id: "complete",
                  label: task.complete ? "Mark incomplete" : "Mark complete",
                  icon: task.complete ? <Circle size={16} /> : <CheckCircle size={16} />,
                  onSelect: onToggle,
                },
                ...(event ? [{
                  id: "unschedule", label: "Remove from calendar",
                  icon: <CalendarX size={16} />, onSelect: onRemoveSchedule,
                }] : []),
                ...(task.notes ? [{
                  id: "clear-notes", label: "Clear notes",
                  icon: <Eraser size={16} />, onSelect: () => onUpdateTask({ notes: "" }),
                }] : []),
                {
                  id: "delete", label: "Delete task", danger: true,
                  icon: <Trash size={16} />, onSelect: () => setDeleteConfirmOpen(true),
                },
              ]}
            />
            {deleteConfirmOpen ? (
              <TaskActionPopover
                id={deleteConfirmationId}
                triggerRef={moreTriggerRef}
                focusRef={deleteCancelButtonRef}
                labelledBy={`${deleteConfirmationId}-title`}
                onClose={cancelDeleteConfirmation}
                className="task-details-delete-confirmation"
              >
                <strong id={`${deleteConfirmationId}-title`}>
                  {task.recurrenceSeriesId ? "Delete recurring task?" : "Delete this task?"}
                </strong>
                <button ref={deleteCancelButtonRef} className="dropdown-option" type="button" onClick={() => cancelDeleteConfirmation(true)}>
                  <X size={16} aria-hidden="true" />
                  <span>Cancel</span>
                </button>
                <button className="dropdown-option dropdown-option-danger" type="button" onClick={() => onDelete("single")}>
                  <Trash size={16} aria-hidden="true" />
                  <span>{task.recurrenceSeriesId ? "This task only" : "Delete task"}</span>
                </button>
                {task.recurrenceSeriesId ? (
                  <button className="dropdown-option dropdown-option-danger" type="button" onClick={() => onDelete("following")}>
                    <ArrowsClockwise size={16} aria-hidden="true" />
                    <span>This and following tasks</span>
                  </button>
                ) : null}
              </TaskActionPopover>
            ) : null}
            <button
              className="task-details-icon-action"
              type="button"
              aria-label={expanded ? "Restore task details size" : "Expand task details"}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}
            </button>
            <button
              className="task-details-icon-action"
              type="button"
              aria-label="Close task details"
              onClick={closeTaskDetails}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        {pendingAreaChange ? (
          <div
            className="task-details-area-confirmation"
            role="alertdialog"
            aria-labelledby={areaChangeTitleId}
            aria-describedby={areaChangeDescriptionId}
          >
            <div>
              <strong id={areaChangeTitleId}>Move task to {pendingAreaChange}?</strong>
              <p id={areaChangeDescriptionId}>
                It will be removed from the {objective.title} Project.
              </p>
            </div>
            <div className="task-details-area-confirmation-actions">
              <button
                ref={areaChangeCancelButtonRef}
                className="secondary-button"
                type="button"
                onClick={cancelAreaChange}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  onChangeArea(pendingAreaChange, { unlinkFromProject: true });
                  setPendingAreaChange(null);
                }}
              >
                Move task
              </button>
            </div>
          </div>
        ) : null}




        <div className="task-details-scroll">
          <section className="task-details-primary">
            <div
              className={`task-details-objective ${objective ? "linked" : "unlinked"} ${!objective && onAssignProject ? "project-selectable" : ""}`}
              style={objective ? { "--project-color": projectColor } : undefined}
            >
              <PushPin mirrored
                aria-hidden="true"
                size={18}
                weight={objective ? "duotone" : "regular"}
              />
              {objective && onOpenObjective ? (
                <button
                  className="task-details-objective-link"
                  type="button"
                  aria-label={`Open project details for ${objective.title}`}
                  onClick={(clickEvent) => onOpenObjective(clickEvent.currentTarget)}
                >
                  {objective.title}
                </button>
              ) : (
                <span>{objective?.title || "No project"}</span>
              )}
              {onAssignProject ? (
                <ChoiceDropdown
                  label="Task project" className="task-details-project-picker"
                  trigger={<CaretDown size={13} aria-hidden="true" />}
                  value={objective?.id || ""} onChange={(value) => onAssignProject(value || null)}
                  options={[
                    { value: "", label: projectOptions.length ? "No project" : `No projects in ${resolvedChannel}` },
                    ...projectOptions.map((project) => ({ value: project.id, label: project.title, disabled: project.complete, icon: <PushPin mirrored size={15} /> })),
                  ]}
                />
              ) : null}
            </div>
            <div className="task-details-title-row">
              <button
                className={`task-details-completion ${task.complete ? "complete" : ""}`}
                type="button"
                aria-label={task.complete ? "Mark task incomplete" : "Mark task complete"}
                onClick={onToggle}
              >
                <CheckCircle size={25} weight={task.complete ? "fill" : "regular"} />
              </button>
              <DetailsTitleInput
                className="task-details-title-input"
                value={task.title}
                aria-label="Task title"
                onChange={(changeEvent) => onUpdateTask({ title: changeEvent.target.value })}
                onBlur={(blurEvent) => {
                  if (!blurEvent.target.value.trim()) onUpdateTask({ title: "Untitled task" });
                }}
              />
              <dl className="task-details-time-summary">
                <div>
                  <dt>Actual</dt>
                  <dd>
                    <InlineDurationEditor
                      allowEmpty
                      label="Task actual time"
                      value={actualMinutes}
                      onCommit={(nextMinutes) => (
                        onUpdateTask({ actualMinutes: nextMinutes })
                      )}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Planned</dt>
                  <dd>
                    <InlineDurationEditor
                      label="Task planned time"
                      maxMinutes={plannedMaxMinutes}
                      minMinutes={plannedMinMinutes}
                      value={task.minutes}
                      onCommit={(nextMinutes) => onUpdateTask({ minutes: nextMinutes })}
                    />
                  </dd>
                </div>
              </dl>
            </div>

            <SortableCollectionLane
              as="ul"
              className="task-details-subtasks"
              collectionId={`subtasks-${task.id}`}
              collectionSnapshot={task.subtasks || []}
              items={task.subtasks || []}
              laneId="subtasks"
              onMove={onReorderSubtasks}
              onRestore={(subtasks) => onUpdateTask({ subtasks })}
              surfaceId={`task-details-${task.id}`}
            >
              {({ collectionItemProps }) => (task.subtasks || []).map((subtask, index) => (
                <SortableCollectionItem
                  as="li"
                  className={subtask.complete ? "complete" : ""}
                  key={subtask.id}
                  {...collectionItemProps(subtask, index, { type: "subtask" })}
                  pointerActivationDistance={5}
                  pointerActivatorSelector=".subtask-reorder-handle"
                  aria-label={`Reorder subtask: ${subtask.title}`}
                >
                  {({ handleRef }) => <>
                  <button
                    ref={handleRef}
                    className="subtask-reorder-handle"
                    type="button"
                    aria-label={`Drag to reorder ${subtask.title}`}
                    title="Drag to reorder"
                  >
                    <DotsSixVertical size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={subtask.complete ? `Mark ${subtask.title} incomplete` : `Mark ${subtask.title} complete`}
                    onClick={() => onToggleSubtask(subtask.id)}
                  >
                    <CheckCircle size={16} weight={subtask.complete ? "fill" : "regular"} />
                  </button>
                  <InlineSubtaskTitleEditor
                    value={subtask.title}
                    onCommit={(title) => onUpdateSubtask(subtask.id, { title })}
                  />
                  <span className="task-details-subtask-times">
                    <InlineDurationEditor
                      allowEmpty
                      label={`${subtask.title} actual time`}
                      value={subtask.actualMinutes}
                      onCommit={(nextMinutes) => (
                        onUpdateSubtask(subtask.id, { actualMinutes: nextMinutes })
                      )}
                    />
                    <InlineDurationEditor
                      label={`${subtask.title} planned time`}
                      value={subtask.minutes}
                      onCommit={(nextMinutes) => (
                        onUpdateSubtask(subtask.id, { minutes: nextMinutes })
                      )}
                    />
                  </span>
                  </>}
                </SortableCollectionItem>
              ))}
            </SortableCollectionLane>

            {addingSubtask ? (
              <form
                aria-label="Add subtask"
                className="task-details-add-subtask-form"
                onBlur={(blurEvent) => {
                  const form = blurEvent.currentTarget;
                  requestAnimationFrame(() => {
                    if (form.contains(document.activeElement)) return;
                    if (!subtaskDraftRef.current.title.trim()) {
                      cancelSubtaskDraft();
                      return;
                    }
                    createSubtaskFromDraft({ continueAdding: false });
                  });
                }}
                onKeyDown={(keyboardEvent) => {
                  if (keyboardEvent.key !== "Escape") return;
                  keyboardEvent.preventDefault();
                  keyboardEvent.stopPropagation();
                  closeTaskDetails();
                }}
                onSubmit={submitSubtask}
              >
                <CheckCircle
                  aria-hidden="true"
                  className="task-details-subtask-draft-check"
                  size={16}
                />
                <input
                  ref={subtaskInputRef}
                  aria-label="New subtask title"
                  autoComplete="off"
                  placeholder="Type a subtask title"
                  value={subtaskTitle}
                  onChange={(changeEvent) => (
                    updateSubtaskDraft("title", changeEvent.target.value)
                  )}
                  onKeyDown={(keyboardEvent) => {
                    if (
                      keyboardEvent.key === "Enter"
                      && !keyboardEvent.nativeEvent.isComposing
                    ) {
                      submitSubtask(keyboardEvent);
                    }
                  }}
                />
                <span className="task-details-subtask-times task-details-subtask-draft-times">
                  <InlineDurationEditor
                    allowEmpty
                    label="New subtask actual time"
                    value={subtaskActualMinutes}
                    onCommit={(nextMinutes) => (
                      updateSubtaskDraft("actualMinutes", nextMinutes)
                    )}
                  />
                  <InlineDurationEditor
                    label="New subtask planned time"
                    value={subtaskMinutes}
                    onCommit={(nextMinutes) => (
                      updateSubtaskDraft("minutes", nextMinutes)
                    )}
                  />
                </span>
              </form>
            ) : null}
            <button
              className="task-details-add-subtask"
              type="button"
              onClick={startAddingSubtask}
            >
              <Plus size={19} /> Add subtask
            </button>
          </section>

          <section className="task-details-notes">
            <textarea maxLength={200000}
              aria-label="Task notes"
              placeholder="Add notes, context, or links…"
              value={task.notes || ""}
              onChange={(changeEvent) => onUpdateTask({ notes: changeEvent.target.value })}
            />
          </section>

          <TaskMedia key={task.id} media={task.media} onChange={(media) => onUpdateTask({ media })} dialogRef={dialogRef} />

          <section className="task-details-schedule-summary">
            <span className={`task-details-schedule-mark ${task.accent || "violet"}`}>
              <Clock size={18} weight="fill" />
            </span>
            <div>
              <strong>{event ? scheduledDateLabel : "Not on the calendar"}</strong>
              <span>
                {event
                  ? `${timeLabel(event.start)} – ${scheduleTimeLabel(event.end)}`
                  : "Choose a time when you are ready to commit"}
              </span>
              <small>{event ? `${minutesLabel(event.end - event.start)} planned` : `${minutesLabel(task.minutes)} estimated`}</small>
            </div>
            <button
              type="button"
              onClick={openScheduleEditor}
            >
              {event ? "Edit" : "Schedule"}
            </button>
          </section>

          {comments.length ? (
            <ol className="task-details-comments" aria-label="Comments">
              {comments.map((item) => (
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

          <form className="task-details-comment-form" onSubmit={submitComment}>
            <ProfileAvatar />
            <div>
              <input
                maxLength={200000}
                aria-label="Add a comment"
                placeholder="Add a comment…"
                value={comment}
                onChange={(changeEvent) => setComment(changeEvent.target.value)}
              />
              {attachmentName ? <span className="task-details-attachment-name">{attachmentName.name || attachmentName}</span> : null}
            </div>
            <AttachmentPicker onChange={setAttachmentName} />
            <button className="task-details-comment-submit" type="submit" disabled={!comment.trim() && !attachmentName}>
              Send
            </button>
          </form>

          <ol className="task-details-activity" aria-label="Task activity">
            {activity.map((item) => (
              <li key={item.id}>
                <span aria-hidden="true" />
                <p>{item.label} <time>· {item.time}</time></p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
