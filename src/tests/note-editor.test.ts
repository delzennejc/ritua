import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeNoteFormats,
  applyLink,
  applyNoteEdit,
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
} from '../renderer/src/app/components/note-editor/markdown'

const corpus = [
  '',
  'Plain notes stay plain.',
  'First line\nSecond line',
  '# Heading\n\nA paragraph with **bold**, *italic*, ~~strike~~ and `code`.',
  '- [ ] Open item\n- [x] Done item\n- plain bullet',
  '1. First\n2. Second',
  '> A quote\nwith a second line',
  'A [link](https://example.com) inside text',
  '---\nAfter a divider',
  'Text ending with a newline\n',
  'Mixed **bold *and* nested** text',
  'Escaped \\*not italic\\* stays',
  '## Section\n- [x] packed\n\n`tick`',
]

test('note tokens round-trip the stored text exactly', () => {
  for (const value of corpus) {
    const tokens = tokenizeNote(value)
    assert.equal(tokens.map((token) => token.text).join(''), value, `round-trip: ${JSON.stringify(value)}`)
    let offset = 0
    for (const token of tokens) {
      assert.equal(token.offset, offset, `offset continuity for ${JSON.stringify(value)}`)
      offset += token.text.length
    }
  }
})

test('note tokens classify markdown structure', () => {
  const value = '# Title\n- [x] Done\n- [ ] Todo\n> Quote\n1. Numbered\n**bold**'
  const tokens = tokenizeNote(value)
  const classes = (kind: string) =>
    tokens.filter((token) => token.cls.includes(kind)).map((token) => token.text)
  assert.deepEqual(classes('note-md-h1'), ['Title'])
  assert.deepEqual(classes('note-md-strong'), ['bold'])
  assert.deepEqual(classes('note-md-quote-text'), ['Quote'])
  assert.deepEqual(classes('note-md-list-text'), ['Numbered'])
  const boxes = tokens.filter((token) => token.checked !== undefined)
  assert.deepEqual(
    boxes.map((token) => [token.text, token.checked]),
    [
      ['[x]', true],
      ['[ ]', false],
    ],
  )
})

test('splitting at an anchor preserves the painted text and lands exactly', () => {
  const value = '- [ ] Task with **bold**'
  const tokens = tokenizeNote(value)
  for (let offset = 0; offset <= value.length; offset += 1) {
    const split = splitTokensAt(tokens, offset)
    assert.equal(split.map((token) => token.text).join(''), value, `split round-trip at ${offset}`)
    const anchorIndex = split.findIndex((token) => token.cls === 'note-editor-anchor')
    assert.ok(anchorIndex >= 0)
    assert.equal(
      split.slice(0, anchorIndex).reduce((total, token) => total + token.text.length, 0),
      offset,
      `anchor position at ${offset}`,
    )
  }
  assert.equal(splitTokensAt(tokens, null), tokens, 'A null anchor leaves tokens untouched')
})

test('inline formatting wraps, unwraps and expands around the caret', () => {
  const wrap = toggleInline('hello world', tokenizeNote('hello world'), 0, 5, '**', 'note-md-strong')!
  assert.deepEqual(applyNoteEdit('hello world', wrap), { value: '**hello** world', start: 2, end: 7 })
  const unwrap = toggleInline(
    '**hello** world',
    tokenizeNote('**hello** world'),
    2,
    7,
    '**',
    'note-md-strong',
  )!
  assert.deepEqual(applyNoteEdit('**hello** world', unwrap), { value: 'hello world', start: 0, end: 5 })
  const inside = toggleInline(
    '**hello** world',
    tokenizeNote('**hello** world'),
    5,
    5,
    '**',
    'note-md-strong',
  )!
  assert.deepEqual(applyNoteEdit('**hello** world', inside), { value: 'hello world', start: 0, end: 5 })
  const empty = toggleInline('', tokenizeNote(''), 0, 0, '*', 'note-md-em')!
  assert.deepEqual(applyNoteEdit('', empty), { value: '**', start: 1, end: 1 })
  const whitespace = toggleInline(
    'say hello now',
    tokenizeNote('say hello now'),
    3,
    10,
    '**',
    'note-md-strong',
  )!
  assert.deepEqual(applyNoteEdit('say hello now', whitespace), {
    value: 'say **hello** now',
    start: 6,
    end: 11,
  })
})

