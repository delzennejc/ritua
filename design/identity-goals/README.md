# Ritua · Identity & Goals concepts

Five standalone, offline HTML concepts grounded in the current production UI. Open index.html to compare them, or open any concept directly. Every concept embeds its CSS, JavaScript, Ritua logo and Phosphor icons. Preview images are used only by the gallery.

## Directions

1. **The compass** — Identity and goals together in a quiet, two-column overview. (01-compass.html)
2. **Identity board** — Each identity becomes a home for the goals that express it. (02-identity-board.html)
3. **Goal workspace** — One goal connects intention, recurring practice, and real results. (03-goal-workspace.html)
4. **The horizons** — Separate your current commitments from future possibilities. (04-horizons.html)
5. **Living notebook** — A personal document that evolves through goals and reflection. (05-notebook.html)

## Prototype behavior

- Sample data is isolated from the application; no production modules import these concepts.
- Changes live in page memory and reset when reloaded.
- No AI integration, account, analytics, network requests, or durable application storage.
- Identity is user-authored and mutable. Progress applies to outcomes, never to a person’s identity.
- In the goal workspace, confirming a practice and updating an outcome are separate actions.
- Example dates are anchored to September 30, 2026.

## Regenerate

From the repository root: node design/identity-goals/generate.mjs

The generator uses existing React and Phosphor packages only at build time. Generated pages require no packages.
