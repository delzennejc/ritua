# Ritua desktop — current verification

The application starts from its current schema, without historical migrations or import
layers. Fresh databases contain only the five current tables and the Work and Personal Areas.

Verified with `npm test`: current-schema initialization and restart, canonical record
roundtrips, task/Project creation, scheduling and drag resize, recurring work, Undo,
attachment export, backups, interrupted saves and recovery. Fixtures are created only by
tests. Production startup does not load them. Settings UI remains removed.

Local installers are unsigned and have no published automatic-update channel. Packaging
does not publish. Local database files are outside the repository and were not reset by
the source cleanup. The selected filename is `workspace.sqlite`; earlier development
filenames are not searched or imported.
