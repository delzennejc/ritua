# Ritua

A local Electron application with React, Zustand, Drizzle and SQLite.

## Development

Requires Node.js 22.13+ (22.x), or Node.js 24+ and npm:

```sh
cd ~/ritua
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron with hot reload, renderer port 5174 |
| `npm run dev:browser` | Browser preview on port 5175, without native persistence |
| `npm run verify:architecture` | Check source dependency boundaries |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Verify architecture, typecheck and build |
| `npm test` | Build and run native regression tests in temporary profiles |
| `npm run package:release` | Build Apple Silicon DMG and ZIP in `release-staging` |
| `npm run release:next` | Increment the last version number and build a local release |
| `npm run release:minor` | Explicitly increment the middle version number and build a local release |

## Source

- `src/renderer/src/app`: views, components and styles.
- `src/renderer/src/desktop`: persistence hydration and native UI adapters.
- `src/domain`: canonical records, defaults, task and recurrence operations.
- `src/main`: native lifecycle, validated commands, backups and storage.
- `src/main/db`: current schema and direct first-launch initialization.
- `src/tests`: native integration tests and small current-schema fixtures.

The desktop builds independently of the separate browser prototype. It has no historical
schema migrations, demo-data imports, old planner support or source-migration adapters.

## Storage and first launch

A new workspace starts on the local date with Work and Personal and no tasks or Projects.
`initialize-schema.ts` directly creates the current tables: `app_metadata`,
`workspace_entities`, `workspace_state`, `workspace_receipts` and `attachments`.
`schema.ts` defines their typed Drizzle mappings. Restarting does not reseed records.

The database is `workspace.sqlite` in `~/Library/Application Support/Ritua/` for packaged
builds, or `Ritua Development/` during development. `RITUA_DATA_DIR` overrides the directory
for isolated work. Files from earlier development builds are not discovered or imported.

Typed changes save related records atomically. Revision checks prevent stale writes and
request receipts make retries safe. Save errors retain visible edits. Close/quit flushes
pending work, with recovery choices if saving fails. A single instance per data directory
prevents competing writers. Recurrence continues as dates advance; individual exceptions
and deletions retain their identity.

Use File → Back Up Now, Export Backup or Restore Backup for workspace copies. Restoring
first backs up current work. Automatic backups run at startup and every 30 minutes.
Attachments are limited to 25 MB each and 512 MB total. Canceled selections are released;
unused files are reclaimed after 24 hours, protecting saved work, recovery and active drafts.

The Settings interface is intentionally absent pending redesign. Profile storage, archive
restoration and update commands remain available underneath it.

## Installation and release

Routine releases use `npm run release:next`. Only the last number advances:
`0.1.6 → 0.1.7 → … → 0.1.9 → 0.1.10 → … → 0.1.100`.
It has no fixed digit width, no leading zeros, and no rollover at 9, 99, or 999.
The middle and first numbers change only when explicitly requested by the user.
Use `npm run release:minor` for a deliberate middle-number change, such as
`0.1.100 → 0.2.0`.

Both commands keep `package.json` and `package-lock.json` versions synchronized
without creating a Git commit or tag. They increment before building. To retry
a failed build or rebuild the same version, use `npm run package:release`.
Release artifacts are built locally; installation and publication are separate steps.

Open the generated DMG and drag Ritua into Applications. Local builds are unsigned and not
notarized. Quit the app before replacing its bundle; database files are outside the bundle.

For a signed release, configure Apple signing/notarization credentials and set
`RITUA_SIGNED_RELEASE=1` plus `RITUA_UPDATE_URL=https://your-release-host/path/` before
`npm run package:release`. Packaging never publishes. Publish the generated artifacts and
update metadata together only after review. No automatic update channel is configured in
local builds. The update commands save and back up work before installation.

To test a packaged build, set `RITUA_TEST_EXECUTABLE` to its `Contents/MacOS/Ritua` executable
and run `node scripts/smoke.mjs`. Packaged test mode requires both `RITUA_TEST_MODE=1` and an
explicit `RITUA_DATA_DIR`; the script supplies disposable profiles and cleans them afterward.

See [architecture](docs/architecture.md) and [verification](docs/verification.md).
