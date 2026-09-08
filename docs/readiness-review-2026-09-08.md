# Ritua production-readiness review — 2026-09-08

Historical review retained for its findings and suggestions. Several findings were subsequently fixed; see verification.md for the current baseline. File links point to their current locations.
Reviewer: GPT-6 Astra, Medium reasoning, independent read-only subagent. Scope: current desktop source and prototype correspondence; local daily use and general distribution assessed separately. Coordinator independently ran the existing build/native suite. No app implementation, real workspace data, or running user app was changed during this review. This report preserves bugs, risks, suggestions and acceptance criteria for coordination.

## Verdict

Credible local beta; not yet production ready. Resolve deletion consistency and recoverable archives before relying on the app as a sole daily planner. Recurrence exception isolation and attachment lifecycle also belong in the first reliability milestone. Distribution additionally needs installation/update/release work. This broader review identifies gaps missed by the previous targeted review; the earlier approval is not an exhaustive guarantee.

## Verification and limits

- Current source provenance verification, TypeScript checks and production build passed.
- First `npm test` failed while waiting for the Task recurrence control. The details panel appeared to show a different fixture title. A test locator/timing issue is possible; a product cause has not been ruled out.
- Immediate unchanged `node scripts/smoke.mjs` retry passed. Record this as an intermittent verification failure, not uniformly green verification and not a confirmed recurrence product defect.
- Logs: `/private/tmp/ritua-readiness-review-20260908.log` and `/private/tmp/ritua-readiness-review-retry-20260908.log`.
- Reviewer reproduced task resurrection and recurrence-template propagation with domain modules bundled in memory using esbuild. Those were not full UI/restart reproductions.
- No exhaustive native interaction, accessibility, performance, clean-machine or release-distribution audit was performed. Packaged tests were not rerun in this review.

## Priority findings

### R1 · P1 · Deleted tasks can be recreated by archived Project references

**Evidence:** confirmed domain reproduction and source-traced UI path. Archiving a Project retains its original task members; task deletion filters active `weeklyObjectives` only. Normalization processes active, archived and accomplished Project collections and recreates missing canonical tasks from their members.

**Trigger/impact:** archive a Project containing a scheduled task, then delete that task from Board/Details. The archived member survives and recreates the task in a hidden Project-only lane. In the reproduction, deleted task `t` returned in `project:archivedObjectives:p`. The same normalization behavior applies to accomplished Project members.

**References:** [archive members](../src/renderer/src/app/App.jsx), [deletion](../src/renderer/src/app/App.jsx), [normalization](../src/domain/workspace.ts).

**Proposed fix/acceptance:** define canonical deletion across active, archived, accomplished and historical references. Reproduce archive → delete task → save → restart; assert the task remains deleted everywhere. Verify Undo restores intended links without creating duplicates.

### R2 · P2 · Archives lack durable user recovery

**Evidence:** source-confirmed. Area archive removes the Area from `areas`, retains associated work and creates neither an archived Area record nor Undo. Project archives are persisted, but their read value is discarded and there is no archive browser; immediate Undo is the normal restoration route. Success toast calls are disabled, so they do not supply recovery or meaningful feedback.

**Impact:** accidental Area archive loses identity, order and color, and removes associated Project navigation. “Archive” currently implies more recoverability than the UI provides.

**References:** [Area archive](../src/renderer/src/app/App.jsx), [Project archive state](../src/renderer/src/app/App.jsx).

**Proposed fix/acceptance:** persist archived Areas and Projects, provide browse/restore controls and consistent confirmation/Undo. Restore after restart and verify identity, color, order, tasks and Project links.

### R3 · P2 · A one-off recurrence edit can change later generated tasks

**Evidence:** confirmed domain reproduction. Each save chooses the highest-index occurrence and overwrites the series definition from it, including an occurrence marked `recurrenceEdited`. Renewal copies that definition.

**Trigger/impact:** rename the last materialized occurrence, typically about a year ahead, to “One-off changed title.” The next newly generated occurrence inherits that one-off title. The independent series definition is therefore not fully independent of exceptions.

**References:** [template update](../src/domain/recurring-workspace.ts), [generation](../src/domain/recurring-workspace.ts).

**Proposed fix/acceptance:** separate series defaults from occurrence exceptions and define explicit “this occurrence / this and following” content edits. Change the last occurrence, extend the horizon and restart; ordinary future occurrences must retain series defaults.

### R4 · P2 · Abandoned attachments permanently consume storage quota

**Evidence:** source-confirmed. Choosing a file inserts bytes before comment submission. Replacement, closing the editor, or deleting the associated task has no blob deletion/garbage-collection path.

**Impact:** abandoned 25 MB selections can exhaust the 512 MB workspace limit without any visible attachments available to remove.

**References:** [native insertion](../src/main/index.ts), [picker](../src/renderer/src/desktop/Attachments.tsx), [quota](../src/main/db/database.ts).

