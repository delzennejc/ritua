# Calendar Sessions — visual QA

final result: passed

## Scope and visual reference

The supplied checklist card is a visual direction for an existing desktop calendar, not a replacement screen. The implementation preserves Ritua's Inter typography, warm neutral tokens, Phosphor icons, navigation, calendar scale, and existing task behavior. The five-table database schema is unchanged.

Source: `/var/folders/1h/llnnj2c52kz6jlhqvprhk4m40000gn/T/codex-clipboard-5767970e-b9fd-421a-b613-24a8684962a6.png` (576 × 770 pixels).

Browser-rendered evidence, captured in the hidden in-app Browser at 1280 × 720 CSS pixels and 1× density:

- `/private/tmp/ritua-session-calendar.png`: three-hour card, three tasks, one completed.
- `/private/tmp/ritua-session-details.png`: native modal editor with schedule, checklist, task picker, reorder/remove controls.
- `/private/tmp/ritua-session-week.png`: seven-day calendar with a newly created 09:00–12:00 Session.
- `/private/tmp/ritua-session-week-card.png`: focused capture of that calendar card.

Source and day-calendar evidence were opened together for comparison. Source and implementation have different physical sizes and content; comparison evaluates the requested hierarchy and card treatment, not pixel identity. Focused card capture supplements the full-screen calendar and editor checks.

## Findings and comparison history

- Initial card spacing allowed only one visible task row in a three-hour slot. Reduced header/body spacing and checklist row padding. The revised day-calendar capture shows all three short task rows, progress, title, completion count, and Add tasks within the unchanged 132px slot.
- Long titles now truncate before the completion count. Short sessions collapse the checklist; sessions of 30 minutes or less retain an openable title and resize handle.
- Development refresh briefly replaced the context identity. Moved context into a separate module; subsequent source refreshes, navigation, and interactions passed without new browser errors.
- Typography and spacing: existing Inter, smaller calendar typography, rounded white card, balanced header, compact circle checkboxes; full editor supplies comfortable spacing.
- Color and tokens: existing warm neutrals, dark progress fill, muted completed tasks with strikethrough, established purple primary action.
- Assets: no raster assets are required for this manual workflow. Existing Phosphor icons are used; external service logos and account UI from the reference are outside the requested scope.
- Copy: Session/New session/Create session replace task creation wording only in the calendar. Empty states and task count describe the actual session.

No remaining actionable P0/P1/P2 visual findings.

## Verification

Browser: day/week creation, three-hour default, new tasks, synchronized completion, editor open/close and focus return, one-hour calendar move preserving duration, sessions remaining visible under Personal filtering, and final console-error check passed. The three-hour default is capped at midnight; explicit selection/resizing can change duration, with a 15-minute minimum.

Native Session suite: canonical membership, no duplicate tasks, completion, reorder, remove/re-add, Session deletion and Undo, keyboard/native resize, canceled resize, out-of-calendar drop cancellation, and persistence after a second Electron launch passed. Domain checks cover validation, atomic rejection, recovery merging, task deletion/Undo membership, day rollover, and database reopen.

`npm run build`, `npm test` (including both native Session launches and the full existing suite), and `git diff --check` passed in the final run.

Follow-up: sessions have no Area field or filter association. Native dragging into a session, duplicate-drop prevention, canceled task drops, unchanged task lane/Area/schedule, green calendar completion markers, and persistence passed. Completion uses the canonical task and its actual completion date, so a moved session does not relocate the completion marker. Hidden browser visual checks confirmed the checklist, Area-free creation, area-independent visibility, and green marker tooltip; no browser console errors.

Calendar checklist follow-up: task titles use the existing SortableCollectionLane/SortableCollectionItem drag handles and shared live reorder flow. Verified native and browser reorder and drag-out removal, unchanged canonical task content, canceled drag-out, re-adding, and restart persistence. The card has no Add tasks button; the session details retain the picker. Removed the custom insertion-line logic. Native tests observe the shared translate animation before releasing the pointer and verify cancel restores the prior order. Added Alt + arrow reorder and Delete membership removal for keyboard access. The full npm test suite and whitespace checks passed.

Session task details: clicking titles in calendar cards and session details opens the existing task editor. Native checks cover canonical identity, focus return, and no accidental editor opening after drag. Hidden browser checks verify editing the title synchronizes the session row. Build, full tests, and whitespace checks passed.

## Recurring sessions — visual QA

final result: passed

A Session context menu now offers Repeat between Add tasks and Move to date, and choosing any repeat rule always opens the task scope question: repeat the session's tasks with it (fresh copies in every occurrence, the default when tasks exist) or repeat only the time slot (empty occurrences, tasks stay in the selected session). A session with no tasks yet shows the question with "Repeat tasks with the session" disabled and the hint "Add tasks to this session first". Custom opens a dark-styled custom repeat panel inside the menu with interval, unit, weekday, monthly-mode and ends controls plus Cancel/Save repeat. Session details add a Repeats control using the shared RecurrenceEditor, including the same task scope choice, and a repeating session's More actions offer "Delete this session only" and "Delete this and following sessions" with Undo. Deleting a recurring session from the context menu uses the same full-width option list as recurring tasks ("Delete recurring session?", Cancel, This session only, This and following sessions), not a confirmation card with wrapped buttons.

