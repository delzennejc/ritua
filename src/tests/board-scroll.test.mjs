import assert from "node:assert/strict";
import test from "node:test";
import { lockBoardScrollAxis } from "../renderer/src/app/utils/boardScroll.js";

function board() {
  const element = Object.assign(new EventTarget(), {
    scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 600,
  });
  const cleanup = lockBoardScrollAxis(element);
  const wheel = (deltaX, deltaY, timeStamp, options = {}) => {
    const event = new Event("wheel", { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({
      deltaX, deltaY, timeStamp, deltaMode: 0, shiftKey: false, ctrlKey: false, ...options,
    }).map(([key, value]) => [key, { value }])));
    element.dispatchEvent(event);
    return event;
  };
  return { element, wheel, cleanup };
}

test("diagonal gestures stay on one axis through momentum, then can change direction", () => {
  const { element, wheel, cleanup } = board();
  assert.equal(wheel(40, 15, 0).defaultPrevented, true);
  wheel(8, 25, 20);
  wheel(2, 10, 70);
  assert.deepEqual([element.scrollLeft, element.scrollTop], [50, 0]);
  wheel(10, 30, 400);
  wheel(20, 5, 430);
  assert.deepEqual([element.scrollLeft, element.scrollTop], [50, 35]);
  cleanup();
  assert.equal(wheel(50, 50, 700).defaultPrevented, false);
});

test("Shift-wheel and line/page wheel units retain their expected direction and distance", () => {
  const { element, wheel, cleanup } = board();
  wheel(0, 3, 0, { shiftKey: true, deltaMode: 1 });
  assert.deepEqual([element.scrollLeft, element.scrollTop], [48, 0]);
  wheel(0, 1, 300, { deltaMode: 2 });
  assert.deepEqual([element.scrollLeft, element.scrollTop], [48, 600]);
  cleanup();
});

test("pinch zoom does not scroll or choose the next gesture's axis", () => {
  const { element, wheel, cleanup } = board();
  assert.equal(wheel(0, 50, 0, { ctrlKey: true }).defaultPrevented, false);
  wheel(30, 5, 20);
  assert.deepEqual([element.scrollLeft, element.scrollTop], [30, 0]);
  cleanup();
});