test('block formatting toggles lists and quotes without touching other prefixes', () => {
  const bullet = toggleBlock('one\ntwo', 0, 7, 'bullet')!
  assert.deepEqual(applyNoteEdit('one\ntwo', bullet).value, '- one\n- two')
  const removed = toggleBlock('- one\n- two', 0, 11, 'bullet')!
  assert.deepEqual(applyNoteEdit('- one\n- two', removed).value, 'one\ntwo')
  const converted = toggleBlock('- one\n- two', 0, 11, 'task')!
  assert.deepEqual(applyNoteEdit('- one\n- two', converted).value, '- [ ] one\n- [ ] two')
  const ordered = toggleBlock('one\ntwo', 0, 7, 'ordered')!
  assert.deepEqual(applyNoteEdit('one\ntwo', ordered).value, '1. one\n2. two')
  const quote = toggleBlock('one\ntwo', 0, 7, 'quote')!
  assert.deepEqual(applyNoteEdit('one\ntwo', quote).value, '> one\n> two')
  assert.equal(toggleBlock('', 0, 0, 'bullet'), null)
})

test('block formatting keeps a collapsed caret in place', () => {
  const value = 'first\nsecond line'
  const caret = value.length
  const edit = toggleBlock(value, caret, caret, 'bullet')!
  const applied = applyNoteEdit(value, edit)
  assert.equal(applied.value, 'first\n- second line')
  assert.equal(applied.start, applied.end, 'A collapsed caret stays collapsed')
  assert.equal(applied.value.slice(applied.start - 4, applied.start), 'line')
  const unbind = toggleBlock(applied.value, applied.start, applied.start, 'bullet')!
  assert.equal(applyNoteEdit(applied.value, unbind).value, value)
})

test('checkboxes can be found and toggled from the caret line', () => {
  const value = 'intro\n- [ ] Ship notes\nnext'
  const caret = value.indexOf('Ship') + 2
  const offset = checkboxOffsetAt(value, caret)!
  assert.equal(value.slice(offset, offset + 3), '[ ]')
  const edit = toggleCheckbox(value, offset)!
  assert.deepEqual(applyNoteEdit(value, edit).value, 'intro\n- [x] Ship notes\nnext')
  assert.equal(checkboxOffsetAt('plain line', 4), null)
  assert.equal(checkboxOffsetAt('  - [x] indented', 8), 4)
})

test('Enter continues lists and clears empty items', () => {
  const task = continueList('- [x] Done', 11)!
  assert.deepEqual(applyNoteEdit('- [x] Done', task), { value: '- [x] Done\n- [ ] ', start: 18, end: 18 })
  const bullet = continueList('- Item', 6)!
  assert.deepEqual(applyNoteEdit('- Item', bullet).value, '- Item\n- ')
  const ordered = continueList('9. Ninth', 8)!
  assert.deepEqual(applyNoteEdit('9. Ninth', ordered).value, '9. Ninth\n10. ')
  const quote = continueList('> Quoted', 8)!
  assert.deepEqual(applyNoteEdit('> Quoted', quote).value, '> Quoted\n> ')
  const exit = continueList('- [ ] ', 6)!
  assert.deepEqual(applyNoteEdit('- [ ] ', exit), { value: '', start: 0, end: 0 })
  const indentExit = continueList('  - [ ] ', 8)!
  assert.deepEqual(applyNoteEdit('  - [ ] ', indentExit), { value: '  ', start: 2, end: 2 })
  assert.equal(continueList('plain text', 10), null)
})

test('list indentation adds and removes two spaces', () => {
  const indent = indentList('- one\ntwo', 0, 9, false)!
  assert.deepEqual(applyNoteEdit('- one\ntwo', indent).value, '  - one\ntwo')
  const outdent = indentList('    - one', 0, 9, true)!
  assert.deepEqual(applyNoteEdit('    - one', outdent).value, '  - one')
  assert.equal(indentList('plain', 0, 5, false), null)
})

test('slash queries open, filter and apply block commands', () => {
  const candidate = slashCandidate('Intro\n/quo', 10)!
  assert.deepEqual(candidate, { index: 6, query: 'quo', lineStart: 6 })
  assert.equal(slashCandidate('and/or', 6), null)
  assert.equal(slashCandidate('/', 1)!.query, '')
  assert.equal(filterSlashCommands('todo')[0]!.id, 'task')
  assert.equal(filterSlashCommands('bul')[0]!.id, 'bullet')
  assert.equal(filterSlashCommands('zzz').length, 0)
  const applied = applySlashCommand(10, 6, '> ')
  assert.deepEqual(applyNoteEdit('Intro\n/quo', applied), { value: 'Intro\n> ', start: 8, end: 8 })
})

test('checkbox toggles write agent-readable marks', () => {
  const value = '- [ ] Ship notes'
  const checked = toggleCheckbox(value, 2)!
  assert.deepEqual(applyNoteEdit(value, checked), { value: '- [x] Ship notes', start: 6, end: 6 })
  const unchecked = toggleCheckbox('- [x] Ship notes', 2)!
  assert.deepEqual(applyNoteEdit('- [x] Ship notes', unchecked).value, '- [ ] Ship notes')
  assert.equal(toggleCheckbox('- plain', 2), null)
})

