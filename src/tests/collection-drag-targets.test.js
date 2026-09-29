import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectionTargetFromLane,
  collectionDragTarget,
  verticalCollectionTargetAtThreshold,
} from '../renderer/src/app/interactions/drag-targets'

test('collection headers and gaps remain valid drop targets without requiring the pointer inside a card', () => {
  const lane = {
    dataset: { collectionId: 'daily-review', collectionLaneId: 'done', collectionSurfaceId: 'daily-review' },
    querySelectorAll: () => cards,
  }
  const cards = [100, 200].map((top, index) => ({
    dataset: { collectionIndex: String(index), collectionItemId: `task-${index}` },
    closest: () => lane,
    getBoundingClientRect: () => ({ top, bottom: top + 60 }),
  }))
  for (const [y, index] of [
    [80, 0],
    [180, 1],
    [280, 2],
  ]) {
    const target = collectionTargetFromLane(lane, { x: 10, y })
    assert.equal(target.element, lane)
    assert.equal(target.data.kind, 'collection-lane')
    assert.equal(target.data.insertionIndex, index)
  }
  assert.equal(collectionTargetFromLane(lane, { x: 10, y: 120 }).data.itemId, 'task-0')
})

test('vertical reorder cannot block a pointer that has left for the next stacked lane', (t) => {
  const lane = {
    dataset: { collectionId: 'daily-review', collectionLaneId: 'todo', collectionSurfaceId: 'daily-review' },
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    querySelectorAll: () => [],
  }
  t.mock.property(globalThis, 'document', { querySelectorAll: () => [lane] })
  const source = {
    kind: 'collection-item',
    collectionId: 'daily-review',
    surfaceId: 'daily-review',
    sourceLaneId: 'todo',
    itemId: 'task',
  }
  const session = { sourceRect: {}, grabOffset: {}, verticalDirection: 1 }
  assert.equal(verticalCollectionTargetAtThreshold({ x: 50, y: 140 }, source, session), null)
})

test('keyboard collection targets bypass pointer geometry', () => {
  assert.deepEqual(collectionDragTarget({ activatorEvent: { type: 'keydown' } }, null, {}, null), {
    targetOverride: null,
  })
})
