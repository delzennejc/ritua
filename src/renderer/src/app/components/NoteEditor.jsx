import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Code,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Quotes,
  TextB,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
} from '@phosphor-icons/react'
import {
  activeNoteFormats,
  applyLink,
  applySlashCommand,
  checkboxOffsetAt,
  continueList,
  filterSlashCommands,
  indentList,
  noteReadingLines,
  openableHrefAt,
  openableNoteHref,
  slashCandidate,
  splitTokensAt,
  toggleBlock,
  toggleCheckbox,
  toggleInline,
  tokenizeNote,
  NOTE_INLINE_MARKERS,
} from './note-editor/markdown'
import { registerNoteFlush } from '../../desktop/pending-note-edits'
import { reportActionError } from '../../desktop/ActionErrors'
import { useStore } from 'zustand'
import { workspaceStore } from '../../desktop/workspace-store'

const SAVE_DELAY = 320
const SAVED_VISIBLE = 1600
const TOGGLE_ANIMATION = 520
const MOD_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl+'

const INLINE_CONTROLS = [
  {
    id: 'bold',
    kind: 'note-md-strong',
    marker: NOTE_INLINE_MARKERS.bold,
    label: 'Bold',
    shortcut: 'B',
    icon: TextB,
  },
  {
    id: 'italic',
    kind: 'note-md-em',
    marker: NOTE_INLINE_MARKERS.italic,
    label: 'Italic',
    shortcut: 'I',
    icon: TextItalic,
  },
  {
    id: 'strike',
    kind: 'note-md-strike',
    marker: NOTE_INLINE_MARKERS.strike,
    label: 'Strikethrough',
    shortcut: '⇧X',
    icon: TextStrikethrough,
  },
  {
    id: 'code',
    kind: 'note-md-code',
    marker: NOTE_INLINE_MARKERS.code,
    label: 'Code',
    shortcut: 'E',
    icon: Code,
  },
]

const BLOCK_CONTROLS = [
  { id: 'heading', kind: 'heading', label: 'Heading', icon: TextHTwo },
  { id: 'bullet', kind: 'bullet', label: 'Bullet list', icon: ListBullets },
  { id: 'task', kind: 'task', label: 'To-do list', icon: ListChecks },
  { id: 'quote', kind: 'quote', label: 'Quote', icon: Quotes },
]

const SLASH_ICONS = {
  heading: TextHTwo,
  bullet: ListBullets,
  ordered: ListNumbers,
  task: ListChecks,
  quote: Quotes,
  divider: Minus,
}

const tracksInsideLine = (offset, lineStart, lineEnd) =>
  offset > lineStart && (lineEnd === -1 || offset < lineEnd)

const floatingKey = (request) =>
  request.kind === 'slash'
    ? `slash:${request.index}`
    : request.kind === 'link'
      ? 'link'
      : `toolbar:${request.start}:${request.end}`

const tokenCache = (() => {
  let source = null
  let tokens = []
  return (text) => {
    if (text !== source) {
      source = text
      tokens = tokenizeNote(text)
    }
    return tokens
  }
})()

/**
 * Notes editor.
 *
 * The native textarea owns typing, selection, IME, spellcheck and undo. A paint
 * layer behind it renders the same characters with the same metrics, so the
 * stored note is never rewritten by formatting — only the visible styling
 * changes. Formatting controls edit markdown markers around the selection.
 */
