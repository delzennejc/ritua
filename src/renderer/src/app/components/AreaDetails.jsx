import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check,
  DotsThree,
  X,
} from "@phosphor-icons/react";
import { AREA_COLOR_OPTIONS } from "../data/areaColors";
import { CURRENT_DATE_KEY } from "../utils/dates";
import { minutesLabel } from "../utils/time";
import { weekDaysFrom } from "../utils/weeks";

const resolvedChannel = (channel) => channel;
const completedTimeLabel = (minutes) => minutes ? minutesLabel(minutes) : "0:00";

export function AreaDetails({
  area,
  backlogGroups = [],
  datedTasksByDate = {},
  onArchive,
  onClose,
  onColorChange,
  onDelete,
  onRename,
  returnFocusElement,
  tasks = [],
}) {
  const cancelTitleEditRef = useRef(false);
  const colorPickerButtonRef = useRef(null);
  const colorPickerOpenRef = useRef(false);
  const dialogRef = useRef(null);
  const deleteCancelButtonRef = useRef(null);
  const deleteConfirmOpenRef = useRef(false);
  const deleteMenuButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const moreOpenRef = useRef(false);
  const titleId = useId();
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(area.label);
  const selectedColorOption = AREA_COLOR_OPTIONS.find((colorOption) => (
    area.color.toLowerCase() === colorOption.color.toLowerCase()
  )) || AREA_COLOR_OPTIONS[0];
  const otherColorOptions = AREA_COLOR_OPTIONS.filter((colorOption) => (
    colorOption.id !== selectedColorOption.id
  ));
  const weekDays = useMemo(() => weekDaysFrom(CURRENT_DATE_KEY), []);
  const canonicalEntries = useMemo(() => {
    const seenTaskIds = new Set();
    return [
      ...Object.entries(datedTasksByDate).flatMap(([dateKey, dateTasks]) => (
        dateTasks.map((task) => ({ task, dateKey }))
      )),
      ...tasks.map((task) => ({ task, dateKey: CURRENT_DATE_KEY })),
      ...backlogGroups.flatMap((group) => group.items.map((task) => ({
        task,
        dateKey: null,
      }))),
    ].filter(({ task }) => {
      if (seenTaskIds.has(task.id)) return false;
      seenTaskIds.add(task.id);
      return resolvedChannel(task.channel) === area.label;
    });
  }, [area.label, backlogGroups, datedTasksByDate, tasks]);
  const completedMinutesByDate = useMemo(() => canonicalEntries.reduce((totals, {
    dateKey,
    task,
  }) => {
    if (!dateKey || !task.complete) return totals;
    const completedMinutes = Number.isFinite(task.actualMinutes)
      ? task.actualMinutes
      : Number.isFinite(task.minutes)
        ? task.minutes
        : 0;
    return {
      ...totals,
      [dateKey]: (totals[dateKey] || 0) + completedMinutes,
    };
  }, {}), [canonicalEntries]);
  const cancelDeleteConfirmation = () => {
    setDeleteConfirmOpen(false);
    requestAnimationFrame(() => deleteMenuButtonRef.current?.focus());
  };

  const commitTitle = () => {
    const nextLabel = titleDraft.trim();
    if (!nextLabel) {
      setTitleDraft(area.label);
      return;
    }
    if (onRename?.(nextLabel) === false) {
      setTitleDraft(area.label);
      return;
    }
    setTitleDraft(nextLabel);
  };

  useEffect(() => {
    setTitleDraft(area.label);
    setColorPickerOpen(false);
  }, [area.id, area.label]);

  useEffect(() => {
    colorPickerOpenRef.current = colorPickerOpen;
  }, [colorPickerOpen]);

  useEffect(() => {
    deleteConfirmOpenRef.current = deleteConfirmOpen;
  }, [deleteConfirmOpen]);

  useEffect(() => {
    moreOpenRef.current = moreOpen;
  }, [moreOpen]);

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    deleteCancelButtonRef.current?.focus();
  }, [deleteConfirmOpen]);

  useEffect(() => {
    const previousFocus = returnFocusElement || document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();

    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        if (deleteConfirmOpenRef.current) {
          cancelDeleteConfirmation();
          return;
        }
        if (moreOpenRef.current) {
          setMoreOpen(false);
          moreButtonRef.current?.focus();
          return;
        }
        if (colorPickerOpenRef.current) {
          setColorPickerOpen(false);
          colorPickerButtonRef.current?.focus();
          return;
        }
        onClose();
        return;
      }
      if (keyboardEvent.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      const areaTitle = Array.from(
        document.querySelectorAll("[data-area-title-id]"),
      ).find((element) => element.dataset.areaTitleId === area.id);
      const fallback = areaTitle
        || document.querySelector(".app-workspace button:not([disabled])");
      const returnTarget = previousFocus?.isConnected ? previousFocus : fallback;
      returnTarget?.focus?.();
    };
  }, [area.id, onClose, returnFocusElement]);

  return (
    <div
      className="task-details-backdrop objective-details-backdrop area-details-backdrop"
      onClick={(clickEvent) => {
        if (clickEvent.target !== clickEvent.currentTarget) return;
        commitTitle();
        onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="objective-details area-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 className="sr-only" id={titleId}>Area details for {area.label}</h2>
        <header className="objective-details-header area-details-header">
          <div className="task-details-actions objective-details-actions">
            <div className="task-details-more">
              <button
                ref={moreButtonRef}
                className="task-details-icon-action"
                type="button"
                aria-label="More area actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen((open) => {
                    const nextOpen = !open;
                    if (nextOpen) {
                      requestAnimationFrame(() => (
                        dialogRef.current
                          ?.querySelector(".objective-details-menu button")
                          ?.focus()
                      ));
                    }
                    return nextOpen;
                  });
                  setDeleteConfirmOpen(false);
                }}
              >
                <DotsThree size={21} weight="bold" />
              </button>
              {moreOpen ? (
                <div
                  className="task-details-menu objective-details-menu"
                  role="menu"
                  onKeyDown={(keyboardEvent) => {
                    const menuItems = Array.from(
                      keyboardEvent.currentTarget.querySelectorAll("button"),
                    );
                    const currentIndex = menuItems.indexOf(document.activeElement);
                    let nextIndex;
                    if (keyboardEvent.key === "ArrowDown") {
                      nextIndex = (currentIndex + 1) % menuItems.length;
                    } else if (keyboardEvent.key === "ArrowUp") {
                      nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
                    } else if (keyboardEvent.key === "Home") {
                      nextIndex = 0;
                    } else if (keyboardEvent.key === "End") {
                      nextIndex = menuItems.length - 1;
                    } else {
                      return;
                    }
                    keyboardEvent.preventDefault();
                    menuItems[nextIndex]?.focus();
                  }}
                >
                  {deleteConfirmOpen ? (
                    <div className="task-details-delete-confirmation">
                      <p>Delete this Area and all its Projects and Tasks?</p>
                      <button
                        ref={deleteCancelButtonRef}
                        type="button"
                        onClick={cancelDeleteConfirmation}
                      >
                        Cancel
                      </button>
                      <button
                        className="task-details-menu-danger"
                        type="button"
                        onClick={onDelete}
                      >
                        Delete Area
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={onArchive}
                      >
                        Archive Area
                      </button>
                      <button
                        ref={deleteMenuButtonRef}
                        className="task-details-menu-danger"
                        role="menuitem"
                        type="button"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        Delete Area
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <button
              className="task-details-icon-action"
              type="button"
              aria-label="Close area details"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="objective-details-content area-details-content">
          <section className="objective-details-primary area-details-primary">
            <div className="objective-details-kicker" style={{ color: area.color }}>
              <span>Area</span>
              <div
                className={`area-details-color-picker ${colorPickerOpen ? "open" : ""}`}
                style={{
                  "--area-color-options-width": `${(
                    otherColorOptions.length * 20
                  ) + (Math.max(0, otherColorOptions.length - 1) * 6)}px`,
                }}
                onBlur={(blurEvent) => {
                  if (blurEvent.currentTarget.contains(blurEvent.relatedTarget)) return;
                  setColorPickerOpen(false);
                }}
              >
                <button
                  ref={colorPickerButtonRef}
                  aria-label={`Current Area color: ${selectedColorOption.label}. Show color choices`}
                  aria-expanded={colorPickerOpen}
                  className="area-details-color-option area-details-current-color"
                  style={{ "--area-color-option": selectedColorOption.color }}
                  title="Change Area color"
                  type="button"
                  onClick={() => setColorPickerOpen((open) => !open)}
                >
                  <Check size={11} weight="bold" />
                </button>
                <div
                  aria-hidden={!colorPickerOpen}
                  className="area-details-color-options"
                >
                  {otherColorOptions.map((colorOption, colorIndex) => (
                    <button
                      aria-label={`Set Area color to ${colorOption.label}`}
                      className="area-details-color-option"
                      key={colorOption.id}
                      style={{
                        "--area-color-option": colorOption.color,
                        "--color-option-index": colorIndex,
                      }}
                      tabIndex={colorPickerOpen ? 0 : -1}
                      title={colorOption.label}
                      type="button"
                      onClick={() => {
                        onColorChange?.(colorOption);
                        setColorPickerOpen(false);
                        requestAnimationFrame(() => colorPickerButtonRef.current?.focus());
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="area-details-title-row">
              <input
                className="area-details-title-input"
                aria-label="Area name"
                value={titleDraft}
                onBlur={() => {
                  if (cancelTitleEditRef.current) {
                    cancelTitleEditRef.current = false;
                    setTitleDraft(area.label);
                    return;
                  }
                  commitTitle();
                }}
                onChange={(changeEvent) => setTitleDraft(changeEvent.target.value)}
                onKeyDown={(keyboardEvent) => {
                  if (keyboardEvent.key === "Enter") {
                    keyboardEvent.preventDefault();
                    keyboardEvent.currentTarget.blur();
                    return;
                  }
                  if (keyboardEvent.key !== "Escape") return;
                  keyboardEvent.preventDefault();
                  keyboardEvent.stopPropagation();
                  cancelTitleEditRef.current = true;
                  setTitleDraft(area.label);
                  keyboardEvent.currentTarget.blur();
                }}
              />
            </div>
          </section>

          <section className="objective-details-week area-details-week" aria-label="Area completed time by day">
            {weekDays.map((day) => {
              const completedMinutes = completedMinutesByDate[day.dateKey] || 0;
              return (
                <div className={completedMinutes ? "has-time" : ""} key={day.dateKey}>
                  <strong>{day.label}</strong>
                  <span className="objective-details-day-total">
                    {completedTimeLabel(completedMinutes)}
                  </span>
                </div>
              );
            })}
          </section>
        </div>
      </section>
    </div>
  );
}
