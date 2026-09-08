import { useEffect, useRef, useState } from "react";
import { CALENDAR_DAY_MINUTES, CALENDAR_HOUR_HEIGHT, CALENDAR_SNAP_MINUTES, snapCalendarMinutes } from "../utils/calendar";
import { timeLabel } from "../utils/time";

const clampMinute = (minute) => Math.max(0, Math.min(CALENDAR_DAY_MINUTES - 1, minute));

export function ShutdownMarker({ event, setEvents, timelineScrollRef, positionForMinutes }) {
  const dragRef = useRef(null);
  const [previewMinute, setPreviewMinute] = useState(null);
  const minute = previewMinute ?? event.start;

  const saveMinute = (start) => setEvents?.((items) => items.map((item) => (
    item.id === event.id && item.dateKey === event.dateKey
      ? { ...item, start, end: start }
      : item
  )));

  const updatePreview = () => {
    const drag = dragRef.current;
    if (!drag?.moved) return;
    const scrollDelta = (timelineScrollRef.current?.scrollTop || 0) - drag.scrollTop;
    drag.minute = clampMinute(snapCalendarMinutes(
      drag.start + ((drag.y - drag.initialY + scrollDelta) / CALENDAR_HOUR_HEIGHT) * 60,
    ));
    setPreviewMinute(drag.minute);
  };

  const finishDrag = (commit) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPreviewMinute(null);
    if (drag?.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
    if (commit && drag?.moved) saveMinute(drag.minute);
  };

  useEffect(() => {
    if (previewMinute === null) return undefined;
    let frame;
    const scrollAtEdge = () => {
      const drag = dragRef.current;
      const scroller = timelineScrollRef.current;
      if (!drag || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const edge = 36;
      const delta = drag.y < bounds.top + edge
        ? -Math.min(8, (bounds.top + edge - drag.y) / 4)
        : drag.y > bounds.bottom - edge
          ? Math.min(8, (drag.y - bounds.bottom + edge) / 4)
          : 0;
      if (delta) scroller.scrollTop += delta;
      updatePreview();
      frame = requestAnimationFrame(scrollAtEdge);
    };
    const cancelOnEscape = (keyboardEvent) => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      finishDrag(false);
    };
    frame = requestAnimationFrame(scrollAtEdge);
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", cancelOnEscape, true);
    };
  }, [previewMinute !== null, timelineScrollRef]);

  return (
    <div
      className={`calendar-shutdown-marker${previewMinute !== null ? " dragging" : ""}${minute > CALENDAR_DAY_MINUTES - 30 ? " at-day-end" : ""}`}
      style={{ top: positionForMinutes(minute) }}
      role="slider"
      tabIndex={0}
      aria-label="Shutdown time"
      aria-valuemin={0}
      aria-valuemax={CALENDAR_DAY_MINUTES - 1}
      aria-valuenow={minute}
      aria-valuetext={timeLabel(minute)}
      aria-orientation="vertical"
      title="Drag to change shutdown time. Tasks can be scheduled after it."
      onPointerDown={(pointerEvent) => {
        if (pointerEvent.button !== 0 || dragRef.current) return;
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        const element = pointerEvent.currentTarget;
        element.focus({ preventScroll: true });
        element.setPointerCapture(pointerEvent.pointerId);
        dragRef.current = {
          element,
          pointerId: pointerEvent.pointerId,
          initialY: pointerEvent.clientY,
          y: pointerEvent.clientY,
          start: event.start,
          minute: event.start,
          scrollTop: timelineScrollRef.current?.scrollTop || 0,
          moved: false,
        };
      }}
      onPointerMove={(pointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
        pointerEvent.stopPropagation();
        drag.y = pointerEvent.clientY;
        if (Math.abs(drag.y - drag.initialY) >= 5) drag.moved = true;
        updatePreview();
      }}
      onPointerUp={(pointerEvent) => {
        if (dragRef.current?.pointerId !== pointerEvent.pointerId) return;
        pointerEvent.stopPropagation();
        dragRef.current.y = pointerEvent.clientY;
        updatePreview();
        finishDrag(true);
      }}
      onPointerCancel={() => finishDrag(false)}
      onLostPointerCapture={() => finishDrag(false)}
      onClick={(pointerEvent) => pointerEvent.stopPropagation()}
      onKeyDown={(keyboardEvent) => {
        if (dragRef.current) return;
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(keyboardEvent.key)) return;
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        const next = keyboardEvent.key === "Home" ? 0
          : keyboardEvent.key === "End" ? CALENDAR_DAY_MINUTES - 1
            : event.start + (keyboardEvent.key === "ArrowDown" ? 1 : -1) * CALENDAR_SNAP_MINUTES;
        saveMinute(clampMinute(next));
      }}
    >
      <span>Shutdown time <time>{timeLabel(minute)}</time></span>
    </div>
  );
}
