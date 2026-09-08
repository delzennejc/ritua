import { createContext, useContext, useLayoutEffect } from "react";

const AutoScheduleContext = createContext(null);
export const useAutoSchedule = () => useContext(AutoScheduleContext);

// Capture before scheduling changes the card, the selected day, or the pane.
export function captureScheduleOrigin(source) {
  if (!source) return null;
  return {
    element: source,
    clone: source.cloneNode(true),
    rect: source.getBoundingClientRect(),
    hadFocus: source.contains(document.activeElement),
  };
}

function shredCalendarEvent(target, animate, finish) {
  const width = target.offsetWidth;
  const height = target.offsetHeight;
  const feedDelay = 90;
  const feedDuration = 520;
  const stripCount = Math.max(8, Math.min(16, Math.round(width / 12)));
  const shredder = document.createElement("div");
  shredder.className = "calendar-shredder";
  shredder.setAttribute("aria-hidden", "true");
  shredder.inert = true;
  Object.assign(shredder.style, {
    left: `${target.offsetLeft}px`, top: `${target.offsetTop}px`,
    width: `${width}px`, height: `${height}px`,
  });

  const copyPaper = () => {
    const paper = target.cloneNode(true);
    paper.removeAttribute("data-calendar-removal-id");
    paper.removeAttribute("id");
    paper.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    paper.classList.add("calendar-shredder-paper");
    Object.assign(paper.style, { left: "0", top: "0", width: `${width}px`, height: `${height}px` });
    return paper;
  };
  const input = document.createElement("div");
  input.className = "calendar-shredder-input";
  const paper = copyPaper();
  input.appendChild(paper);
  const output = document.createElement("div");
  output.className = "calendar-shredder-output";
  output.style.height = `${Math.min(height, 72) + 64}px`;
  const slot = document.createElement("div");
  slot.className = "calendar-shredder-slot";
  shredder.append(input, output, slot);
  target.parentElement.appendChild(shredder);

  // The original event is already unscheduled; only these inert paper copies move.
  animate(target, [{ opacity: 0 }, { opacity: 0 }], { duration: 1 });
  animate(paper, [
    { transform: "translateY(0)" },
    { transform: `translateY(${height}px)` },
  ], { duration: feedDuration, delay: feedDelay, easing: "linear" });
  animate(slot, [
    { opacity: 0, transform: "scaleX(.8)" },
    { opacity: 1, transform: "scaleX(1)" },
  ], { duration: feedDelay, easing: "ease-out" });

  let longestFall = 0;
  for (let index = 0; index < stripCount; index += 1) {
    const strip = document.createElement("div");
    strip.className = "calendar-shredder-strip";
    const left = index * width / stripCount;
    Object.assign(strip.style, {
      left: `${left}px`, top: `${-height}px`,
      width: `${width / stripCount - 2}px`, height: `${height}px`,
    });
    const stripPaper = copyPaper();
    stripPaper.style.left = `${-left}px`;
    strip.appendChild(stripPaper);
    output.appendChild(strip);
    const fallDuration = 230 + (index % 4) * 25;
    const duration = feedDuration + fallDuration;
    const sway = (index % 2 ? 1 : -1) * (3 + index % 3);
    longestFall = Math.max(longestFall, fallDuration);
    animate(strip, [
      { opacity: 1, transform: "translate3d(0, 0, 0) rotate(0deg)", easing: "linear" },
      { opacity: 1, transform: `translate3d(0, ${height}px, 0) rotate(0deg)`, offset: feedDuration / duration, easing: "cubic-bezier(.4, 0, 1, 1)" },
      { opacity: 0, transform: `translate3d(${sway}px, ${height + 48 + index % 3 * 7}px, 0) rotate(${sway}deg)` },
    ], { duration, delay: feedDelay });
  }
  const closing = animate(slot, [
    { opacity: 1, transform: "scaleX(1)" },
    { opacity: 0, transform: "scaleX(.85)" },
  ], { duration: 140, delay: feedDelay + feedDuration + longestFall - 60, easing: "ease-in", fill: "forwards" });
  closing.onfinish = finish;
  return shredder;
}

