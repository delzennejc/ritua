import { createContext, useContext, useId, useRef, useState } from 'react'
import { FolderSimple } from '@phosphor-icons/react'
import { Dropdown } from './Dropdown'
import { FolderLabel, useAreaColor } from './FolderLabel'
import { TaskActionConfirmation } from './TaskActionConfirmation'

const TaskAreaActionsContext = createContext(null)

export function TaskAreaActionsProvider({ areas, projects, onMove, children }) {
  return (
    <TaskAreaActionsContext.Provider value={{ areas, projects, onMove }}>
      {children}
    </TaskAreaActionsContext.Provider>
  )
}

export function TaskAreaAction({ task }) {
  const actions = useContext(TaskAreaActionsContext)
  const [open, setOpen] = useState(false)
  const [pendingArea, setPendingArea] = useState(null)
  const triggerRef = useRef(null)
  const id = useId()
  const channel = task.channel
  const project = actions?.projects.find((item) => item.id === task.objectiveId)
  const projectChannel = project?.channel
  const projectColor = useAreaColor(projectChannel || channel)
  const close = (restoreFocus = false) => {
    setPendingArea(null)
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  if (!actions) return <FolderLabel channel={task.channel} className="task-folder" />

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        className="task-folder"
        triggerClassName="task-area-picker"
        triggerTitle={`Move to another Area (${channel})`}
        label={`Area for ${task.title}: ${channel}`}
        title="Areas"
        trigger={<FolderLabel channel={task.channel} />}
        items={actions.areas.map((area) => ({
          id: area.id,
          label: area.label,
          icon: <FolderSimple size={15} weight="fill" style={{ color: area.color }} />,
          role: 'menuitemradio',
          checked: area.label === channel,
          onSelect: () => {
            if (area.label === channel) return
            if (project && projectChannel !== area.label) {
              setPendingArea(area)
              return
            }
            actions.onMove(task.id, area.label)
          },
        }))}
      />
      {pendingArea ? (
        <TaskActionConfirmation
          id={id}
          triggerRef={triggerRef}
          title={`Move task to ${pendingArea.label}?`}
          description={
            project ? (
              <>
                It will be <strong className="task-area-removal">removed</strong> from the{' '}
                <strong className="task-area-project-name" style={{ '--project-color': projectColor }}>
                  {project.title}
                </strong>{' '}
                Project.
              </>
            ) : undefined
          }
          confirmLabel="Move"
          onClose={close}
          onConfirm={() => actions.onMove(task.id, pendingArea.label, { unlinkFromProject: true })}
        />
      ) : null}
    </>
  )
}
