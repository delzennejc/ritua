/**
 * Note text engine for the note editor.
 *
 * Notes are stored as plain text with an intentionally small Markdown subset.
 * Everything here is a pure string/offset transformation so it can be unit
 * tested without React or a DOM. The editor renders the same characters it
 * edits: styling never changes glyph advances, which keeps the text caret
 * aligned with the painted layer.
 */

export type NoteToken = {
  /** Source characters, exactly as they appear in the stored value. */
  text: string
  /** Start offset inside the note value. */
  offset: number
  /** Style class names applied by the paint layer. */
  cls: string
  /** Present on `[ ]` / `[x]` tokens. */
  checked?: boolean
}

/** A replace-range edit plus the selection that should follow it. */
export type NoteEdit = {
  from: number
  to: number
  insert: string
  start: number
  end: number
}

export type NoteBlockKind = 'heading' | 'bullet' | 'ordered' | 'task' | 'quote'

export type NoteFormats = {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  link: boolean
  heading: boolean
  bullet: boolean
  ordered: boolean
  task: boolean
  quote: boolean
}

export type NoteSlashCommand = {
  id: string
  label: string
  insert: string
  keywords: string[]
}

export const NOTE_SLASH_COMMANDS: NoteSlashCommand[] = [
  { id: 'heading', label: 'Heading', insert: '## ', keywords: ['heading', 'title', 'h2'] },
  { id: 'bullet', label: 'Bullet list', insert: '- ', keywords: ['bullet', 'list', 'unordered'] },
  { id: 'ordered', label: 'Numbered list', insert: '1. ', keywords: ['numbered', 'ordered', 'list'] },
  {
    id: 'task',
    label: 'To-do list',
    insert: '- [ ] ',
    keywords: ['todo', 'task', 'checkbox', 'checklist'],
  },
  { id: 'quote', label: 'Quote', insert: '> ', keywords: ['quote', 'blockquote'] },
  { id: 'divider', label: 'Divider', insert: '---\n', keywords: ['divider', 'rule', 'separator'] },
]

const MARKER = 'note-md-marker'
const HEADING = /^(\s*)(#{1,4})([ \t]+)(.*)$/
const TASK = /^(\s*)([-*+])([ \t]+)\[([ xX])\]([ \t]+)(.*)$/
const ORDERED = /^(\s*)(\d{1,9}[.)])([ \t]+)(.*)$/
const BULLET = /^(\s*)([-*+])([ \t]+)(.*)$/
const QUOTE = /^(\s*)(>)([ \t]?)(.*)$/
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const LIST_LINE = /^\s*(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+|>[ \t]?|#{1,4}[ \t]+)/
const INLINE =
  /(`+)([^`\n]*?)\1|\[([^\]\n]*)\]\(([^)\s]*)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g

/** Long notes skip decoration so a single paragraph stays cheap to paint. */
const DECORATION_LIMIT = 20000

const cls = (...parts: string[]) => parts.filter(Boolean).join(' ')

/**
 * Splits a note into painted spans. The concatenation of every token text is
 * exactly the input value, so the paint layer and the editable field share
 * identical line breaking.
 */
