import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarBlank,
  CalendarDots,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  Check,
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedIds = selectedAreaIds || [];
  const allAreasSelected = selectedIds.length === 0;

  useDismissiblePopover(open, setOpen, containerRef, triggerRef);

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
    <div className="toolbar-control-wrap toolbar-filter-control" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`toolbar-trigger ${allAreasSelected ? "" : "active"}`.trim()}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={allAreasSelected ? "Filter by area" : `Filter by area, ${selectedIds.length} selected`}
        onClick={() => setOpen((current) => !current)}
      >
        <Funnel size={15} /> Filter
      </button>
      {open ? (
        <div className="toolbar-popover toolbar-filter-popover" role="menu" aria-label="Filter by area">
          <span className="toolbar-popover-title">Areas</span>
          <button
            className="toolbar-filter-option"
            type="button"
            role="menuitemcheckbox"
            aria-checked={allAreasSelected}
            onClick={() => onAreaFilterChange?.([])}
          >
            <span className="toolbar-filter-all-icon"><Funnel size={14} /></span>
            <span>All areas</span>
            {allAreasSelected ? <Check size={14} weight="bold" /> : null}
          </button>
          {areas.map((area) => {
            const selected = selectedIds.includes(area.id);
            return (
              <button
                className="toolbar-filter-option"
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                key={area.id}
                onClick={() => toggleArea(area.id)}
              >
                <FolderSimple size={15} weight="fill" style={{ color: area.color }} />
                <span>{area.label}</span>
                {selected ? <Check size={14} weight="bold" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
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
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const selectedLabels = selectedHorizons || [];
  const allHorizonsSelected = horizons.every((label) => selectedLabels.includes(label));

  useDismissiblePopover(open, setOpen, containerRef, triggerRef, popoverRef);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return undefined;
    }

    const updatePopoverPosition = () => {
      const triggerBounds = triggerRef.current?.getBoundingClientRect();
      if (!triggerBounds) return;

      const popoverWidth = 196;
      setPopoverPosition({
        top: triggerBounds.bottom + 7,
        left: Math.min(
          Math.max(8, triggerBounds.left),
          window.innerWidth - popoverWidth - 8,
        ),
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open]);

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
    <div className="toolbar-control-wrap toolbar-filter-control" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`toolbar-trigger ${allHorizonsSelected ? "" : "active"}`.trim()}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={allHorizonsSelected
          ? "Filter by horizon"
          : `Filter by horizon, ${selectedLabels.length} selected`}
        onClick={() => setOpen((current) => !current)}
      >
        <Funnel size={15} /> Filter
      </button>
      {open && popoverPosition ? createPortal(
        <div
          ref={popoverRef}
          className="toolbar-popover toolbar-filter-popover toolbar-popover-portal"
          style={popoverPosition}
          role="menu"
          aria-label="Filter by horizon"
        >
          <span className="toolbar-popover-title">Horizons</span>
          <button
            className="toolbar-filter-option"
            type="button"
            role="menuitemcheckbox"
            aria-checked={allHorizonsSelected}
            onClick={() => onHorizonFilterChange?.(horizons)}
          >
            <span className="toolbar-filter-all-icon"><Funnel size={14} /></span>
            <span>All horizons</span>
            {allHorizonsSelected ? <Check size={14} weight="bold" /> : null}
          </button>
          {horizons.map((label) => {
            const selected = !allHorizonsSelected && selectedLabels.includes(label);
            const HorizonIcon = HORIZON_FILTER_ICONS[label] || Stack;
            return (
              <button
                className="toolbar-filter-option"
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                key={label}
                onClick={() => toggleHorizon(label)}
              >
                <HorizonIcon size={15} />
                <span>{label}</span>
                {selected ? <Check size={14} weight="bold" /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
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
