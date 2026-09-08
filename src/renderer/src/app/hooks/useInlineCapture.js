import { useEffect, useRef, useState } from "react";

export function useInlineCapture(onCreate) {
  const [isAdding, setIsAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [settlingItemId, setSettlingItemId] = useState(null);
  const inputRef = useRef(null);
  const isCommittingRef = useRef(false);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  useEffect(() => {
    if (!settlingItemId) return undefined;
    const timeoutId = window.setTimeout(() => setSettlingItemId(null), 360);
    return () => window.clearTimeout(timeoutId);
  }, [settlingItemId]);

  const startAdding = () => {
    isCommittingRef.current = false;
    setIsAdding(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const finishAdding = () => {
    if (isCommittingRef.current) return;
    isCommittingRef.current = true;
    const title = draftTitle.trim();
    const itemId = title ? onCreate(title) : null;
    setDraftTitle("");
    setIsAdding(false);
    if (itemId) setSettlingItemId(itemId);
  };

  const submit = (event) => {
    event.preventDefault();
    finishAdding();
  };

  const cancelAdding = () => {
    isCommittingRef.current = true;
    setIsAdding(false);
    setDraftTitle("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finishAdding();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdding();
    }
  };

  return {
    isAdding,
    cancelAdding,
    inputRef,
    draftTitle,
    finishAdding,
    handleKeyDown,
    setDraftTitle,
    settlingItemId,
    startAdding,
    submit,
  };
}