export function tokenizeNote(value: string, limit = DECORATION_LIMIT): NoteToken[] {
  if (!value) return []
  if (value.length > limit) return [{ text: value, offset: 0, cls: '' }]
  const tokens: NoteToken[] = []
  const lines = value.split('\n')
  let lineOffset = 0

  const push = (text: string, style = '', checked?: boolean) => {
    if (!text) return
    tokens.push(
      checked === undefined
        ? { text, offset: lineOffset, cls: style }
        : { text, offset: lineOffset, cls: style, checked },
    )
    lineOffset += text.length
  }

  const pushInline = (text: string, base: string) => {
    if (!text) return
    let last = 0
    INLINE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = INLINE.exec(text))) {
      const at = match.index
      if (at > 0 && text[at - 1] === '\\') continue
      const [full, ticks, code, label, url, strong, strongAlt, strike, em, emAlt] = match
      push(text.slice(last, at), base)
      if (code !== undefined) {
        push(ticks!, cls(base, MARKER))
        push(code, cls(base, 'note-md-code'))
        push(ticks!, cls(base, MARKER))
      } else if (label !== undefined) {
        push('[', cls(base, MARKER))
        push(label, cls(base, 'note-md-link'))
        push('](', cls(base, MARKER))
        if (url) push(url, cls(base, 'note-md-link-url'))
        push(')', cls(base, MARKER))
      } else if (strong !== undefined) {
        push('**', cls(base, MARKER))
        push(strong, cls(base, 'note-md-strong'))
        push('**', cls(base, MARKER))
      } else if (strongAlt !== undefined) {
        push('__', cls(base, MARKER))
        push(strongAlt, cls(base, 'note-md-strong'))
        push('__', cls(base, MARKER))
      } else if (strike !== undefined) {
        push('~~', cls(base, MARKER))
        push(strike, cls(base, 'note-md-strike'))
        push('~~', cls(base, MARKER))
      } else if (em !== undefined) {
        push('*', cls(base, MARKER))
        push(em, cls(base, 'note-md-em'))
        push('*', cls(base, MARKER))
      } else if (emAlt !== undefined) {
        push('_', cls(base, MARKER))
        push(emAlt, cls(base, 'note-md-em'))
        push('_', cls(base, MARKER))
      }
      last = at + full.length
    }
    push(text.slice(last), base)
  }

  lines.forEach((line, index) => {
    let match: RegExpExecArray | null
    if (DIVIDER.test(line)) {
      push(line, 'note-md-divider')
    } else if ((match = HEADING.exec(line))) {
      const [, indent, hashes, space, content] = match
      push(indent, '')
      push(hashes!, cls(MARKER, 'note-md-heading-marker'))
      push(space!, MARKER)
      pushInline(content, cls('note-md-heading', `note-md-h${hashes!.length}`))
    } else if ((match = TASK.exec(line))) {
      const [, indent, bullet, bulletSpace, mark, boxSpace, content] = match
      const checked = mark !== ' '
      push(indent, '')
      push(bullet!, MARKER)
      push(bulletSpace!, MARKER)
      push(`[${mark}]`, cls('note-md-box', checked ? 'note-md-box-checked' : ''), checked)
      push(boxSpace!, '')
      pushInline(content, cls('note-md-task-text', checked ? 'note-md-task-done' : ''))
    } else if ((match = BULLET.exec(line))) {
      const [, indent, bullet, space, content] = match
      push(indent, '')
      push(bullet!, cls(MARKER, 'note-md-bullet-marker'))
      push(space!, cls(MARKER, 'note-md-bullet-marker'))
      pushInline(content, 'note-md-list-text')
    } else if ((match = ORDERED.exec(line))) {
      const [, indent, number, space, content] = match
      push(indent, '')
      push(number!, cls(MARKER, 'note-md-ordered-marker'))
      push(space!, cls(MARKER, 'note-md-ordered-marker'))
      pushInline(content, 'note-md-list-text')
    } else if ((match = QUOTE.exec(line))) {
      const [, indent, arrow, space, content] = match
      push(indent, '')
      push(arrow!, cls(MARKER, 'note-md-quote-marker'))
      push(space!, cls(MARKER, 'note-md-quote-marker'))
      pushInline(content, 'note-md-quote-text')
    } else {
      pushInline(line, '')
    }
    if (index < lines.length - 1) push('\n')
  })
  return tokens
}

/**
 * Inserts a zero-width anchor token at a raw offset so the editor can measure
 * the caret. Splitting preserves classes and character order, so measurement
 * never shifts the painted text.
 */
export function splitTokensAt(tokens: NoteToken[], offset: number | null): NoteToken[] {
  if (offset === null || offset < 0) return tokens
  const result: NoteToken[] = []
  let placed = false
  for (const token of tokens) {
    if (!placed && offset <= token.offset) {
      result.push({ text: '', offset, cls: 'note-editor-anchor' })
      placed = true
    }
    const tokenEnd = token.offset + token.text.length
    if (!placed && offset > token.offset && offset < tokenEnd) {
      const before = token.text.slice(0, offset - token.offset)
      const after = token.text.slice(offset - token.offset)
      if (before) result.push({ ...token, text: before })
      result.push({ text: '', offset, cls: 'note-editor-anchor' })
      if (after) result.push({ ...token, text: after, offset })
      placed = true
      continue
    }
    result.push(token)
  }
  if (!placed) result.push({ text: '', offset, cls: 'note-editor-anchor' })
  return result
}

