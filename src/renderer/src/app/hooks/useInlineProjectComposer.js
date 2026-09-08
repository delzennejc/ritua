import { useInlineCapture } from "./useInlineCapture";

export function useInlineProjectComposer(onAddObjective) {
  const capture = useInlineCapture(onAddObjective);
  return {
    addingObjective: capture.isAdding,
    cancelAdding: capture.cancelAdding,
    draftInputRef: capture.inputRef,
    draftTitle: capture.draftTitle,
    finishAdding: capture.finishAdding,
    setDraftTitle: capture.setDraftTitle,
    settlingObjectiveId: capture.settlingItemId,
    startAdding: capture.startAdding,
    submitObjective: capture.submit,
  };
}
