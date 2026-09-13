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