/** Applies an edit and returns the resulting value plus its selection. */
export function applyNoteEdit(value: string, edit: NoteEdit) {
  return {
    value: value.slice(0, edit.from) + edit.insert + value.slice(edit.to),
    start: edit.start,
    end: edit.end,
  }
}

const lineBounds = (value: string, start: number, end: number) => {
  const from = value.lastIndexOf('\n', start - 1) + 1
  let to = value.indexOf('\n', end)
  if (to === -1) to = value.length
  return { from, to }
}

/**
 * Wraps, unwraps or extends an inline marker around the current selection.
 * When the caret sits inside an already formatted run the selection grows to
 * that run first, so the same control both applies and removes formatting.
 */
export function toggleInline(
  value: string,
  tokens: NoteToken[],
  start: number,
  end: number,
  marker: string,
  kind: string,
): NoteEdit | null {
  if (start === end) {
    const enclosing = tokens.find(
      (token) =>
        token.text &&
        token.cls.includes(kind) &&
        start > token.offset &&
        start < token.offset + token.text.length,
    )
    if (enclosing) {
      start = enclosing.offset
      end = enclosing.offset + enclosing.text.length
    }
  }
  const selected = value.slice(start, end)
  if (!selected) {
    const before = value.slice(Math.max(0, start - marker.length), start)
    const after = value.slice(end, end + marker.length)
    if (before === marker && after === marker) {
      return {
        from: start,
        to: end,
        insert: '',
        start: start + marker.length,
        end: start + marker.length,
      }
    }
    return {
      from: start,
      to: end,
      insert: marker + marker,
      start: start + marker.length,
      end: start + marker.length,
    }
  }

  const leading = /^\s*/.exec(selected)![0]
  const trailing = /\s*$/.exec(selected)![0]
  const core = selected.slice(leading.length, selected.length - trailing.length)
  if (!core) return null

  const before = value.slice(Math.max(0, start - marker.length), start)
  const after = value.slice(end, end + marker.length)
  if (before === marker && after === marker) {
    return {
      from: start - marker.length,
      to: end + marker.length,
      insert: selected,
      start: start - marker.length,
      end: end - marker.length,
    }
  }
  if (core.startsWith(marker) && core.endsWith(marker) && core.length > marker.length * 2) {
    const inner = core.slice(marker.length, core.length - marker.length)
    return {
      from: start,
      to: end,
      insert: leading + inner + trailing,
      start: start + leading.length,
      end: start + leading.length + inner.length,
    }
  }
  return {
    from: start,
    to: end,
    insert: leading + marker + core + marker + trailing,
    start: start + leading.length + marker.length,
    end: start + leading.length + marker.length + core.length,
  }
}

const hasBlockPrefix = (line: string, kind: NoteBlockKind) => {
  if (kind === 'task') return TASK.test(line)
  if (kind === 'bullet') return BULLET.test(line) && !TASK.test(line)
  if (kind === 'ordered') return ORDERED.test(line)
  if (kind === 'quote') return QUOTE.test(line)
  return HEADING.test(line)
}

