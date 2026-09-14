# Desktop architecture

Ritua is a standalone Electron application. `src/renderer/src/app` owns the production
interface. The separate browser prototype is a design reference, never a build or runtime dependency.

## State and action flow

React interaction → feature action → domain operation → renderer session → typed preload →
authenticated IPC handler → SQLite transaction.

SQLite owns durable truth. `desktop/workspace-session.ts` stages and publishes validated canonical
documents. The Zustand store contains that document and lifecycle status; it does not store independently
editable task pools. Memoized projections are derived from the document, frozen against accidental
mutation, and retain unchanged collection references. Invalid commands leave the last valid document intact.
Synchronous commands notify React once, without exposing intermediate partial actions.

Production command APIs accept and return `WorkspaceDocument`. Common task, calendar, session, Area,
completion and deletion commands edit canonical entities directly. Immer transactions preserve untouched
records and discard rejected edits. Ordered collection rules (project organization, recurrence generation
and backlog subsets) use `workspace-collection-command.ts`: it reconciles changed view records without
JSON serialization and retains existing entity identities. There is no writable whole-fields API in the
renderer. View-shaped fixture adapters exist only under `src/tests`.

`desktop/workspace-store.ts` supplies React hooks and browser lifecycle adapters. `useWorkspaceProjection`
reads task lists and calendar views without exposing setters. `useWorkspaceState` handles persisted
preferences and collection metadata through `changeWorkspaceField`; project ordering or metadata edits
cannot write shared task content through project references. Input drafts, selection, focus and drag
presentation remain renderer concerns. `getWorkspaceFields()` derives from the latest staged document,
so consecutive actions do not read an older React render.

`App.jsx` composes the existing interface and connects feature controllers. `useWorkspaceNavigation`
owns navigation, panel preferences and date-focus requests. `useWorkspaceCollections` connects views to
shared data at their boundary; `useWorkspaceTaskActions` supplies shared interactions through one
explicit context. These values no longer travel through repeated page and panel props. Right-panel
panes live separately under `components/right-panel`. `app/hooks` owns creation, details navigation,
organization and scheduling orchestration. `app/interactions`
separates board and collection projections, drag presentation, gesture lifecycle and drop routing.
Task details editors live in `app/components/task-details`.

## Domain ownership

- `models.ts`: concrete task, project, area, recurrence and calendar variants.
- `workspace-types.ts`: JSON transport/storage records; the stored representation remains unchanged.
- `workspace-fields.ts`: persisted keys and shared task content fields.
- `workspace-projection.ts`: normalization, projections and change batches.
- `workspace-validation.ts`: incoming data, document and revision validation.
- `task-commands.ts`, `task-creation.ts`, `task-detail-commands.ts`: typed creation, location, ownership,
  completion, comments and subtask commands.
- `task-editing.ts`, `task-deletion.ts`, `task-scheduling.ts`, `task-recurrence.ts`, `task-area.ts`: task operations
  and operation-specific Undo.
- `calendar-commands.ts`: calendar edits and their canonical task timing/date consequences.
- `workspace-commands.ts`: permitted metadata and collection edits, preserving canonical task content.
- `task-validation.ts`: validation of nested task data before typed selectors consume it.
- `area-commands.ts`, `project-commands.ts`, `backlog-organization.ts`, `backlog-commands.ts`: organization rules.
- Existing completion, session and planning modules retain their respective business rules.

Domain code imports no React, renderer, Electron or database modules. Business operations receive
context such as dates, actor names and generated identifiers from their caller. JSON access is
concentrated in serialization/validation and projection selectors; typed operations use business
shapes. Extend these operations when adding behavior rather than updating each view separately.

Task deletion captures removed entities, project references and session membership. Undo restores
those records into the current workspace, preserving unrelated edits and newly created work.
Project removal similarly records its links and positions. Undo respects later reassignment, and Area-move
Undo preserves subsequent task details rather than replacing the task with an old snapshot. Existing snackbar and Undo behavior
is retained; this is not a new global history stack.

## Saving and native boundaries

The renderer session keeps canonical documents throughout staging, gesture snapshots, saving and recovery.
It performs no normalize/project round-trip or whole-document JSON comparison. Validation checks new
immutable payloads once and checks identity/reference relationships on every edit. Native IPC still validates
all incoming data independently. Entity comparison caches serialized immutable records; unchanged entities
are compared by reference.

The renderer session serializes saves, retains request IDs after uncertain acknowledgements,
merges independent concurrent changes, and exposes unresolved conflicts. Recovery checkpoints
use the pre-gesture snapshot while a drag is active. Checkpoints are serialized in order and unchanged
successful checkpoints are skipped; a failed write remains retryable. Closing waits for media imports and input
blur, restores an unfinished gesture, then checkpoints and flushes.

`main/ipc/register.ts` authenticates the sender before dispatching every request. Workspace,
media, backup and update handlers have separate modules. Handler inputs are `unknown` until
validated. Main owns native dialogs and lifecycle coordination; the renderer never imports SQL
or Electron. Recovery writes validate every non-null payload before touching the journal.

## Storage and defaults

`main/db/initialize-schema.ts` initializes the current five-table schema; `schema.ts` supplies
Drizzle mappings. There are no historical migrations or compatibility layers. This cleanup does
not change the schema or saved-data layout. Work and Personal are the initial Areas, with empty
work lists. Fixtures live under `src/tests` and are loaded only with explicit test mode and an
isolated data directory.

Revisions and receipts protect atomic commits and retries. Backups include attachment bytes and
are validated before restore. Settings remains removed. Local packaging does not publish a release.

## Checks

`npm run build` runs architecture checks, targeted JavaScript lint, strict TypeScript and the
production build, including unused TypeScript binding checks. `npm test` runs pure unit tests and the Electron integration suite. Formatting
is enforced with `npm run format:check`; `npm run check:whitespace` checks the diff.

Architecture checks reject native imports in the renderer and framework/native imports in the
domain, and reject task-list setter plumbing, whole-fields publication and old command inputs in UI code. UI behavior is checked in the hidden in-app Browser; persistence and native lifecycle
behavior are checked in Electron. See `verification.md` for commands and coverage.

## Projection performance

Projection indexes entities by kind and task location in one pass, then sorts each list once.
It does not scan every task separately for every dated list. Calendar session views read the document's
canonical task entities directly instead of normalizing a projection on each render. Immutable projections
reuse unchanged tasks and collections without deep string comparisons; preference-only edits reuse the
entity-derived collections without traversing their tasks.

`npm run profile:workspace` generates isolated 1,000- and 10,000-task workloads under `src/tests`.
See `performance.md` for the measured scope and results; timings are diagnostic, not machine-independent
pass/fail budgets. Transport records remain JSON at storage/recovery boundaries; business command inputs
use concrete types and explicit action context.
