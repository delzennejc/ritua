import { useEffect, useRef } from "react";

export function UndoSnackbar({
  duration = 5000,
  message,
  notificationId,
  onDismiss,
  onUndo,
}) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDismissRef.current?.();
    }, duration);

    return () => window.clearTimeout(timeoutId);
  }, [duration, notificationId]);

  return (
    <div
      className="undo-snackbar"
      role="status"
      aria-atomic="true"
      data-duration-ms={duration}
      style={{ "--undo-snackbar-duration": `${duration}ms` }}
    >
      <span className="undo-snackbar-message">{message}</span>
      <button
        className="undo-snackbar-action"
        type="button"
        onClick={onUndo}
      >
        Undo
      </button>
      <span className="undo-snackbar-progress" aria-hidden="true">
        <span className="undo-snackbar-progress-fill" />
      </span>
    </div>
  );
}
