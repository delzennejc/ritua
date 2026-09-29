// Explicit, additive native-development fixture. Never imported by application startup.
import * as store from '../renderer/src/desktop/workspace-store'
import { normalize } from '../domain/workspace'
import { addDays, localDateKey } from '../domain/calendar-dates'

export async function addDailyPlanningSamples(testMode) {
  if (!import.meta.env.DEV || !window.ritua || testMode !== 'append-native-planning-samples')
    throw new Error('This fixture requires an explicit native development test invocation.')
  await store.initializeWorkspace()
  await store.flushBeforeClose()
  const backup = await window.ritua.createBackup()
  const before = store.getWorkspaceDocument()
  const yesterday = addDays(localDateKey(), -1)
  const task = (id, title, channel = 'Work', extra = {}) => ({
    id: `native-planning-sample-${id}`,
    title,
    channel,
    complete: false,
    ...extra,
  })
  const completed = [
    task('done-1', 'Share the first onboarding prototype'),
    task('done-2', 'Send the revised estimate to the client'),
    task('done-3', 'Resolve last week’s navigation feedback'),
    task('done-4', 'Prepare questions for customer interviews'),
    task('done-5', 'Send the updated project brief'),
    task('done-6', 'Go for a run by the river', 'Personal'),
    task('done-7', 'Book the dentist appointment', 'Personal'),
    task('done-8', 'Take a walk after lunch', 'Personal'),
  ].map((item) => ({ ...item, complete: true, completedDateKey: yesterday }))
  const unfinished = [
    task('carry-1', 'Review the launch checklist with the team'),
    task('carry-2', 'Reply to the outstanding client questions'),
    task('carry-3', 'Outline the September retrospective'),
    task('carry-4', 'Return the library books', 'Personal'),
  ]
  const anytime = [
    task('any-1', 'Finish the onboarding proposal'),
    task('any-2', 'Review the new illustrations'),
    task('any-3', 'Write a short update on this week’s priorities'),
    task('any-4', 'Review the copy for the new pricing page'),
    task('any-5', 'Tidy up the research notes from the last five customer interviews'),
    task('any-6', 'Send invoices for September'),
    task('any-7', 'Gather feedback from the team'),
    task('any-8', 'Order coffee and groceries', 'Personal'),
    task('any-9', 'Plan dinners for the week', 'Personal'),
    task('any-10', 'Call Alex about Saturday', 'Personal'),
    task('any-11', 'Find a birthday gift for Emma', 'Personal'),
    task('any-12', 'Book a weekend away', 'Personal'),
  ]
  const fixture = normalize({
    datedTasksByDate: { [yesterday]: [...completed, ...unfinished] },
    backlogGroups: [{ id: 'anytime', label: 'Anytime', items: anytime }],
  })
  const keys = new Set(before.entities.map((e) => `${e.kind}:${e.id}`))
  const additions = fixture.entities.filter((e) => !keys.has(`${e.kind}:${e.id}`))
  const laneOffsets = new Map()
  for (const e of before.entities) {
    if (e.kind !== 'task') continue
    laneOffsets.set(e.data.lane, Math.max(laneOffsets.get(e.data.lane) ?? 0, Number(e.data.position) + 1))
  }
  for (const e of additions) e.data.position += laneOffsets.get(e.data.lane) ?? 0
  const groups = before.fields.backlogGroups ?? []
  store.replaceWorkspaceDocument({
    ...before,
    entities: [...before.entities, ...additions],
    fields: {
      ...before.fields,
      view: 'planning',
      planningStep: 0,
      dateKeys: [...new Set([...(before.fields.dateKeys ?? []), yesterday])],
      backlogGroups: groups.some((group) => group.id === 'anytime')
        ? groups
        : [...groups, { id: 'anytime', label: 'Anytime' }],
    },
  })
  await store.flushWorkspace()
  const saved = await window.ritua.loadWorkspace()
  const savedByKey = new Map(saved.entities.map((e) => [`${e.kind}:${e.id}`, e]))
  const preserved = before.entities.every(
    (e) => JSON.stringify(savedByKey.get(`${e.kind}:${e.id}`)) === JSON.stringify(e),
  )
  if (!preserved || additions.some((e) => !savedByKey.has(`${e.kind}:${e.id}`)))
    throw new Error('The saved workspace did not match the additive fixture.')
  return {
    added: additions.length,
    originalEntitiesPreserved: preserved,
    backupId: backup.id,
    revision: saved.revision,
  }
}
