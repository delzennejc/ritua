import { PushPin } from '@phosphor-icons/react'
import { normalizedChannel } from '../../../../domain/backlog-organization'
import { Dropdown } from './Dropdown'

export function TaskProjectAction({ tasks, projects, onAssign, bulk = false }) {
  const channels = new Set(tasks.map((task) => normalizedChannel(task.channel)))
  const availableProjects = projects.filter(
    (project) => !project.complete && channels.size === 1 && channels.has(normalizedChannel(project.channel)),
  )
  const currentProject = !bulk && projects.find((project) => project.id === tasks[0]?.objectiveId)
  const label = bulk
    ? 'Add selected tasks to project'
    : `Project for ${tasks[0].title}: ${currentProject?.title || 'No project'}`

  return (
    <Dropdown
      label={label}
      title="Add to project"
      disabled={!tasks.length}
      triggerTitle={bulk ? label : `Move to project (${currentProject?.title || 'No project'})`}
      className={bulk ? 'backlog-bulk-project' : 'backlog-project-action'}
      triggerClassName={
        bulk ? 'toolbar-trigger' : `backlog-project-trigger ${currentProject ? 'assigned' : ''}`
      }
      menuWidth={280}
      trigger={
        <>
          <PushPin size={15} mirrored aria-hidden="true" />
          {bulk ? 'Add to project' : null}
        </>
      }
      items={
        availableProjects.length
          ? availableProjects.map((project) => ({
              id: project.id,
              label: project.title,
              icon: <PushPin size={15} mirrored />,
              checked: tasks.every((task) => task.objectiveId === project.id),
              onSelect: () => onAssign(project.id),
            }))
          : [
              {
                id: 'empty',
                label:
                  channels.size > 1 ? 'Select tasks from the same Area' : 'No active projects in this Area',
                disabled: true,
              },
            ]
      }
    />
  )
}