export function AutoScheduleAnimation({ request, onFinish, children }) {
  useLayoutEffect(() => {
    if (!request) return undefined;
    const animations = [];
    const origin = request.origin;
    const isUnscheduling = request.kind === "unschedule";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ghost;
    let shredder;
    let frame;
    let attempts = 0;
    let disposed = false;

    const finish = () => {
      if (origin?.hadFocus && document.activeElement === document.body) {
        const focusTarget = origin.element.isConnected
          ? origin.element.querySelector("[data-task-title-id]")
          : document.querySelector('.right-panel [role="tab"][aria-selected="true"]');
        focusTarget?.focus({ preventScroll: true });
      }
      if (!disposed) onFinish(request);
    };
    // A pane switch or background tab can cancel WAAPI's finish notification.
    const timeout = window.setTimeout(finish, 1600);
    const animate = (element, keyframes, options) => {
      const animation = element.animate(keyframes, { fill: "both", ...options });
      animations.push(animation);
      return animation;
    };

    if (origin && !reduceMotion && !isUnscheduling) {
      ghost = origin.clone.cloneNode(true);
      ghost.classList.add("auto-schedule-ghost");
      ghost.removeAttribute("data-task-layout-id");
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      Object.assign(ghost.style, {
        left: `${origin.rect.left}px`,
        top: `${origin.rect.top}px`,
        width: `${origin.rect.width}px`,
        height: `${origin.rect.height}px`,
      });
      document.body.appendChild(ghost);
    }

    const animateCalendar = () => {
      if (disposed) return;
      const target = document.querySelector(
        `.right-panel .timeline[data-date-key="${CSS.escape(request.dateKey)}"] [${isUnscheduling ? "data-calendar-removal-id" : "data-calendar-event-id"}="${CSS.escape(request.taskId)}"]`,
      );
      const viewport = target?.closest(".calendar-timeline-scroll");
      // Allow the pane's date update and layout to settle before measuring.
      if (++attempts < 3 || !target || !viewport || !target.getClientRects().length) {
        if (attempts < 30) frame = requestAnimationFrame(animateCalendar);
        else finish();
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const initialRect = target.getBoundingClientRect();
      const exitSpace = isUnscheduling && !reduceMotion ? Math.min(initialRect.height, 72) + 112 : 24;
      if (initialRect.top < viewportRect.top + 32 || initialRect.bottom > viewportRect.bottom - exitSpace) {
        viewport.scrollTop += initialRect.top - viewportRect.top - Math.max(32, (viewport.clientHeight - initialRect.height - exitSpace) / 2);
      }
      const targetRect = target.getBoundingClientRect();
      if (reduceMotion) {
        if (!isUnscheduling && origin?.hadFocus && !origin.element.isConnected) {
          target.querySelector("[role='button']")?.focus({ preventScroll: true });
        }
        finish();
        return;
      }

      if (isUnscheduling) {
        shredder = shredCalendarEvent(target, animate, finish);
        return;
      }

      const flightDuration = ghost ? 560 : 0;
      if (ghost) {
        const deltaX = targetRect.left + targetRect.width / 2 - (origin.rect.left + origin.rect.width / 2);
        const deltaY = targetRect.top + Math.min(targetRect.height, viewport.clientHeight - 32) / 2 - (origin.rect.top + origin.rect.height / 2);
        const scaleX = targetRect.width / origin.rect.width;
        const scaleY = Math.min(targetRect.height, 64) / origin.rect.height;
        animate(ghost, [
          { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, offset: 0 },
          { transform: `translate3d(${deltaX * .4}px, ${deltaY * .4 - 34}px, 0) scale(.92) rotate(-3deg)`, opacity: .95, offset: .45 },
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, opacity: 0, filter: "blur(3px)", offset: 1 },
        ], { duration: flightDuration, easing: "cubic-bezier(.4, 0, .2, 1)" });
        if (origin.element.isConnected) {
          animate(origin.element, [{ opacity: .18 }, { opacity: 1 }], {
            duration: flightDuration + 240,
            easing: "ease-out",
          });
        }
      }

      const arrival = animate(target, [
        { opacity: 0, transform: "scale(.88)", filter: "brightness(1.8)", boxShadow: "0 0 0 0 rgba(157, 131, 233, .5)" },
        { opacity: 1, transform: "scale(1.035)", filter: "brightness(1.15)", boxShadow: "0 0 0 8px rgba(157, 131, 233, .12)", offset: .55 },
        { opacity: 1, transform: "scale(1)", filter: "brightness(1)", boxShadow: "0 0 0 14px rgba(157, 131, 233, 0)" },
      ], { duration: 420, delay: flightDuration - Math.min(40, flightDuration), easing: "cubic-bezier(.22, 1, .36, 1)" });
      arrival.onfinish = () => {
        if (origin?.hadFocus && !origin.element.isConnected) {
          target.querySelector("[role='button']")?.focus({ preventScroll: true });
        }
        finish();
      };
    };

    frame = requestAnimationFrame(animateCalendar);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      animations.forEach((animation) => animation.cancel());
      shredder?.remove();
      ghost?.remove();
    };
  }, [request, onFinish]);

  return <AutoScheduleContext.Provider value={request}>{children}</AutoScheduleContext.Provider>;
}
