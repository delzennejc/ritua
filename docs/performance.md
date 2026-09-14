# Workspace performance

Run `npm run profile:workspace` with the repository's Node runtime. Fixtures exist only in
`src/tests/workspace-profile.ts`; the command does not load or modify a user's database.
Each operation warms up once, then records seven samples. The reported p95 is the maximum
of these seven samples, so use it as a diagnostic tail measurement rather than a statistical guarantee.

Measured locally on Node 24.19.0 during the canonical-command refactor:

| Workload | Operation | Before median | After median |
| --- | --- | ---: | ---: |
| 1,000 tasks / 100 dates | Project views | 2.15 ms | 1.28 ms |
| 10,000 tasks / 1,000 dates | Project views | 120.78 ms | 13.87 ms |
| 10,000 tasks / 1,000 dates | Edit task + normalize/project | 183.52 ms | 50.36 ms |
| 10,000 tasks / 1,000 dates | Normalize | 37.55 ms | 38.49 ms |

The 10,000-task document is approximately 2.46 MB. Each task has one subtask. The optimization
replaces a full task scan for each date with a single index by location. The unchanged normalization
cost helps isolate the projection improvement.

These are pure-domain CPU measurements, not end-to-end UI or disk-save latency. React rendering,
validation, immutable session snapshots, recovery journaling, attachments and SQLite are not included.
Those first-pass measurements motivated the canonical document edit pass below.


## Canonical document edit pass

Measured locally on Node 24.19.0 after eliminating the renderer's field/document round-trips.
The workload and seven-sample method above are unchanged. The canonical document is frozen before
measurement. Every renderer edit changes the title again, so the measurements include actual edits.

| Workload | Canonical task edit | Renderer edit + validation + projection | Commit comparison | Recovery payload JSON |
| --- | ---: | ---: | ---: | ---: |
| 1,000 tasks / 100 dates | 0.80 ms | 1.64 ms | 0.57 ms | 0.80 ms |
| 10,000 tasks / 1,000 dates | 7.55 ms | 16.53 ms | 6.51 ms | 8.68 ms |

The 10,000-task renderer edit p95 (maximum of seven samples) was 17.02 ms. The current canonical
command measurement replaces the earlier edit + normalize/project path; its scope is different from
that earlier 50.36 ms domain measurement. The renderer measurement now also includes staging,
validation, immutable records and projection selection. It still excludes React rendering, browser
layout/paint, IPC transfer and disk I/O. It is not a frame-rate guarantee.

Common commands change canonical records directly and preserve the rest by reference. Projection
reuse and commit comparison avoid whole-document JSON comparisons. Frozen payloads are checked once,
while task identity and cross-record references are checked on every edit. Preference-only changes
reuse task collections. Collection operations reconcile ordered view records without JSON round-trips.

Durability still requires serializing recovery snapshots at the persistence boundary. That deliberate
I/O cost is shown separately above. Recovery writes are ordered, identical successful checkpoints are
skipped, and failures remain retryable. No schema, journal format or revision guarantees were relaxed.
