const GESTURE_IDLE_MS = 180;

export function lockBoardScrollAxis(element) {
  let axis = null;
  let lastWheelTime = -Infinity;

  const onWheel = (event) => {
    // Preserve pinch-to-zoom and native editing controls.
    if (event.ctrlKey || !event.cancelable || event.defaultPrevented
      || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;

    const deltaX = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    const deltaY = event.shiftKey ? 0 : event.deltaY;
    if (!deltaX && !deltaY) return;

    if (event.timeStamp - lastWheelTime > GESTURE_IDLE_MS) axis = null;
    lastWheelTime = event.timeStamp;
    axis ??= Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";

    // A non-passive listener is needed to suppress the other native scroll axis.
    // Keep the lock through momentum and release it when the gesture goes idle.
    event.preventDefault();
    const pageSize = axis === "x" ? element.clientWidth : element.clientHeight;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;
    if (axis === "x") element.scrollLeft += deltaX * scale;
    else element.scrollTop += deltaY * scale;
  };

  element.addEventListener("wheel", onWheel, { passive: false });
  return () => element.removeEventListener("wheel", onWheel);
}