Hidden Electron captures (`build/qa/shots`): context menu with Repeat/Does not repeat; preset panel; the "Repeat tasks with the session / Session only" scope question for a task-filled session and for an empty session (disabled task option with an explanation); custom repeat panel; session-details repeat editor; an empty session-only occurrence whose editor still offers the remembered tasks; a future occurrence card with the repeat badge and its copied tasks on the date board. Verified in the same session: applying custom weekly produced 53 occurrences over the generation horizon with 106 unique task copies, the selected occurrence kept its original tasks, a future occurrence carried fresh "Draft the plan"/"Review last week" copies, session-only weekly produced 52 empty occurrences plus the selected session's two tasks with no copies, switching back to repeated tasks from an empty occurrence restored two copies to every occurrence, and "Delete this and following sessions" removed the later series, showed "Sessions deleted. Their tasks are still in your lists." and Undo restored all 53 occurrences and cleared the stop.

Background color is part of the repeat: repeated occurrences inherit the selected session's color, and changing the color of a recurring session ("Applies to this session and later occurrences.") updated all 53 occurrences and the repeat template; the next Saturday's card rendered the same green background.

Follow-up: `npm run build`, `npm run test:unit` and the native session smoke suite (the repeat flow asks for task scope; repeat rule, occurrences and repeated tasks persist across write/read launches) passed after the visual checks.

## Note editor — visual QA

final result: passed

Task, Project and Session details now share one `NoteEditor` for their notes. Notes stay plain markdown strings: a native textarea owns typing, selection, IME, spellcheck and undo, while a paint layer behind it renders the same characters with the same metrics (headings, bold, italic, strikethrough, inline code, links, quotes, bullets, numbered lists and `- [ ]` checkboxes). Because the paint layer only changes appearance, no note is ever rewritten by opening or formatting it, and the stored text stays directly usable for agent/RAG ingestion.

The editor has two faces: while focused it shows the source with ghosted markdown markers, and while unfocused it renders a clean view with the syntax removed — `# `, `**`, `*`, `~~`, backticks, `>`, list markers and link URLs disappear, lists and checkboxes become real elements, and heading/link styles apply. The clean view renders in flow so the section sizes itself to the note's real content, clamps to the same 46 vh as the editing view for very long notes, keeps nested list depth, shows the link target on hover, and still allows drag-selection for copying. Clicking a rendered word re-enters editing with the caret at that character; clicking a rendered checkbox toggles it in place without entering edit mode and without clearing the textarea's undo history; clicking a rendered web or email link opens it in the default browser through a sender-validated `openExternal` command (`http:`, `https:` and `mailto:` only, everything else rejected in the main process). The textarea value is never altered by the display mode.

Interactions verified in the hidden Electron app: the floating toolbar follows the selection with Bold/Italic/Strikethrough/Code/Link/Heading/Bullet/To-do/Quote, correct pressed states, and Escape dismissing it without closing the dialog and without a keyup reopening it; `/` at a line start opens a filtered listbox with arrow-key selection and `aria-activedescendant`; Enter continues lists and clears an empty item; checkboxes toggle with a drawn tick and a strike that repeats on every wrapped line; `⌘Enter` toggles the caret line's to-do item; links open a small URL popover; `⌘B/I/⇧X/E/K`, `⌘⇧7/8/9` (matched by physical key) and `⌘[`/`⌘]` shortcuts work; the save indicator moves `saving → awaiting → saved` only after the workspace commits a new revision, then fades; an empty focused note shows the command hint. Toolbar and menu controls are skipped by Tab so focus stays inside the dialog. A debounced commit flushes on blur and joins the existing native close handshake through `pending-note-edits`.

Hidden Electron captures (`build/qa/shots`): task details with a formatted note and the selection toolbar on an italic run; the same note unfocused showing the clean rendered view; the slash block menu; the empty focused state with the command hint; Project details and Session notes with the same editor. The paint layer and textarea matched exactly (font, line-height, wrap and scrollHeight) at every checked size, and each drawn checkbox measured centered on its `[ ]` marker.

Session notes are a new canonical field: `updateCalendarSession` accepts `notes`, validation caps them at 200,000 characters, and recurring sessions copy the notes into their occurrences and their repeat definition. `npm run build`, `npm test` (122 pure tests plus the Electron smoke suite, including the close-save handshake and clean-view link opening) and `npm run check:whitespace` passed.

Independent review follow-ups (all verified in the hidden app): Escape stays dismissed across keyup and clears when the user clicks back into the note or changes the selection; block shortcuts match physical key codes so `⌘⇧7/8/9` work on real layouts; completed items strike every wrapped line; toolbar and menu controls are skipped by Tab so focus stays in the dialog; `⌘Enter` toggles the caret line's to-do item; and a new save cycle cancels the previous indicator timer so "Saved" cannot be shown or cleared by a stale cycle.

Clean-view follow-ups (second review round): the unfocused view is rendered in flow so a freshly opened note is never clipped and the section tracks its real height; notes over the decoration limit are fully parsed instead of falling back to raw markdown; the clean view clamps to 46 vh and scrolls for very long notes with off-screen lines skipped by `content-visibility`; reading-mode checkbox toggles apply through the native input event so undo survives, stay in the clean view, ignore the release that follows, and restore the previously focused control; the hidden textarea is bounded to the rendered layer so it cannot swallow clicks below; nested lists keep their depth; and link runs expose their target as a tooltip. Clean-view web and email links open in the default browser through the sender-validated `openExternal` command, and `⌘Enter` inside a link label opens it from the keyboard; the native suite rejects `file:` targets, verifies one web link reaches the OS handler without entering edit mode, and covers the checkbox and overflow regressions.
