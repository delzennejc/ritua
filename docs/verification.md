# Desktop verification

## Commands

- `npm run test:unit`: domain and renderer-session tests, plus the standalone scrolling,
  calendar-availability and task-time tests. Runs under Node without launching Electron.
- `npm run test:integration`: production build followed by the isolated Electron smoke suite.
- `npm test`: both suites, including all required build checks.
- `npm run build`: architecture, JavaScript lint, strict TypeScript and production bundles.
- `npm run format:check`: consistent source/tooling formatting.
- `npm run profile:workspace`: synthetic canonical edits, renderer validation/projection, commit comparison and checkpoint serialization measurements.
- `npm run qa -- start | shot | eval | reload | status | stop`: hidden development Electron with an isolated database and DevTools control (see Visual QA).
- `npm run check:whitespace`: whitespace errors in the current diff.

The 43 pure tests are registered in `src/tests/unit.ts`. Native persistence cases for completion and
sessions are separate from their pure domain tests. All fixtures and test runners remain under
`src/tests`. `view-command-adapters.ts` keeps existing fixture scenarios readable while exercising the production canonical command APIs; it is never imported into the app. Bundling the Node runner resolves TypeScript imports without changing production modules.

The Electron launcher creates temporary data directories, sets `RITUA_TEST_MODE=1`, and performs
write/read launches against the same isolated database. It never resets the user's workspace.
Test windows stay transparent, unfocused and click-through so a run does not interrupt other work
on the same machine, and focus emulation keeps commit-on-blur behavior real while the window is
not key. Integration runs use no fixed ports and build into their own worktree, so suites and QA
sessions in separate worktrees do not conflict. Set `RITUA_TEST_VISIBLE=1` to watch a run in a
normal focused window instead.
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

For quick visual QA run `npm run dev:browser` and open the localhost preview in the hidden in-app
Browser. Check Today, backlog, planning and details, including focus return and cancellation. This
preview is an ephemeral workspace; native durability must be checked separately in Electron.

For stateful or native visual QA run the hidden Electron harness. `npm run qa -- start` launches
`electron-vite dev` with a hidden window, its own build output under `build/qa/out`, automatically
chosen renderer and DevTools ports, a temporary database, and the DevTools protocol; a normal
development session keeps running untouched. The application stays out of the Dock and inactive,
with focus emulation so focus and blur behavior matches a focused window while nothing appears on
screen. Because ports are chosen automatically, QA sessions in separate worktrees (and a running
development server) do not conflict; `--control-port` and `--renderer-port` pin ports explicitly. `npm run qa -- shot <name> [--script @file] [--size 1280x800] [--full]
[--wait "text"]` drives the real renderer and saves a PNG under `build/qa/shots`, `npm run qa --
eval` and `npm run qa -- reload` act on the live page, and `npm run qa -- stop` quits the app and
removes the temporary database. Use this harness when a check depends on preload IPC, persistence,
recovery or native layout; it boots more slowly than the browser preview.

Local installers remain unsigned and have no published automatic-update channel. Packaging does
not publish. Existing database files stay outside the repository and are not reset by source cleanup.
