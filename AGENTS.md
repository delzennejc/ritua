# Desktop application instructions

- Production UI lives in `src/renderer/src/app`. Preserve its layout, styles and behavior.
  `../ritua-ui/Ritua/prototype` is a separate design reference, not a build or runtime dependency.
- Keep strict TypeScript for native boundaries and domain code. Existing JSX components
  do not need a file-extension rewrite. Keep Electron and SQL imports out of the renderer.
- SQLite owns durable truth. Zustand holds renderer projections; all task views must derive
  from canonical entities. Preserve atomic saves, revision checks, recovery and Undo.
- Expose narrow typed preload commands. Validate IPC senders and all incoming data.
- Keep domain logic independent of React, Electron, SQL and renderer modules.
- Test-only code and fixtures belong under `src/tests`, loaded only in explicit test mode.
- New installations initialize the current five-table schema through
  `src/main/db/initialize-schema.ts`. There is no migration history or compatibility layer.
  Keep its SQL aligned with `schema.ts`; schema changes require a deliberate design decision.
- Production defaults are Work and Personal with empty work lists. Never seed test fixtures
  in normal startup or import fixtures into renderer/domain code.
- Use Phosphor icons and the established application styles. Settings UI was removed at
  the user's request; do not reintroduce it without a new design.
- Reuse the closest existing production UI component before introducing a control style.
  Task pickers use the shared Dropdown/Area selection pattern; progress indicators should
  reuse the applicable existing component. Verify affected screens visually before
  declaring a UI change complete; passing builds and tests alone is not design approval.
- Respect reduced motion, focus, cancelable gestures and the close/save handshake.
- Run `npm run build`, `npm test` for persistence/IPC/lifecycle changes and whitespace checks.
  Use the hidden in-app Browser for visual QA and Electron for native integration.
- Do not modify the separate browser prototype as a side effect of desktop work.
- Routine releases use `npm run release:next` and increment only the last version
  number, with no leading zeros or rollover at 9, 99, or 999. Change the middle or
  first number only when the user explicitly requests it. `npm run release:minor`
  is the explicit middle-number bump. Use `npm run package:release` to retry a
  failed build or rebuild the current version without incrementing again.