export function NoteEditor({
  autoFocus = false,
  className = '',
  label = 'Notes',
  maxLength = 200000,
  onChange,
  placeholder = 'Add notes, context, or links…',
  value = '',
}) {
  const inputRef = useRef(null)
  const surfaceRef = useRef(null)
  const paintRef = useRef(null)
  const boxesRef = useRef(null)
  const anchorRef = useRef(null)
  const floatingRef = useRef(null)
  const requestRef = useRef(null)
  const dismissedRef = useRef(null)
  const pendingFocusRef = useRef(null)
  const silentEditRef = useRef(false)
  const awaitingRevisionRef = useRef(0)
  const awaitTimerRef = useRef(null)
  const textRef = useRef(value)
  const emittedRef = useRef(value)
  const pendingRef = useRef(null)
  const savedTimerRef = useRef(null)
  const toggleTimerRef = useRef(null)
  const linkRangeRef = useRef({ start: 0, end: 0 })
  const linkInputRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const hintId = useId()
  const slashMenuId = useId()
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  const [caretAnchor, setCaretAnchor] = useState(null)
  const [floating, setFloating] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [toggledOffset, setToggledOffset] = useState(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [boxes, setBoxes] = useState([])
  const revision = useStore(workspaceStore, (state) => state.document?.revision ?? 0)
  const saveError = useStore(workspaceStore, (state) => state.error)
  onChangeRef.current = onChange

  const rememberText = useCallback((next) => {
    textRef.current = next
    setText(next)
  }, [])

  const autoGrow = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [])

  /** Only the focused textarea gets an explicit height; the clean view sizes itself. */
  const syncHeight = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    if (focused) autoGrow()
    else input.style.height = ''
  }, [autoGrow, focused])

  const syncPaintScroll = useCallback(() => {
    const input = inputRef.current
    const offset = input ? -input.scrollTop : 0
    for (const layer of [paintRef.current, boxesRef.current])
      if (layer) layer.style.transform = `translateY(${offset}px)`
  }, [])

  /** Checkbox positions are measured from the paint layer, then drawn above the textarea. */
  const measureBoxes = useCallback(() => {
    const paint = paintRef.current
    if (!paint) return
    const nodes = paint.querySelectorAll('[data-check-offset]')
    if (!nodes.length) {
      setBoxes((current) => (current.length ? [] : current))
      return
    }
    const paintRect = paint.getBoundingClientRect()
    const next = Array.from(nodes).map((node) => {
      const rect = node.getBoundingClientRect()
      const offset = Number(node.dataset.checkOffset)
      const width = 19
      const height = 21
      return {
        offset,
        checked: node.classList.contains('note-md-box-checked'),
        left: rect.left - paintRect.left + rect.width / 2 - width / 2,
        top: rect.top - paintRect.top + rect.height / 2 - height / 2,
        width,
        height,
      }
    })
    setBoxes((current) => {
      if (
        current.length === next.length &&
        current.every(
          (box, index) =>
            box.offset === next[index].offset &&
            box.checked === next[index].checked &&
            Math.abs(box.left - next[index].left) < 0.5 &&
            Math.abs(box.top - next[index].top) < 0.5 &&
            Math.abs(box.width - next[index].width) < 0.5 &&
            Math.abs(box.height - next[index].height) < 0.5,
        )
      )
        return current
      return next
    })
  }, [])

  const closeFloating = useCallback(() => {
    requestRef.current = null
    setCaretAnchor(null)
    setFloating(null)
  }, [])

  /** Escape must stick until the trigger changes, not until the next keyup. */
  const dismissFloating = useCallback(() => {
    const request = requestRef.current
    if (request) dismissedRef.current = floatingKey(request)
    const input = inputRef.current
    if (!input) return
    // A cancelled popover can leave a selection behind; keep the toolbar from
    // re-arming on the focus that follows.
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? start
    if (start !== end) dismissedRef.current = floatingKey({ kind: 'toolbar', start, end })
    else {
      const slash = slashCandidate(input.value, start)
      if (slash) dismissedRef.current = floatingKey({ kind: 'slash', index: slash.index })
    }
    closeFloating()
  }, [closeFloating])

  const flush = useCallback((silent = false) => {
    const pending = pendingRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingRef.current = null
    emittedRef.current = pending.value
    try {
      onChangeRef.current?.(pending.value)
    } catch {
      // The workspace already surfaced the rejected edit; keep the note as typed.
      if (!silent) setSaveState('idle')
      return
    }
    if (silent) return
    awaitingRevisionRef.current = workspaceStore.getState().document?.revision ?? 0
    clearTimeout(savedTimerRef.current)
    setSaveState('awaiting')
    clearTimeout(awaitTimerRef.current)
    awaitTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
  }, [])

  const scheduleEmit = useCallback(
    (next) => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer)
      else {
        // A new edit cycle cancels any pending "saved/idle" fade from the last one.
        clearTimeout(savedTimerRef.current)
        clearTimeout(awaitTimerRef.current)
        setSaveState('saving')
      }
      pendingRef.current = { value: next, timer: setTimeout(() => flush(), SAVE_DELAY) }
    },
    [flush],
  )

  /** Places the floating control under the measured caret anchor. */
  const commitFloating = useCallback(() => {
    const request = requestRef.current
    if (!request) {
      setFloating((current) => (current ? null : current))
      return
    }
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!anchor || !surface) return
    const element = floatingRef.current
    const elementWidth =
      element?.offsetWidth || (request.kind === 'slash' ? 224 : request.kind === 'link' ? 272 : 308)
    const elementHeight = element?.offsetHeight || 36
    const anchorRect = anchor.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    // Keep the control inside the visible dialog, not just the note section.
    const scope = surface.closest('.task-details-scroll, .objective-details-content') || surface
    const scopeRect = scope.getBoundingClientRect()
    let viewportLeft = anchorRect.left
    let viewportTop = anchorRect.top
    if (request.kind === 'slash') {
      viewportTop = anchorRect.bottom + 6
      if (viewportTop + elementHeight > scopeRect.bottom - 4) viewportTop = anchorRect.top - elementHeight - 6
    } else {
      viewportLeft += anchorRect.width / 2 - elementWidth / 2
      viewportTop -= elementHeight + 10
      if (viewportTop < scopeRect.top + 4) viewportTop = anchorRect.bottom + 10
    }
    viewportLeft = Math.min(Math.max(viewportLeft, scopeRect.left + 6), scopeRect.right - elementWidth - 6)
    viewportTop = Math.min(Math.max(viewportTop, scopeRect.top + 4), scopeRect.bottom - elementHeight - 4)
    const left = viewportLeft - surfaceRect.left
    const top = viewportTop - surfaceRect.top
    setFloating((current) => {
      if (
        current?.request === request &&
        Math.abs(current.left - left) < 1 &&
        Math.abs(current.top - top) < 1
      )
        return current
      return { request, ...request, left, top }
    })
  }, [])

  /** Recomputes which floating control belongs to the current selection. */
  const syncFloating = useCallback(() => {
    const input = inputRef.current
    if (!input || document.activeElement !== input) return
    const caret = input.selectionStart ?? 0
    const end = input.selectionEnd ?? caret
    const slash = caret === end ? slashCandidate(input.value, caret) : null
    if (slash) {
      const previous = requestRef.current
      const selected = previous?.kind === 'slash' && previous.query === slash.query ? previous.selected : 0
      const request = {
        kind: 'slash',
        query: slash.query,
        index: slash.index,
        lineStart: slash.lineStart,
        selected,
      }
      if (dismissedRef.current === floatingKey(request)) return
      dismissedRef.current = null
      requestRef.current = request
      setCaretAnchor(slash.lineStart)
      commitFloating()
      return
    }
    if (caret !== end) {
      const request = {
        kind: 'toolbar',
        active: activeNoteFormats(input.value, tokenCache(input.value), caret, end),
        start: caret,
        end,
      }
      if (dismissedRef.current === floatingKey(request)) return
      dismissedRef.current = null
      requestRef.current = request
      setCaretAnchor(caret)
      commitFloating()
      return
    }
    dismissedRef.current = null
    closeFloating()
  }, [closeFloating, commitFloating])

  /** Applies an edit through the native input event so undo keeps working. */
  const applyEdit = useCallback(
    (edit, { toggled = null } = {}) => {
      if (!edit) return
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(edit.from, edit.to)
      const before = input.value
      let applied = false
      try {
        applied = document.execCommand('insertText', false, edit.insert)
      } catch {
        applied = false
      }
      // execCommand fires the native input event synchronously; only fall back
      // when the value truly did not change.
      if (!applied && input.value === before && (edit.from !== edit.to || edit.insert !== '')) {
        input.setRangeText(edit.insert, edit.from, edit.to, 'end')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      input.setSelectionRange(edit.start, edit.end)
      if (toggled !== null) {
        setToggledOffset(toggled)
        clearTimeout(toggleTimerRef.current)
        toggleTimerRef.current = setTimeout(() => setToggledOffset(null), TOGGLE_ANIMATION)
      }
      autoGrow()
      measureBoxes()
      syncFloating()
    },
    [autoGrow, measureBoxes, syncFloating],
  )

  const handleChange = useCallback(() => {
    const input = inputRef.current
    if (!input || input.value === textRef.current) return
    rememberText(input.value)
    scheduleEmit(input.value)
    autoGrow()
    measureBoxes()
    syncFloating()
  }, [autoGrow, measureBoxes, rememberText, scheduleEmit, syncFloating])

  const handleFocus = useCallback(() => {
    if (silentEditRef.current) return
    setFocused(true)
    const pending = pendingFocusRef.current
    pendingFocusRef.current = null
    if (pending === null) {
      syncFloating()
      return
    }
    // A click in the clean view enters editing with the caret at the clicked character.
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.setSelectionRange(pending, pending)
      syncFloating()
    })
  }, [syncFloating])

  const handleBlur = useCallback(() => {
    setFocused(false)
    flush()
    if (requestRef.current?.kind !== 'link') closeFloating()
  }, [closeFloating, flush])

  const handleScroll = useCallback(() => {
    syncPaintScroll()
    commitFloating()
    measureBoxes()
  }, [commitFloating, measureBoxes, syncPaintScroll])

  const applyInline = useCallback(
    (controlId) => {
      const input = inputRef.current
      const control = INLINE_CONTROLS.find((item) => item.id === controlId)
      if (!input || !control) return
      applyEdit(
        toggleInline(
          input.value,
          tokenCache(input.value),
          input.selectionStart ?? 0,
          input.selectionEnd ?? 0,
          control.marker,
          control.kind,
        ),
      )
    },
    [applyEdit],
  )

  const applyBlock = useCallback(
    (kind) => {
      const input = inputRef.current
      if (!input) return
      applyEdit(toggleBlock(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0, kind))
    },
    [applyEdit],
  )

  const applyIndent = useCallback(
    (outdent) => {
      const input = inputRef.current
      if (!input) return
      applyEdit(indentList(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0, outdent))
    },
    [applyEdit],
  )

  const applyLineCheckbox = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const offset = checkboxOffsetAt(input.value, input.selectionStart ?? 0)
    if (offset === null) return
    applyEdit(toggleCheckbox(input.value, offset), { toggled: offset })
  }, [applyEdit])

  /** Clean-view and keyboard links open in the default browser instead of entering edit mode. */
  const openReadingLink = useCallback((href) => {
    const target = openableNoteHref(href)
    const api = window.ritua
    if (!target || !api?.openExternal) return false
    void api.openExternal(target).catch(() => reportActionError('This link could not be opened.'))
    return true
  }, [])

  const openLink = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    linkRangeRef.current = {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? 0,
    }
    setLinkUrl('')
    requestRef.current = { kind: 'link' }
    setCaretAnchor(linkRangeRef.current.start)
    commitFloating()
    requestAnimationFrame(() => linkInputRef.current?.focus())
  }, [commitFloating])

  const submitLink = useCallback(
    (event) => {
      event.preventDefault()
      const input = inputRef.current
      if (!input) return
      const { start, end } = linkRangeRef.current
      const edit = applyLink(input.value, start, end, linkUrl)
      closeFloating()
      if (edit) applyEdit(edit)
      else input.focus()
    },
    [applyEdit, closeFloating, linkUrl],
  )

  const applySlash = useCallback(
    (command) => {
      const state = requestRef.current
      const input = inputRef.current
      if (!state || !input) return
      const caret = input.selectionStart ?? 0
      closeFloating()
      applyEdit(applySlashCommand(caret, state.index, command.insert))
    },
    [applyEdit, closeFloating],
  )

  const moveSlashSelection = useCallback(
    (delta) => {
      const state = requestRef.current
      if (state?.kind !== 'slash') return
      const commands = filterSlashCommands(state.query)
      if (!commands.length) return
      const selected = (state.selected + delta + commands.length) % commands.length
      requestRef.current = { ...state, selected }
      commitFloating()
    },
    [commitFloating],
  )

  const handleKeyDown = useCallback(
    (event) => {
      if (event.nativeEvent.isComposing) return
      const input = inputRef.current
      if (!input) return
      const state = requestRef.current
      if (state?.kind === 'slash') {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          moveSlashSelection(event.key === 'ArrowDown' ? 1 : -1)
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const commands = filterSlashCommands(state.query)
          if (commands.length) {
            event.preventDefault()
            applySlash(commands[state.selected] || commands[0])
            return
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          dismissFloating()
          return
        }
      }
      if (event.key === 'Escape') {
        if (state?.kind === 'link') {
          event.preventDefault()
          event.stopPropagation()
          dismissFloating()
          input.focus()
          return
        }
        if (state) {
          event.preventDefault()
          event.stopPropagation()
          dismissFloating()
        }
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.altKey) {
        const key = event.key.toLowerCase()
        const code = event.code
        const shiftedDigit = (digit) =>
          event.shiftKey && (code === `Digit${digit}` || code === `Numpad${digit}` || event.key === digit)
        const bracket = (open) =>
          code === (open ? 'BracketLeft' : 'BracketRight') || event.key === (open ? '[' : ']')
        if (key === 'enter') {
          event.preventDefault()
          const href = openableHrefAt(input.value, input.selectionStart ?? 0)
          if (href) openReadingLink(href)
          else applyLineCheckbox()
        } else if (key === 'b') {
          event.preventDefault()
          applyInline('bold')
        } else if (key === 'i') {
          event.preventDefault()
          applyInline('italic')
        } else if (key === 'e') {
          event.preventDefault()
          applyInline('code')
        } else if (key === 'k') {
          event.preventDefault()
          openLink()
        } else if (key === 'x' && event.shiftKey) {
          event.preventDefault()
          applyInline('strike')
        } else if (bracket(false)) {
          event.preventDefault()
          applyIndent(false)
        } else if (bracket(true)) {
          event.preventDefault()
          applyIndent(true)
        } else if (shiftedDigit('7')) {
          event.preventDefault()
          applyBlock('ordered')
        } else if (shiftedDigit('8')) {
          event.preventDefault()
          applyBlock('bullet')
        } else if (shiftedDigit('9')) {
          event.preventDefault()
          applyBlock('task')
        }
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        const edit = continueList(input.value, input.selectionStart ?? 0)
        if (edit) {
          event.preventDefault()
          applyEdit(edit)
        }
      }
    },
    [
      applyBlock,
      applyEdit,
      applyIndent,
      applyInline,
      applyLineCheckbox,
      applySlash,
      dismissFloating,
      moveSlashSelection,
      openLink,
      openReadingLink,
    ],
  )

  const toggleBox = useCallback(
    (offset) => {
      const input = inputRef.current
      if (!input) return
      applyEdit(toggleCheckbox(input.value, offset), { toggled: offset })
    },
    [applyEdit],
  )

  const animateToggle = useCallback((offset) => {
    setToggledOffset(offset)
    clearTimeout(toggleTimerRef.current)
    toggleTimerRef.current = setTimeout(() => setToggledOffset(null), TOGGLE_ANIMATION)
  }, [])

  /** Reading-mode checkboxes toggle in place without entering edit mode. */
  const toggleReadingBox = useCallback(
    (offset) => {
      const input = inputRef.current
      if (!input) return
      const edit = toggleCheckbox(input.value, offset)
      if (!edit) return
      // Apply through the native input event from a silent focus so the
      // textarea's undo history survives the reading-mode toggle.
      const previous = document.activeElement
      silentEditRef.current = true
      try {
        input.focus({ preventScroll: true })
        input.setSelectionRange(edit.from, edit.to)
        const before = input.value
        let applied = false
        try {
          applied = document.execCommand('insertText', false, edit.insert)
        } catch {
          applied = false
        }
        if (!applied && input.value === before) {
          input.setRangeText(edit.insert, edit.from, edit.to, 'end')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      } finally {
        silentEditRef.current = false
        input.blur()
        previous?.focus?.({ preventScroll: true })
      }
      animateToggle(offset)
    },
    [animateToggle],
  )

  const enterReadingAt = useCallback((clientX, clientY) => {
    const input = inputRef.current
    if (!input) return
    let offset = null
    const range = document.caretRangeFromPoint?.(clientX, clientY)
    const node = range?.startContainer
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const run = element?.closest?.('[data-note-offset]')
    if (run) offset = Number(run.dataset.noteOffset) + (range.startOffset ?? 0)
    else {
      const line = element?.closest?.('[data-note-line]')
      if (line) offset = Number(line.dataset.noteLine)
    }
    pendingFocusRef.current = offset
    input.focus()
  }, [])

  const handleReadingMouseDown = useCallback(
    (event) => {
      if (event.button !== 0) return
      const box = event.target.closest?.('[data-check-offset]')
      if (!box) return
      event.preventDefault()
      toggleReadingBox(Number(box.dataset.checkOffset))
    },
    [toggleReadingBox],
  )

  const handleReadingMouseUp = useCallback(
    (event) => {
      if (event.button !== 0) return
      // The mousedown already handled this checkbox; do not also enter editing.
      if (event.target.closest?.('[data-check-offset]')) return
      const selection = document.getSelection()
      // A drag selects text in the clean view so it can be copied; a plain
      // click opens a link or enters editing at the clicked character.
      if (selection && !selection.isCollapsed) return
      const link = event.target.closest?.('[data-note-href]')
      if (link && openReadingLink(link.dataset.noteHref)) return
      enterReadingAt(event.clientX, event.clientY)
    },
    [enterReadingAt, openReadingLink],
  )

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    syncHeight()
    syncPaintScroll()
  }, [focused, syncHeight, syncPaintScroll, text])

  useLayoutEffect(() => {
    if (focused) measureBoxes()
  }, [focused, measureBoxes, text])

  useLayoutEffect(() => {
    commitFloating()
  }, [caretAnchor, commitFloating, floating?.kind, text])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return undefined
    const observer = new ResizeObserver(() => {
      syncHeight()
      measureBoxes()
      commitFloating()
    })
    observer.observe(surface)
    return () => observer.disconnect()
  }, [commitFloating, measureBoxes, syncHeight])

  useEffect(() => registerNoteFlush(() => flush(true)), [flush])

  // "Saved" means the workspace actually committed a new revision, not just
  // that the debounce elapsed.
  useEffect(() => {
    if (saveState !== 'awaiting') return
    if (saveError) {
      clearTimeout(awaitTimerRef.current)
      setSaveState('idle')
      return
    }
    if (revision > awaitingRevisionRef.current) {
      clearTimeout(awaitTimerRef.current)
      setSaveState('saved')
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_VISIBLE)
    }
  }, [revision, saveError, saveState])

  useEffect(
    () => () => {
      clearTimeout(savedTimerRef.current)
      clearTimeout(toggleTimerRef.current)
      clearTimeout(awaitTimerRef.current)
      const pending = pendingRef.current
      if (!pending) return
      clearTimeout(pending.timer)
      pendingRef.current = null
      try {
        onChangeRef.current?.(pending.value)
      } catch {
        /* The workspace reports rejected edits on its own. */
      }
    },
    [],
  )

  // External changes (clear, undo, another editor writing notes) win over a
  // stale render, while unrelated re-renders keep the in-progress text.
  useEffect(() => {
    const input = inputRef.current
    if (!input || value === emittedRef.current) return
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer)
      pendingRef.current = null
      setSaveState('idle')
    }
    const { selectionStart: start, selectionEnd: end } = input
    input.value = value
    rememberText(value)
    emittedRef.current = value
    autoGrow()
    if (document.activeElement === input && typeof start === 'number' && typeof end === 'number')
      input.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length))
  }, [autoGrow, rememberText, value])

  const painted = useMemo(() => splitTokensAt(tokenCache(text), caretAnchor), [caretAnchor, text])
  const readingLines = useMemo(() => (!focused && text ? noteReadingLines(text) : null), [focused, text])
  const commands = floating?.kind === 'slash' ? filterSlashCommands(floating.query) : []
  const showHint = focused && text.length === 0
  const toggleLineEnd = toggledOffset === null ? -1 : text.indexOf('\n', toggledOffset)
  const tail = text === '' || text.endsWith('\n')

  const renderControl = (control, inline) => {
    const Icon = control.icon
    const pressed = inline
      ? Boolean(floating?.active?.[control.id])
      : Boolean(floating?.active?.[control.kind])
    const shortcut =
      inline && control.shortcut ? `${control.label} · ${MOD_LABEL}${control.shortcut}` : control.label
    return (
      <button
        key={control.id}
        type="button"
        tabIndex={-1}
        className={`note-editor-tool ${pressed ? 'active' : ''}`}
        aria-label={
          inline && control.shortcut ? `${control.label} (${MOD_LABEL}${control.shortcut})` : control.label
        }
        aria-pressed={pressed}
        title={shortcut}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (inline ? applyInline(control.id) : applyBlock(control.kind))}
      >
        <Icon size={15} weight={pressed ? 'bold' : 'regular'} aria-hidden="true" />
      </button>
    )
  }

  const renderReadingLine = (line, index) => {
    const runs =
      'runs' in line
        ? line.runs.map((run, runIndex) => (
            <span
              key={runIndex}
              className={run.cls || undefined}
              title={run.href}
              data-note-href={
                run.cls === 'note-read-link' ? (openableNoteHref(run.href) ?? undefined) : undefined
              }
              data-note-offset={run.offset}
            >
              {run.text}
            </span>
          ))
        : null
    const lineStart = line.lineStart
    const indent = 'indent' in line && line.indent ? { '--note-read-indent': line.indent } : undefined
    if (line.kind === 'blank')
      return (
        <div key={index} className="note-editor-read-line note-editor-read-blank" data-note-line={lineStart}>
          {'\u00a0'}
        </div>
      )
    if (line.kind === 'divider')
      return <div key={index} className="note-editor-read-divider" data-note-line={lineStart} />
    if (line.kind === 'heading')
      return (
        <div
          key={index}
          className={`note-editor-read-line note-read-h${line.level}`}
          data-note-line={lineStart}
        >
          {runs}
        </div>
      )
    if (line.kind === 'quote')
      return (
        <div
          key={index}
          className="note-editor-read-line note-editor-read-quote"
          style={indent}
          data-note-line={lineStart}
        >
          {runs}
        </div>
      )
    if (line.kind === 'bullet' || line.kind === 'ordered')
      return (
        <div
          key={index}
          className="note-editor-read-line note-editor-read-list"
          style={indent}
          data-note-line={lineStart}
        >
          <span className="note-editor-read-marker" aria-hidden="true">
            {line.kind === 'bullet' ? '•' : line.number}
          </span>
          <span className="note-editor-read-content">{runs}</span>
        </div>
      )
    if (line.kind === 'task')
      return (
        <div
          key={index}
          className={`note-editor-read-line note-editor-read-list note-editor-read-task ${line.checked ? 'done' : ''}`}
          style={indent}
          data-note-line={lineStart}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="note-editor-read-checkbox"
            data-check-offset={line.offset}
            data-checked={line.checked ? 'true' : undefined}
            data-just-toggled={toggledOffset === line.offset ? 'true' : undefined}
          />
          <span className="note-editor-read-content">{runs}</span>
        </div>
      )
    return (
      <div key={index} className="note-editor-read-line" data-note-line={lineStart}>
        {runs}
      </div>
    )
  }

  return (
    <div
      ref={surfaceRef}
      className={`note-editor ${className}`.trim()}
      data-focused={focused ? 'true' : undefined}
      data-reading={!focused && readingLines ? 'true' : undefined}
    >
      <div className="note-editor-surface">
        <div className="note-editor-paint" aria-hidden="true">
          <div ref={paintRef} className="note-editor-paint-inner">
            {painted.map((token, index) => {
              if (token.cls === 'note-editor-anchor')
                return <span key={`anchor-${index}`} ref={anchorRef} className="note-editor-anchor" />
              const justToggled =
                toggledOffset !== null &&
                tracksInsideLine(token.offset, toggledOffset, toggleLineEnd) &&
                token.cls.includes('note-md-task-text')
              const tokenClass =
                [token.cls || null, justToggled ? 'note-md-task-just-toggled' : null]
                  .filter(Boolean)
                  .join(' ') || undefined
              return (
                <span
                  key={index}
                  className={tokenClass}
                  data-check-offset={token.checked !== undefined ? token.offset : undefined}
                >
                  {token.text}
                </span>
              )
            })}
            {tail ? <span className="note-editor-paint-tail">{'\u200b'}</span> : null}
          </div>
        </div>

        {focused ? (
          <div className="note-editor-boxes" aria-hidden="true">
            <div ref={boxesRef} className="note-editor-boxes-inner">
              {boxes.map((box) => (
                <button
                  key={box.offset}
                  type="button"
                  tabIndex={-1}
                  className="note-editor-checkbox"
                  data-checked={box.checked ? 'true' : undefined}
                  data-just-toggled={toggledOffset === box.offset ? 'true' : undefined}
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    toggleBox(box.offset)
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {readingLines ? (
          <div
            className="note-editor-reading"
            aria-hidden="true"
            onMouseDown={handleReadingMouseDown}
            onMouseUp={handleReadingMouseUp}
          >
            {readingLines.map(renderReadingLine)}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="note-editor-input"
          aria-label={label}
          aria-describedby={hintId}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          aria-controls={floating?.kind === 'slash' ? slashMenuId : undefined}
          aria-haspopup={floating?.kind === 'slash' ? 'listbox' : undefined}
          aria-activedescendant={
            floating?.kind === 'slash' && commands[floating.selected]
              ? `${slashMenuId}-${commands[floating.selected].id}`
              : undefined
          }
          autoComplete="off"
          maxLength={maxLength}
          placeholder={placeholder}
          spellCheck
          wrap="soft"
          defaultValue={value}
          onBlur={handleBlur}
          onChange={handleChange}
          onClick={syncFloating}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          onKeyUp={syncFloating}
          onMouseDown={() => {
            // A plain click means the user is back in the text; let the toolbar
            // appear again after an earlier Escape.
            dismissedRef.current = null
          }}
          onScroll={handleScroll}
          onSelect={syncFloating}
        />
      </div>

      {floating?.kind === 'toolbar' ? (
        <div
          ref={floatingRef}
          className="note-editor-toolbar"
          role="toolbar"
          aria-label="Format selection"
          style={{ left: floating.left, top: floating.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="note-editor-toolbar-inner">
            {INLINE_CONTROLS.map((control) => renderControl(control, true))}
            <span className="note-editor-toolbar-divider" role="separator" />
            <button
              type="button"
              tabIndex={-1}
              className="note-editor-tool"
              aria-label="Link"
              title="Link"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openLink}
            >
              <LinkSimple size={15} aria-hidden="true" />
            </button>
            <span className="note-editor-toolbar-divider" role="separator" />
            {BLOCK_CONTROLS.map((control) => renderControl(control, false))}
          </div>
        </div>
      ) : null}

      {floating?.kind === 'slash' ? (
        <div
          ref={floatingRef}
          id={slashMenuId}
          className="note-editor-menu"
          role="listbox"
          aria-label="Insert block"
          style={{ left: floating.left, top: floating.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {commands.map((command, index) => {
            const Icon = SLASH_ICONS[command.id] || Minus
            return (
              <button
                key={command.id}
                id={`${slashMenuId}-${command.id}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === floating.selected}
                className={`note-editor-menu-item ${index === floating.selected ? 'selected' : ''}`}
                onClick={() => applySlash(command)}
              >
                <span className="note-editor-menu-icon">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="note-editor-menu-label">{command.label}</span>
              </button>
            )
          })}
          {!commands.length ? <p className="note-editor-menu-empty">No matching blocks</p> : null}
        </div>
      ) : null}

      {floating?.kind === 'link' ? (
        <form
          ref={floatingRef}
          className="note-editor-link"
          style={{ left: floating.left, top: floating.top }}
          onSubmit={submitLink}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            dismissFloating()
            inputRef.current?.focus()
          }}
        >
          <LinkSimple size={14} aria-hidden="true" />
          <input
            ref={linkInputRef}
            aria-label="Link URL"
            autoComplete="off"
            placeholder="Paste a link…"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
          <button type="submit" disabled={!linkUrl.trim()}>
            Apply
          </button>
        </form>
      ) : null}

      <div className="note-editor-footer">
        <span className="note-editor-hint" id={hintId} data-visible={showHint ? 'true' : undefined}>
          Type <kbd>/</kbd> for blocks
          <span aria-hidden="true"> · </span>
          <kbd>{MOD_LABEL}</kbd>
          <kbd>B</kbd> bold
        </span>
        <span className="note-editor-status" data-state={saveState}>
          <span className="note-editor-status-icon" aria-hidden="true">
            {saveState === 'saving' || saveState === 'awaiting' ? (
              <span className="note-editor-status-dot" />
            ) : saveState === 'saved' ? (
              <Check size={12} weight="bold" />
            ) : null}
          </span>
          <span className="note-editor-status-text">
            {saveState === 'saving' || saveState === 'awaiting'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : ''}
          </span>
        </span>
      </div>
    </div>
  )
}
