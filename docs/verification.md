# Desktop verification

## Commands

- `npm run test:unit`: domain and renderer-session tests, plus the standalone scrolling,
  calendar-availability and task-time tests. Runs under Node without launching Electron.
- `npm run test:integration`: production build followed by the isolated Electron smoke suite.
- `npm test`: both suites, including all required build checks.
- `npm run build`: architecture, JavaScript lint, strict TypeScript and production bundles.
- `npm run format:check`: consistent source/tooling formatting.
- `npm run profile:workspace`: synthetic canonical edits, renderer validation/projection, commit comparison and checkpoint serialization measurements.
- `npm run check:whitespace`: whitespace errors in the current diff.

The 43 pure tests are registered in `src/tests/unit.ts`. Native persistence cases for completion and
sessions are separate from their pure domain tests. All fixtures and test runners remain under
`src/tests`. `view-command-adapters.ts` keeps existing fixture scenarios readable while exercising the production canonical command APIs; it is never imported into the app. Bundling the Node runner resolves TypeScript imports without changing production modules.

The Electron launcher creates temporary data directories, sets `RITUA_TEST_MODE=1`, and performs
write/read launches against the same isolated database. It never resets the user's workspace.
A sandbox that cannot launch native GUI processes may require running the same command with
permission to launch Electron; do not replace native verification with browser-only checks.

## Behavior covered

- Fresh five-table initialization, Work/Personal defaults, and empty work lists.
- Canonical projection roundtrips, atomic validation, revision conflicts and retry receipts.
- Immutable derived projections, rejection without state corruption, edit batching, lost acknowledgement retry,
  edits during an in-flight save and close during an unfinished gesture.
- Canonical record/collection sharing, unchanged preference projections, and cached validation that still
  rejects dangling references. Optional values remain serializable; invalid numeric values are rejected.
- Ordered and deduplicated recovery writes, retry after a failed checkpoint, and nested recurrence snapshots.
- Task deletion and Undo across projects, archived history and session membership.
- Area organization, project archive Undo and recurrence edits that retain historical work.
- Task/Project creation, task editing and completion, scheduling, drag resize/cancellation.
- Planning entry, date rollover, session membership, keyboard interactions and restart persistence.
- Recurrence → reschedule → session membership → archive → reassignment → Undo → delete/Undo → complete,
  with an actual SQLite close/reopen after every step.
- Twelve seeded sequences with 80 actions each, checking canonical identity, references, projection stability,
  calendar/task agreement and reversible deletion.
- Attachment import/export, backup/restore and repeated crash/conflict recovery.

For visual QA run `npm run dev:browser` and open the localhost preview in the hidden in-app Browser.
Check Today, backlog, planning and details, including focus return and cancellation. This preview
is an ephemeral workspace; native durability must be checked separately in Electron.

Local installers remain unsigned and have no published automatic-update channel. Packaging does
not publish. Existing database files stay outside the repository and are not reset by source cleanup.
