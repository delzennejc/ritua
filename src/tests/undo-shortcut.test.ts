import assert from 'node:assert/strict'
import test from 'node:test'
import { isEditableTarget, isUndoShortcut } from '../renderer/src/app/utils/undo-shortcut'

const key = (overrides: Record<string, unknown> = {}) => ({
  key: 'z',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...overrides,
})

test('Cmd+Z and Ctrl+Z match while Redo and modified keys do not', () => {
  assert.equal(isUndoShortcut(key({ metaKey: true })), true)
  assert.equal(isUndoShortcut(key({ ctrlKey: true })), true)
  assert.equal(isUndoShortcut(key({ metaKey: true, key: 'Z' })), true)
  assert.equal(isUndoShortcut(key({ metaKey: true, shiftKey: true })), false)
  assert.equal(isUndoShortcut(key({ metaKey: true, altKey: true })), false)
  assert.equal(isUndoShortcut(key({ metaKey: true, key: 'x' })), false)
  assert.equal(isUndoShortcut(key()), false)
  assert.equal(isUndoShortcut(key({ metaKey: true, repeat: true })), false)
  assert.equal(isUndoShortcut(key({ metaKey: true, isComposing: true })), false)
  assert.equal(isUndoShortcut(key({ metaKey: true, defaultPrevented: true })), false)
})

test('fields and editors keep native Undo instead of the app Undo', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: false }), false)
  assert.equal(isEditableTarget(null), false)
  assert.equal(isEditableTarget(undefined), false)
})