const stripBlockPrefix = (line: string) =>
  line.replace(
    /^(\s*)(?:#{1,4}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+|>[ \t]?)/,
    (_full, indent: string) => indent,
  )

const blockInsert = (kind: NoteBlockKind, index: number) => {
  if (kind === 'heading') return '## '
  if (kind === 'ordered') return `${index + 1}. `
  if (kind === 'task') return '- [ ] '
  if (kind === 'quote') return '> '
  return '- '
}

/** Applies or removes a block prefix across every touched line. */
export function toggleBlock(value: string, start: number, end: number, kind: NoteBlockKind): NoteEdit | null {
  const { from, to } = lineBounds(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const sameKind = lines.every((line) => line.trim() === '' || hasBlockPrefix(line, kind))
  const insert = lines
    .map((line, index) => {
      const stripped = stripBlockPrefix(line)
      if (sameKind) return stripped
      if (line.trim() === '') return line
      return stripped.replace(/^(\s*)/, (_match, indent: string) => indent + blockInsert(kind, index))
    })
    .join('\n')
  if (insert === lines.join('\n')) return null
  if (start !== end) return { from, to, insert, start: from, end: from + insert.length }
  // Keep a collapsed caret where the user left it instead of selecting the line.
  const caretLineIndex = value.slice(0, start).split('\n').length - value.slice(0, from).split('\n').length
  const insertLines = insert.split('\n')
  const oldLine = lines[caretLineIndex] ?? ''
  const newLine = insertLines[caretLineIndex] ?? ''
  const caret = Math.min(Math.max(start + (newLine.length - oldLine.length), from), from + insert.length)
  return { from, to, insert, start: caret, end: caret }
}

/** Continues a list on Enter, or clears an empty item to leave the list. */
export function continueList(value: string, caret: number): NoteEdit | null {
  const from = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(from, caret)
  let match = TASK.exec(line)
  if (match && match[6] === '') {
    const indent = match[1]!
    return { from, to: caret, insert: indent, start: from + indent.length, end: from + indent.length }
  }
  if (match) {
    const insert = `\n${match[1]}- [ ] `
    return { from: caret, to: caret, insert, start: caret + insert.length, end: caret + insert.length }
  }
  match = ORDERED.exec(line)
  if (match && match[4] === '') {
    const indent = match[1]!
    return { from, to: caret, insert: indent, start: from + indent.length, end: from + indent.length }
  }
  if (match) {
    const next = `${Number.parseInt(match[2]!, 10) + 1}${match[2]!.slice(-1)} `
    const insert = `\n${match[1]}${next}`
    return { from: caret, to: caret, insert, start: caret + insert.length, end: caret + insert.length }
  }
  match = BULLET.exec(line)
  if (match && match[4] === '') {
    const indent = match[1]!
    return { from, to: caret, insert: indent, start: from + indent.length, end: from + indent.length }
  }
  if (match) {
    const insert = `\n${match[1]}${match[2]} `
    return { from: caret, to: caret, insert, start: caret + insert.length, end: caret + insert.length }
  }
  match = QUOTE.exec(line)
  if (match) {
    const insert = `\n${match[1]}> `
    return { from: caret, to: caret, insert, start: caret + insert.length, end: caret + insert.length }
  }
  return null
}

/** Indents or outdents every list-like line in the selection. */
export function indentList(value: string, start: number, end: number, outdent: boolean): NoteEdit | null {
  const { from, to } = lineBounds(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const affected = lines.filter((line) => LIST_LINE.test(line))
  if (!affected.length) return null
  const insert = lines
    .map((line) => {
      if (!LIST_LINE.test(line)) return line
      if (outdent) return line.replace(/^ {1,2}/, '')
      return `  ${line}`
    })
    .join('\n')
  if (insert === lines.join('\n')) return null
  return { from, to, insert, start: from, end: from + insert.length }
}

/** Returns the active `/` block query when the caret sits in one. */
export function slashCandidate(
  value: string,
  caret: number,
): { index: number; query: string; lineStart: number } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const before = value.slice(lineStart, caret)
  const match = /^([ \t]*)\/([^\s/]{0,24})$/.exec(before)
  if (!match) return null
  return { index: lineStart + match[1]!.length, query: match[2]!, lineStart }
}

export function filterSlashCommands(query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return NOTE_SLASH_COMMANDS
  return NOTE_SLASH_COMMANDS.filter((command) =>
    [command.label, ...command.keywords].some((text) => text.toLowerCase().includes(needle)),
  )
}

export function applySlashCommand(caret: number, index: number, insert: string): NoteEdit {
  return {
    from: index,
    to: caret,
    insert,
    start: index + insert.length,
    end: index + insert.length,
  }
}

export function toggleCheckbox(value: string, offset: number): NoteEdit | null {
  const mark = value[offset + 1]
  if (mark !== ' ' && mark !== 'x' && mark !== 'X') return null
  const next = mark === ' ' ? 'x' : ' '
  const caret = Math.min(offset + 4, value.length)
  return { from: offset + 1, to: offset + 2, insert: next, start: caret, end: caret }
}

/** Offset of the `[` mark on the caret's line, when that line is a to-do item. */
export function checkboxOffsetAt(value: string, caret: number): number | null {
  const from = value.lastIndexOf('\n', caret - 1) + 1
  const lineEnd = value.indexOf('\n', from)
  const line = value.slice(from, lineEnd === -1 ? value.length : lineEnd)
  const match = TASK.exec(line)
  if (!match) return null
  return from + match[1]!.length + match[2]!.length + match[3]!.length
}

/** Replaces the `[ ]`/`[x]` mark with a link label or URL for the link control. */
export function applyLink(value: string, start: number, end: number, url: string): NoteEdit | null {
  const clean = url.trim()
  if (!clean) return null
  const label = value.slice(start, end).trim()
  const text = label ? `[${label}](${clean})` : `[${clean}](${clean})`
  return {
    from: start,
    to: end,
    insert: text,
    start: start + text.length,
    end: start + text.length,
  }
}

function tokenKindActive(token: NoteToken, kind: string) {
  return Boolean(token.text) && token.cls.includes(kind)
}

/** Formats that the selection currently sits inside, used for toolbar state. */
export function activeNoteFormats(
  value: string,
  tokens: NoteToken[],
  start: number,
  end: number,
): NoteFormats {
  const collapsed = start === end
  const active = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
    heading: false,
    bullet: false,
    ordered: false,
    task: false,
    quote: false,
  }
  for (const token of tokens) {
    const tokenEnd = token.offset + token.text.length
    const overlaps = collapsed
      ? token.offset < start && start <= tokenEnd
      : token.offset < end && start < tokenEnd
    if (!overlaps) continue
    if (tokenKindActive(token, 'note-md-strong')) active.bold = true
    if (tokenKindActive(token, 'note-md-em')) active.italic = true
    if (tokenKindActive(token, 'note-md-strike')) active.strike = true
    if (tokenKindActive(token, 'note-md-code')) active.code = true
    if (tokenKindActive(token, 'note-md-link')) active.link = true
  }
  const { from, to } = lineBounds(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const every = (test: (line: string) => boolean) => lines.every((line) => line.trim() === '' || test(line))
  active.heading = every((line) => HEADING.test(line))
  active.bullet = every((line) => BULLET.test(line) && !TASK.test(line))
  active.ordered = every((line) => ORDERED.test(line))
  active.task = every((line) => TASK.test(line))
  active.quote = every((line) => QUOTE.test(line))
  return active
}

/** Last visible offsets for the slash menu's anchor. */
export const NOTE_INLINE_MARKERS = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
} as const

export type NoteReadingRun = { text: string; offset: number; cls: string; href?: string }

/** A rendered note line with the source markers removed but every run still anchored. */
export type NoteReadingLine =
  | { kind: 'blank'; lineStart: number }
  | { kind: 'divider'; lineStart: number }
  | { kind: 'paragraph'; lineStart: number; runs: NoteReadingRun[] }
  | { kind: 'heading'; lineStart: number; level: number; runs: NoteReadingRun[] }
  | { kind: 'bullet'; lineStart: number; indent: number; runs: NoteReadingRun[] }
  | { kind: 'ordered'; lineStart: number; indent: number; number: string; runs: NoteReadingRun[] }
  | {
      kind: 'task'
      lineStart: number
      indent: number
      checked: boolean
      offset: number
      runs: NoteReadingRun[]
    }
  | { kind: 'quote'; lineStart: number; indent: number; runs: NoteReadingRun[] }

const READING_CLASS = /note-md-(strong|em|strike|code|link)(?:\s|$)/

const readingRuns = (line: NoteToken[], dropLeadingSpace: boolean): NoteReadingRun[] => {
  const runs: NoteReadingRun[] = []
  let skipSpace = dropLeadingSpace
  let lastLink: NoteReadingRun | null = null
  for (const token of line) {
    if (token.checked !== undefined || token.cls.includes('note-md-marker')) continue
    if (token.cls.includes('note-md-link-url')) {
      if (lastLink) lastLink.href = token.text
      continue
    }
    if (skipSpace) {
      skipSpace = false
      if (!token.cls && !token.text.trim()) continue
    }
    const match = READING_CLASS.exec(token.cls)
    const run: NoteReadingRun = {
      text: token.text,
      offset: token.offset,
      cls: match ? `note-read-${match[1]}` : '',
    }
    if (run.cls === 'note-read-link') lastLink = run
    runs.push(run)
  }
  return runs
}

const lineIndent = (line: NoteToken[]) => {
  const first = line[0]
  if (!first || first.cls || first.text.trim()) return 0
  return Math.max(0, Math.floor(first.text.replace(/\t/g, '  ').length / 2))
}

const readingLine = (line: NoteToken[], lineStart: number): NoteReadingLine => {
  if (!line.length) return { kind: 'blank', lineStart }
  if (line.length === 1 && line[0]!.cls.includes('note-md-divider')) return { kind: 'divider', lineStart }
  const indent = lineIndent(line)
  const box = line.find((token) => token.checked !== undefined)
  if (box)
    return {
      kind: 'task',
      lineStart,
      indent,
      checked: box.checked === true,
      offset: box.offset,
      runs: readingRuns(line, true),
    }
  const heading = line.find((token) => /note-md-h[1-4]/.test(token.cls))
  if (heading)
    return {
      kind: 'heading',
      lineStart,
      level: Number(/note-md-h([1-4])/.exec(heading.cls)?.[1] ?? 2),
      runs: readingRuns(line, true),
    }
  if (line.some((token) => token.cls.includes('note-md-quote-marker')))
    return { kind: 'quote', lineStart, indent, runs: readingRuns(line, true) }
  const ordered = line.find((token) => token.cls.includes('note-md-ordered-marker'))
  if (ordered)
    return { kind: 'ordered', lineStart, indent, number: ordered.text.trim(), runs: readingRuns(line, true) }
  if (line.some((token) => token.cls.includes('note-md-bullet-marker')))
    return { kind: 'bullet', lineStart, indent, runs: readingRuns(line, true) }
  const runs = readingRuns(line, true)
  if (!runs.some((run) => run.text.trim())) return { kind: 'blank', lineStart }
  return { kind: 'paragraph', lineStart, runs }
}

/** Web and mail targets the clean view can hand to the operating system. */
export function openableNoteHref(url: string | undefined): string | null {
  if (!url || url.length > 2048) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

/** Href of the link label under the caret, for keyboard activation while editing. */
export function openableHrefAt(value: string, caret: number): string | null {
  const tokens = tokenizeNote(value, Number.POSITIVE_INFINITY)
  const label = tokens.find(
    (token) =>
      token.cls.includes('note-md-link') &&
      !token.cls.includes('note-md-link-url') &&
      caret >= token.offset &&
      caret <= token.offset + token.text.length,
  )
  if (!label) return null
  const lineEnd = value.indexOf('\n', label.offset)
  const url = tokens.find(
    (token) =>
      token.cls.includes('note-md-link-url') &&
      token.offset > label.offset &&
      (lineEnd === -1 || token.offset < lineEnd),
  )
  return openableNoteHref(url?.text)
}

/** The unfocused view of a note: markdown syntax removed, structure rendered. */
export function noteReadingLines(value: string): NoteReadingLine[] {
  const tokens = tokenizeNote(value, Number.POSITIVE_INFINITY)
  const lines: NoteReadingLine[] = []
  let current: NoteToken[] = []
  let lineStart = 0
  for (const token of tokens) {
    if (token.text === '\n') {
      lines.push(readingLine(current, lineStart))
      current = []
      lineStart = token.offset + 1
      continue
    }
    current.push(token)
  }
  lines.push(readingLine(current, lineStart))
  return lines
}
