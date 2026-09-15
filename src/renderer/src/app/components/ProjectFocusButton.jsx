import { Star } from '@phosphor-icons/react'

export function ProjectFocusButton({ project, onToggle }) {
  const focused = project.focusedThisWeek !== false
  const label = `${focused ? 'Unfocus' : 'Focus'} ${project.title}`
  return (
    <button
      type="button"
      className="project-focus-button"
      aria-label={label}
      aria-pressed={focused}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(project.id)
      }}
    >
      <Star size={17} weight={focused ? 'fill' : 'regular'} aria-hidden="true" />
    </button>
  )
}
