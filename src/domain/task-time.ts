type TaskTime = {
  minutes?: number | null
  actualMinutes?: number | null
  complete?: boolean
}

// Completed work uses its duration unless the user has logged an explicit value.
// Derive this for reviews without writing an estimate into the actual-time field.
export function taskWorkedMinutes(task: TaskTime): number {
  return task.actualMinutes ?? (task.complete ? (task.minutes ?? 0) : 0)
}

export function taskTimeTotals(tasks: readonly TaskTime[]) {
  return tasks.reduce(
    (totals, task) => ({
      actual: totals.actual + taskWorkedMinutes(task),
      planned: totals.planned + (task.minutes ?? 0),
    }),
    { actual: 0, planned: 0 },
  )
}
