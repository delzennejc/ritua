# Desktop architecture

The desktop is a standalone application at `~/ritua`. The browser prototype is a
separate design reference and is not imported at build time or runtime.

## Data flow

React views → Zustand projections → typed preload commands → Electron main → Drizzle/SQLite.

`src/domain/workspace.ts` defines canonical records and validated atomic change batches.
Task identity is shared across lists, calendars and Project references. Domain task and
recurrence operations do not depend on React or Electron. Local input drafts stay in React;
durable changes use the canonical store and native save queue.

## Storage

`src/main/db/initialize-schema.ts` initializes a new database directly from the current
five-table schema. `schema.ts` supplies Drizzle mappings. There are no historical SQL
migrations, obsolete tables, sample imports or compatibility layers. The only database
path is `workspace.sqlite` in the selected data directory. Work and Personal are the only
initial Areas; all work lists start empty. Test fixtures are constructed separately.

Revisions and request receipts protect against conflicting writes and uncertain acknowledgements.
Recovery journals retain pending edits. Backups include attachment bytes and are validated
before restore. Native close/update operations flush the renderer before proceeding.

## Source boundaries

- `renderer/src/app`: production UI and styles.
- `renderer/src/desktop`: hydration, recovery feedback and native UI adapters.
- `domain`: pure records, defaults and operations.
- `main`: Electron lifecycle, storage and narrow validated commands.
- `tests`: isolated current-schema fixtures and native integration tests.

`verify:architecture` prevents inappropriate imports. Native tests cover fresh initialization,
restart, task/Project changes, scheduling, recurrence, Undo, attachments and recovery.
Settings UI remains removed pending redesign. Signed release delivery requires a configured
release host and Apple credentials; local packaging does not publish.
