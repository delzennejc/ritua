import { AutoScroller, Scroller } from "@dnd-kit/dom";

const CALENDAR_APPROACH_BUFFER = 48;

export class CalendarAwareAutoScroller extends AutoScroller {
  constructor(manager, options) {
    super(manager, options);
    const scroller = manager.registry.plugins.get(Scroller);
    const getScrollableElements = scroller.getScrollableElements;

    scroller.getScrollableElements = () => {
      const elements = getScrollableElements();
      const { activatorEvent, position, source } = manager.dragOperation;
      const pointer = position?.current;
      if (!elements || !pointer || activatorEvent?.type.startsWith("key")) return elements;

      const calendar = source?.element?.ownerDocument.querySelector(".right-panel-calendar");
      const rect = calendar?.getBoundingClientRect();
      if (
        !rect?.width || !rect.height
        || pointer.x < rect.left - CALENDAR_APPROACH_BUFFER
        || pointer.x > rect.right
        || pointer.y < rect.top || pointer.y > rect.bottom
      ) return elements;

      // The library can retain the board's scroll ancestors after crossing into
      // the calendar. Filter them on every tick, including the approach zone.
      return new Set([...elements].filter((element) => !element.closest(
        '[data-board-scroll-container="true"]',
      )));
    };

    const destroy = this.destroy;
    this.destroy = () => {
      scroller.getScrollableElements = getScrollableElements;
      destroy();
    };
  }
}