test('links wrap the selection and fall back to the URL label', () => {
  const selected = applyLink('see docs now', 4, 8, 'https://example.com')!
  assert.deepEqual(applyNoteEdit('see docs now', selected).value, 'see [docs](https://example.com) now')
  const empty = applyLink('see  now', 4, 4, 'https://example.com')!
  assert.deepEqual(
    applyNoteEdit('see  now', empty).value,
    'see [https://example.com](https://example.com) now',
  )
  assert.equal(applyLink('text', 0, 0, '   '), null)
})

test('active formats follow the selection', () => {
  const value = '**bold** and `code`\n- [ ] task'
  const tokens = tokenizeNote(value)
  const bold = activeNoteFormats(value, tokens, 3, 5)
  assert.equal(bold.bold, true)
  assert.equal(bold.italic, false)
  const code = activeNoteFormats(value, tokens, 14, 16)
  assert.equal(code.code, true)
  const lineStart = value.indexOf('- [ ]')
  const task = activeNoteFormats(value, tokens, lineStart + 4, lineStart + 4)
  assert.equal(task.task, true)
  assert.equal(activeNoteFormats('plain', tokenizeNote('plain'), 0, 3).bold, false)
})

test('the clean reading view removes syntax but keeps structure and anchors', () => {
  const value = [
    '# Weekly report',
    '',
    'hello **world** with *care* and [Ritua.ai](https://ritua.ai)',
    '- [x] Done item',
    '- [ ] Todo item',
    '- plain bullet',
    '3. Third',
    '  - nested bullet',
    '> Quoted line',
    '---',
    'plain paragraph',
  ].join('\n')
  const lines = noteReadingLines(value)
  assert.equal(lines[0]!.kind, 'heading')
  assert.equal(lines[0]!.kind === 'heading' && lines[0]!.level, 1)
  assert.equal(lines[1]!.kind, 'blank')
  const paragraph = lines[2]!
  assert.equal(paragraph.kind, 'paragraph')
  if (paragraph.kind === 'paragraph') {
    assert.equal(paragraph.runs.map((run) => run.text).join(''), 'hello world with care and Ritua.ai')
    assert.deepEqual(
      paragraph.runs.map((run) => run.cls),
      ['', 'note-read-strong', '', 'note-read-em', '', 'note-read-link'],
    )
    for (const run of paragraph.runs)
      assert.equal(
        value.slice(run.offset, run.offset + run.text.length),
        run.text,
        'runs point at their source',
      )
  }
  const [done, todo, bullet, ordered, nested, quote, divider, plain] = lines.slice(3)
  assert.equal(done!.kind === 'task' && done!.checked, true)
  assert.equal(todo!.kind === 'task' && todo!.checked, false)
  assert.equal(value.slice(done!.kind === 'task' ? done!.offset : 0).slice(0, 3), '[x]')
  assert.equal(bullet!.kind, 'bullet')
  assert.equal(ordered!.kind === 'ordered' && ordered!.number, '3.')
  assert.equal(ordered!.kind === 'ordered' && ordered!.indent, 0)
  assert.equal(nested!.kind === 'bullet' && nested!.indent, 1, 'Nested bullets keep their depth')
  assert.equal(quote!.kind, 'quote')
  assert.equal(divider!.kind, 'divider')
  assert.equal(plain!.kind, 'paragraph')
  assert.equal(noteReadingLines('plain')[0]!.kind, 'paragraph')
  assert.equal(noteReadingLines('')[0]!.kind, 'blank')
  const link =
    paragraph.kind === 'paragraph' ? paragraph.runs.find((run) => run.cls === 'note-read-link') : null
  assert.equal(link?.href, 'https://ritua.ai', 'Link runs keep their target for the tooltip')
  assert.equal(openableNoteHref('https://ritua.ai'), 'https://ritua.ai/')
  assert.equal(openableNoteHref('mailto:hi@ritua.ai'), 'mailto:hi@ritua.ai')
  assert.equal(openableNoteHref('file:///etc/passwd'), null, 'Local files are not openable links')
  assert.equal(openableNoteHref('javascript:alert(1)'), null)
  assert.equal(openableNoteHref('/relative/path'), null)
  assert.equal(openableNoteHref(undefined), null)
  const linkValue = 'See [Ritua](https://ritua.ai) now'
  const labelStart = linkValue.indexOf('Ritua')
  assert.equal(
    openableHrefAt(linkValue, labelStart + 1),
    'https://ritua.ai/',
    '⌘Enter opens the label target',
  )
  assert.equal(openableHrefAt(linkValue, 0), null, 'Plain text has no link target')
  assert.equal(openableHrefAt('See [Bad](file:///etc/passwd)', 6), null, 'Unsafe targets stay closed')
  const long = `# Head\n${'x'.repeat(30000)} **bold**`
  assert.ok(
    noteReadingLines(long).length > 1,
    'Long notes are still parsed for the clean view instead of falling back to raw text',
  )
})
