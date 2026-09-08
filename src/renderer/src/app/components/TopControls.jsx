import { useEffect, useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import {
  Archive,
  CalendarBlank,
  CalendarDots,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  FolderSimple,
  Funnel,
  SidebarSimple,
  Stack,
} from "@phosphor-icons/react";
import { CURRENT_DATE_KEY, dateFromKey, addDays } from "../utils/dates";

function useDismissiblePopover(open, setOpen, containerRef, triggerRef, popoverRef = null) {
  useEffect(() => {
    if (!open) return undefined;

    const dismissFromPointer = (event) => {
      if (
        !containerRef.current?.contains(event.target)
        && !popoverRef?.current?.contains(event.target)
      ) setOpen(false);
    };
    const dismissFromKeyboard = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", dismissFromPointer);
    document.addEventListener("keydown", dismissFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissFromPointer);
      document.removeEventListener("keydown", dismissFromKeyboard);
    };
  }, [containerRef, open, popoverRef, setOpen, triggerRef]);
}

function toolbarDateLabel(dateKey, fallbackLabel) {
  if (!dateKey) return fallbackLabel;
  if (dateKey === CURRENT_DATE_KEY) return "Today";
  return dateFromKey(dateKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function DateControl({
  dateKey,
  dateLabel = "Today",
  displayLabel,
  availableDateKeys = [],
  onDateChange,
  align = "start",
  className = "",
  showAdjacentControls = false,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dateInputRef = useRef(null);
  const interactive = Boolean(onDateChange && dateKey && availableDateKeys.length);
  const previousDateKey = dateKey ? addDays(dateKey, -1) : null;
  const nextDateKey = dateKey ? addDays(dateKey, 1) : null;

  useDismissiblePopover(open, setOpen, containerRef, triggerRef);

  useEffect(() => {
    if (open) requestAnimationFrame(() => dateInputRef.current?.focus());
  }, [open]);

  const chooseDate = (nextDateKeyValue) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDateKeyValue)) return;
    onDateChange?.(nextDateKeyValue);
  };

  if (!interactive) {
    return (
      <span className={`toolbar-trigger toolbar-date-static ${className}`.trim()}>
        <CalendarBlank size={15} /> {dateLabel}
      </span>
    );
  }

  return (
    <div
      className={`toolbar-control-wrap toolbar-date-control${showAdjacentControls ? " with-adjacent-controls" : ""} ${className}`.trim()}
      ref={containerRef}
    >
      {showAdjacentControls ? (
        <button
          className="toolbar-date-step"
          type="button"
          aria-label="Previous day"
          disabled={!previousDateKey}
          onClick={() => chooseDate(previousDateKey)}
        >
          <CaretLeft size={15} />
        </button>
      ) : null}
      <button
        ref={triggerRef}
        className="toolbar-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarBlank size={15} /> {displayLabel || toolbarDateLabel(dateKey, dateLabel)}
      </button>
      {showAdjacentControls ? (
        <button
          className="toolbar-date-step"
          type="button"
          aria-label="Next day"
          disabled={!nextDateKey}
          onClick={() => chooseDate(nextDateKey)}
        >
          <CaretRight size={15} />
        </button>
      ) : null}
      {open ? (
        <div
          className={`toolbar-popover date-control-popover align-${align}`}
          role="dialog"
          aria-label="Choose a date"
        >
          <div className="date-control-heading">
            <strong>{dateFromKey(dateKey).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}</strong>
            <div className="date-control-stepper">
              <button
                type="button"
                aria-label="Previous day"
                disabled={!previousDateKey}
                onClick={() => chooseDate(previousDateKey)}
              >
                <CaretLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="Next day"
                disabled={!nextDateKey}
                onClick={() => chooseDate(nextDateKey)}
              >
                <CaretRight size={15} />
              </button>
            </div>
          </div>
          <label className="date-control-input">
            <span>Date</span>
            <input
              ref={dateInputRef}
              type="date"
              value={dateKey}
              onChange={(event) => chooseDate(event.target.value)}
            />
          </label>
          <button
            className="date-control-today"
            type="button"
            disabled={dateKey === CURRENT_DATE_KEY}
            onClick={() => chooseDate(CURRENT_DATE_KEY)}
          >
            Go to Today
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AreaFilterControl({ areas, selectedAreaIds, onAreaFilterChange }) {
  const selectedIds = selectedAreaIds || [];
  const allAreasSelected = selectedIds.length === 0;

  const toggleArea = (areaId) => {
    if (allAreasSelected) {
      onAreaFilterChange?.([areaId]);
      return;
    }

    const nextIds = selectedIds.includes(areaId)
      ? selectedIds.filter((id) => id !== areaId)
      : [...selectedIds, areaId];
    onAreaFilterChange?.(nextIds.length === areas.length ? [] : nextIds);
  };

  return (
    <Dropdown
      className="toolbar-filter-control"
      triggerClassName={`toolbar-trigger ${allAreasSelected ? "" : "active"}`.trim()}
      label={allAreasSelected ? "Filter by area" : `Filter by area, ${selectedIds.length} selected`}
      title="Areas"
      trigger={<><Funnel size={15} /> Filter</>}
      items={[
        { id: "all", label: "All areas", icon: <Funnel size={14} />, role: "menuitemcheckbox", checked: allAreasSelected, onSelect: () => onAreaFilterChange?.([]) },
        ...areas.map((area) => ({
          id: area.id, label: area.label,
          icon: <FolderSimple size={15} weight="fill" style={{ color: area.color }} />,
          role: "menuitemcheckbox", checked: selectedIds.includes(area.id),
          onSelect: () => toggleArea(area.id),
        })),
      ]}
    />
  );
}

const HORIZON_FILTER_ICONS = {
  Anytime: Stack,
  Scheduled: CalendarBlank,
  Someday: Archive,
};

export function HorizonFilterControl({
  horizons,
  selectedHorizons,
  onHorizonFilterChange,
}) {
  const selectedLabels = selectedHorizons || [];
  const allHorizonsSelected = horizons.every((label) => selectedLabels.includes(label));

  const toggleHorizon = (label) => {
    if (allHorizonsSelected) {
      onHorizonFilterChange?.([label]);
      return;
    }

    if (!selectedLabels.includes(label)) {
      onHorizonFilterChange?.(horizons.filter((candidate) => (
        selectedLabels.includes(candidate) || candidate === label
      )));
      return;
    }

    if (selectedLabels.length === 1) return;
    onHorizonFilterChange?.(selectedLabels.filter((candidate) => candidate !== label));
  };

  return (
    <Dropdown
      className="toolbar-filter-control"
      triggerClassName={`toolbar-trigger ${allHorizonsSelected ? "" : "active"}`.trim()}
      label={allHorizonsSelected ? "Filter by horizon" : `Filter by horizon, ${selectedLabels.length} selected`}
      title="Horizons"
      trigger={<><Funnel size={15} /> Filter</>}
      items={[
        { id: "all", label: "All horizons", icon: <Funnel size={14} />, role: "menuitemcheckbox", checked: allHorizonsSelected, onSelect: () => onHorizonFilterChange?.(horizons) },
        ...horizons.map((label) => {
          const Icon = HORIZON_FILTER_ICONS[label] || Stack;
          return {
            id: label, label, icon: <Icon size={15} />, role: "menuitemcheckbox",
            checked: !allHorizonsSelected && selectedLabels.includes(label),
            onSelect: () => toggleHorizon(label),
          };
        }),
      ]}
    />
  );
}

export function NavigationToggle({ navigationOpen, onToggleNavigation }) {
  return (
    <button
      className="navigation-toggle"
      type="button"
      aria-label={navigationOpen ? "Collapse navigation" : "Expand navigation"}
      aria-controls="primary-navigation"
      aria-expanded={navigationOpen}
      onClick={onToggleNavigation}
    >
      {navigationOpen ? <CaretDoubleLeft size={15} /> : <CaretDoubleRight size={15} />}
    </button>
  );
}

export function RightPanelToggle({ rightPanelOpen, onToggleRightPanel }) {
  return (
    <button
      className="right-panel-toggle"
      type="button"
      aria-label={rightPanelOpen ? "Close right panel" : "Open right panel"}
      aria-controls="right-panel"
      aria-expanded={rightPanelOpen}
      onClick={onToggleRightPanel}
    >
      {rightPanelOpen ? <CaretDoubleRight size={15} /> : <CaretDoubleLeft size={15} />}
    </button>
  );
}

export function TopControls({
  showDate = true,
  dateKey,
  dateLabel = "Today",
  availableDateKeys,
  onDateChange,
  areas,
  selectedAreaIds,
  onAreaFilterChange,
  viewMode,
  onViewModeChange,
  dateDisplayLabel,
}) {
  const hasAreaFilter = Boolean(areas?.length && onAreaFilterChange);
  const hasViewSwitch = Boolean(viewMode && onViewModeChange);
  const showingWeekCalendar = viewMode === "week-calendar";
  const ViewIcon = showingWeekCalendar ? SidebarSimple : CalendarDots;
  const viewLabel = showingWeekCalendar ? "Board" : "Week calendar";

  return (
    <div className="top-controls">
      {showDate ? (
        <DateControl
          dateKey={dateKey}
          dateLabel={dateLabel}
          displayLabel={dateDisplayLabel}
          availableDateKeys={availableDateKeys}
          onDateChange={onDateChange}
        />
      ) : null}
      {hasAreaFilter ? (
        <AreaFilterControl
          areas={areas}
          selectedAreaIds={selectedAreaIds}
          onAreaFilterChange={onAreaFilterChange}
        />
      ) : (
        <span className="toolbar-trigger toolbar-filter-static"><Funnel size={15} /> Filter</span>
      )}
      {hasViewSwitch ? (
        <button
          className="toolbar-trigger toolbar-view-switch"
          type="button"
          aria-label={`Show ${viewLabel.toLowerCase()} view`}
          onClick={() => onViewModeChange(showingWeekCalendar ? "board" : "week-calendar")}
        >
          <ViewIcon size={15} /> {viewLabel}
        </button>
      ) : null}
    </div>
  );
}