**Proposed fix/acceptance:** stage pending files or reclaim unreferenced blobs after a safe Undo period; add storage usage and removal controls. Cover canceled/replaced selections, deleted comments/tasks, Undo, restart and backup/restore without removing still-referenced files.

### R5 · Verification gate · Resolve intermittent native regression failure

First run failed opening repeat controls; unchanged retry passed. Scope locators to the intended task dialog and determine whether timing, fixture targeting or application behavior caused the failure. Retain regression coverage for R1–R4. A passing retry alone does not explain the failure.

## All retained suggestions and risks

| ID | Suggestion or risk | Evidence/status | Proposed direction |
| --- | --- | --- | --- |
| S1 | Backup retention and visibility | Only 14 `auto` snapshots retained at startup/every 30 minutes: roughly seven hours of continuous running, potentially less with restarts. All automatic copies are on the same disk. Startup/manual/export snapshots are not covered by that retention rule. [Retention](../src/main/recovery-files.ts), [timer](../src/main/index.ts). | Add daily/weekly retention, latest successful backup status, configurable external/export destination and cleanup policy for accumulating snapshots. Retain current verified copies, hashes, before-restore snapshots and recovery journals. |
| S2 | Future recurrence visibility | Calendar navigation exceeds the roughly one-year generation horizon. An empty far-future calendar may be misleading. [Horizon](../src/domain/recurring-workspace.ts). | Materialize the viewed range or clearly show the generation boundary. Test finite endings and edit/delete combinations separately. |
| S3 | Historical ritual retrieval | Rollover saves daily/weekly drafts in `ritualHistory`, but there is no history browser. [Rollover](../src/domain/live-calendar.ts). | Read-only past rituals, with optional restoration/export. |
| S4 | Day rollover and overdue work | Focus/visibility/timer checks defer while an editor/dialog is active. This protects editing but can defer Today for a long time; not a reproduced bug. [Refresh](../src/renderer/src/desktop/workspace-store.ts). | Define overdue/carry-forward behavior; test timezone changes, week boundaries and long-running dialogs. |
| S5 | Weekly-review task identity | Accomplished-task synchronization matches normalized titles rather than canonical IDs. Same-title tasks from different Projects may affect displayed duration/completion. Source-derived risk, not runtime reproduced. [Matching](../src/renderer/src/app/views/weekly-planning/WeeklyPlanningView.jsx). | Use canonical task IDs and add duplicate-title cross-Project tests. |
| S6 | Attachment usability | Clicking an attachment exports it; no preview/open flow, quota display or management view. [Attachment link](../src/renderer/src/desktop/Attachments.tsx). | Make export labeling clear; consider safe preview/open and storage management. |
| S7 | Personalization and app identity | Hardcoded JC/avatar; default Electron icon and package-style native menu labels. Fine for a private JC build, misleading for other users. [Task identity](../src/renderer/src/app/components/TaskDetails.jsx), [Project identity](../src/renderer/src/app/components/ObjectiveDetails.jsx). | Local profile/settings, proper app icon and native naming. |
| S8 | Installation and updates | Minimal unpacked-app packaging; no configured publishing/updater/signing/notarization. [Packaging](../electron-builder.yml), [scripts](../package.json). | Define supported OS/architecture, signed/notarized distribution, release notes, update strategy, upgrade/rollback and clean-machine checks. Distribution work, not a prerequisite for every private local trial. |
| S9 | Long-term scale | Whole-document cloning/projection/normalization and retained recurrence history suggest a performance risk; no failure measured. | Benchmark realistic multi-year workspaces with many series, large notes and attachments. Measure responsiveness, saves, startup, backup and restore. |
| S10 | Behavioral parity confidence | Source provenance verifies copied files and declared adapters, not all behavior or product completeness. | Maintain a surface-by-surface acceptance checklist: capture, details, Project/Area changes, drag/resize, rituals, Undo, restart, recovery and archives; include keyboard/accessibility coverage. |
| S11 | Search, integrations and cross-device capture | Search, external calendar integration, sync, notifications and mobile capture are not automatically universal release blockers. | Prioritize according to intended usage; clearly position the supported local desktop product and avoid treating every suggestion as mandatory scope. |
| S12 | Contradictory documentation | README line 64 says real attachment storage is not included, while later text documents implemented binary storage. [README](../README.md). | Remove stale limitations and keep capabilities/test evidence aligned with current code. |

## Proposed coordination milestones

1. **Trustworthy daily use:** R1 canonical deletion, R2 recoverable archives, R3 isolated recurrence exceptions, R4 attachment lifecycle, R5 dependable native verification. Acceptance includes exact UI/save/restart/Undo sequences.
2. **Comfortable sustained local beta:** history/archive browsing, save/backup/storage visibility, longer backup retention, recurrence horizon clarity, canonical weekly-review identity, realistic scale and date-boundary QA.
3. **Distributable release:** profile/app identity, signed/notarized installation, versioned updates and migration recovery, clean-machine testing, documented support/privacy/local-data expectations. Decide optional integrations separately.

These are proposed work items for coordination, not implemented changes or promises of exhaustive readiness.
