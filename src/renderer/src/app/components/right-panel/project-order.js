export const isFocusedThisWeek = (objective) => objective.focusedThisWeek !== false

export function orderObjectivesForPanel(objectives, weeklyFocusedObjectives = []) {
  const focusedOrderIndex = new Map(weeklyFocusedObjectives.map((objective, index) => [objective.id, index]))
  return [
    ...objectives
      .filter(isFocusedThisWeek)
      .sort(
        (first, second) =>
          (focusedOrderIndex.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
          (focusedOrderIndex.get(second.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    ...objectives.filter((objective) => !isFocusedThisWeek(objective)),
  ]
}
