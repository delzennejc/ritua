import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  CalendarBlank,
  CaretDown,
  Check,
  CalendarCheck,
  CalendarDots,
  Clock,
  Folder,
  GearSix,
  House,
  Plus,
  Stack,
  PushPin,
  UserCircle,
} from '@phosphor-icons/react'
import { AREA_COLOR_OPTIONS } from '../data/areaColors'
import { DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import { SortableCollectionItem, SortableCollectionLane } from './SortableCollection'
import { AutoGrowingTextarea } from './DetailsTitleInput'
import { Dropdown } from './Dropdown'
import rituaLogo from '../assets/ritua-logo.svg'

function DailyPlanningIcon(props) {
  const [day, setDay] = useState(() => new Date().getDate())

  useEffect(() => {
    const updateDay = () => setDay(new Date().getDate())
    const timer = window.setInterval(updateDay, 60_000)
    window.addEventListener('focus', updateDay)
    document.addEventListener('visibilitychange', updateDay)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateDay)
      document.removeEventListener('visibilitychange', updateDay)
    }
  }, [])

  return (
    <CalendarBlank {...props} aria-hidden="true">
      <text
        x="128"
        y="184"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="inherit"
        fontSize="100"
        fontWeight="600"
      >
        {day}
      </text>
    </CalendarBlank>
  )
}

const AREA_COLLECTION_ID = 'navigation-areas'
const AREA_LANE_ID = 'areas'
const AREA_SURFACE_ID = 'primary-navigation'

function ProjectTaskProgress({ tasks = [] }) {
  const completedTaskCount = tasks.filter((task) => task.complete).length
  const isComplete = tasks.length > 0 && completedTaskCount === tasks.length
  const progress = tasks.length ? completedTaskCount / tasks.length : 0

  return (
    <span aria-hidden="true" className={`project-task-progress ${isComplete ? 'complete' : ''}`}>
      {isComplete ? (
        <svg className="project-task-progress-check" viewBox="0 0 256 256">
          <path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <circle className="project-task-progress-track" cx="8" cy="8" r="7" />
          {progress > 0 ? (
            <circle
              className="project-task-progress-value"
              cx="8"
              cy="8"
              r="7"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - progress * 100}
            />
          ) : null}
        </svg>
      )}
    </span>
  )
}

export function RituaMenu({
  areas = DEFAULT_AREAS,
  objectives = [],
  onCreateArea,
  onCreateAreaProject,
  onNavigate,
  onOpenTaskScope,
  onReorderArea,
  onRestoreAreaOrder,
  taskScope = 'anytime',
  view,
  dailyComplete = false,
  weeklyComplete = false,
}) {
  const [areaDraftOpen, setAreaDraftOpen] = useState(false)
  const [areaDraftColorId, setAreaDraftColorId] = useState(
    () => AREA_COLOR_OPTIONS[areas.length % AREA_COLOR_OPTIONS.length].id,
  )
  const [areaDraftTitle, setAreaDraftTitle] = useState('')
  const [draftAreaId, setDraftAreaId] = useState(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [projectTooltip, setProjectTooltip] = useState(null)
  const areaDraftInputRef = useRef(null)
  const areaDraftReturnFocusRef = useRef(null)
  const projectDraftInputRef = useRef(null)
  const draftReturnFocusRef = useRef(null)
  const areaPointerIntentCleanupRef = useRef(null)
  const main = [
    { id: 'home', label: 'Home', icon: House },
    { id: 'today', label: 'Today', icon: Clock },
  ]
  const rituals = [
    { id: 'planning', label: 'Daily planning', icon: DailyPlanningIcon, done: dailyComplete },
    {
      id: 'weekly-planning',
      label: 'Weekly planning',
      icon: weeklyComplete ? CalendarCheck : CalendarDots,
      done: weeklyComplete,
    },
  ]

  const beginAreaPointerIntent = (areaScope, event) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return

    areaPointerIntentCleanupRef.current?.()
    const { clientX, clientY, pointerId } = event
    let moved = false
    const cleanup = () => {
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointercancel', cleanup, true)
      if (areaPointerIntentCleanupRef.current === cleanup) {
        areaPointerIntentCleanupRef.current = null
      }
    }
    const handlePointerMove = (pointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      moved = moved || Math.hypot(pointerEvent.clientX - clientX, pointerEvent.clientY - clientY) > 5
    }
    const handlePointerUp = (pointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      cleanup()
      if (!moved) onOpenTaskScope(areaScope)
    }

    document.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('pointercancel', cleanup, true)
    areaPointerIntentCleanupRef.current = cleanup
  }

  useEffect(() => () => areaPointerIntentCleanupRef.current?.(), [])
  const areaDraftColor =
    AREA_COLOR_OPTIONS.find((option) => option.id === areaDraftColorId) || AREA_COLOR_OPTIONS[0]

  useEffect(() => {
    if (draftAreaId) projectDraftInputRef.current?.focus()
  }, [draftAreaId])

  useEffect(() => {
    if (areaDraftOpen) areaDraftInputRef.current?.focus()
  }, [areaDraftOpen])

  const startProjectDraft = (areaId, returnFocusElement) => {
    setAreaDraftOpen(false)
    setAreaDraftTitle('')
    draftReturnFocusRef.current = returnFocusElement
    setDraftAreaId(areaId)
    setDraftTitle('')
  }

  const cancelProjectDraft = (restoreFocus = true) => {
    setDraftAreaId(null)
    setDraftTitle('')
    if (restoreFocus) {
      requestAnimationFrame(() => draftReturnFocusRef.current?.focus?.())
    }
  }

  const startAreaDraft = (returnFocusElement) => {
    cancelProjectDraft(false)
    areaDraftReturnFocusRef.current = returnFocusElement
    setAreaDraftOpen(true)
    setAreaDraftColorId(AREA_COLOR_OPTIONS[areas.length % AREA_COLOR_OPTIONS.length].id)
    setAreaDraftTitle('')
  }

  const cancelAreaDraft = (restoreFocus = true) => {
    setAreaDraftOpen(false)
    setAreaDraftTitle('')
    if (restoreFocus) {
      requestAnimationFrame(() => areaDraftReturnFocusRef.current?.focus?.())
    }
  }

  const submitAreaDraft = (event) => {
    event.preventDefault()
    const title = areaDraftTitle.trim()
    if (!title) return

    const createdArea = onCreateArea?.(title, areaDraftColor)
    if (!createdArea) return

    cancelAreaDraft(false)
    requestAnimationFrame(() => {
      document.querySelector(`[data-area-navigation-id="${createdArea.id}"]`)?.focus()
    })
  }

  const submitProjectDraft = (event) => {
    event.preventDefault()
    const title = draftTitle.trim()
    const area = areas.find((item) => item.id === draftAreaId)
    if (!title || !area) return

    onCreateAreaProject?.(area, title)
    cancelProjectDraft()
  }

  const showProjectTooltip = (title, target) => {
    const targetRect = target.getBoundingClientRect()
    setProjectTooltip({
      left: targetRect.left,
      maxWidth: Math.min(260, window.innerWidth - targetRect.left - 12),
      title,
      top: targetRect.top - 5,
    })
  }

  const NavItem = ({ item }) => {
    const Icon = item.icon
    const active = view === item.id

    return (
      <button
        className={`nav-item ${active ? 'active' : ''} ${item.done ? 'done' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(item.id)}
      >
        <Icon size={16} weight="regular" />
        <span>{item.label}</span>
        {item.done ? <Check className="nav-check" size={14} /> : null}
      </button>
    )
  }

  const TaskListItem = ({ id, icon: Icon, label }) => {
    const active = view === 'backlog' && taskScope === id

    return (
      <button
        className={`nav-item task-list-item ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onOpenTaskScope(id)}
      >
        <Icon size={16} weight="regular" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <>
      <aside className="sidebar ritua-menu">
        <Dropdown
          label="Ritua"
          className="workspace-menu"
          triggerClassName="workspace-switcher"
          menuWidth={176}
          trigger={
            <>
              <img className="workspace-logo" src={rituaLogo} alt="" aria-hidden="true" draggable={false} />
              <span>Ritua</span>
              <CaretDown size={12} aria-hidden="true" />
            </>
          }
          items={[
            { id: 'settings', label: 'Settings', icon: <GearSix size={16} /> },
            { id: 'profile', label: 'Profile', icon: <UserCircle size={16} /> },
          ]}
        />
        <nav id="primary-navigation" aria-label="Primary navigation" onScroll={() => setProjectTooltip(null)}>
          {main.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
          <p className="nav-label">Rituals</p>
          {rituals.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
          <p className="nav-label">Horizons</p>
          <TaskListItem id="anytime" icon={Stack} label="Anytime" />
          <TaskListItem id="scheduled" icon={CalendarBlank} label="Scheduled" />
          <TaskListItem id="someday" icon={Archive} label="Someday" />
          <div className="areas-heading">
            <p className="nav-label areas-label">Areas</p>
            <button
              aria-label="Add area"
              className="areas-add-button"
              hidden={areaDraftOpen}
              title="Add area"
              type="button"
              onClick={(event) => startAreaDraft(event.currentTarget)}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="area-list">
            <SortableCollectionLane
              className="area-sortable-list"
              collectionId={AREA_COLLECTION_ID}
              collectionSnapshot={areas}
              items={areas}
              laneId={AREA_LANE_ID}
              onMove={onReorderArea}
              onRestore={onRestoreAreaOrder}
              surfaceId={AREA_SURFACE_ID}
            >
              {({ collectionItemProps }) =>
                areas.map((area, index) => {
                  const areaScope = `area:${area.id}`
                  const areaActive = view === 'backlog' && taskScope === areaScope
                  const projects = objectives.filter(
                    (objective) => !objective.complete && objective.channel === area.label,
                  )

                  return (
                    <SortableCollectionItem
                      as="div"
                      className="area-navigation-group"
                      key={area.id}
                      pointerActivationDistance={5}
                      tabIndex={-1}
                      {...collectionItemProps(area, index, { type: 'area', projects })}
                    >
                      {({ handleRef }) => (
                        <>
                          <button
                            ref={handleRef}
                            aria-label={`Drag ${area.label} to reorder Areas`}
                            aria-current={areaActive ? 'page' : undefined}
                            className={`nav-item area-item area-navigation-drag-row ${areaActive ? 'active' : ''}`}
                            data-area-navigation-id={area.id}
                            type="button"
                            onClick={(event) => {
                              if (event.detail === 0) onOpenTaskScope(areaScope)
                            }}
                            onPointerDown={(event) => beginAreaPointerIntent(areaScope, event)}
                          >
                            <Folder
                              className="folder-menu-icon"
                              size={15}
                              weight="fill"
                              style={{ color: area.color }}
                            />
                            <span>{area.label}</span>
                          </button>
                          <div className="area-project-list">
                            {projects.map((project) => {
                              const projectScope = `project:${project.id}`
                              const projectActive = view === 'backlog' && taskScope === projectScope
                              const projectTasks = project.tasks || []
                              const completedTaskCount = projectTasks.filter((task) => task.complete).length
                              const projectProgressLabel = projectTasks.length
                                ? `${completedTaskCount} of ${projectTasks.length} tasks completed`
                                : 'No tasks'

                              return (
                                <button
                                  aria-label={`${project.title}, ${projectProgressLabel}`}
                                  className={`nav-item project-item ${projectActive ? 'active' : ''}`}
                                  aria-current={projectActive ? 'page' : undefined}
                                  key={project.id}
                                  onBlur={() => setProjectTooltip(null)}
                                  onClick={() => onOpenTaskScope(projectScope)}
                                  onFocus={(event) => showProjectTooltip(project.title, event.currentTarget)}
                                  onPointerEnter={(event) =>
                                    showProjectTooltip(project.title, event.currentTarget)
                                  }
                                  onPointerLeave={() => setProjectTooltip(null)}
                                >
                                  <ProjectTaskProgress tasks={projectTasks} />
                                  <span>{project.title}</span>
                                </button>
                              )
                            })}
                            <button
                              aria-label={`New project in ${area.label}`}
                              className="nav-item area-new-project-button"
                              hidden={draftAreaId === area.id}
                              type="button"
                              onClick={(event) => startProjectDraft(area.id, event.currentTarget)}
                            >
                              <Plus size={14} />
                              <span>New project</span>
                            </button>
                            {draftAreaId === area.id ? (
                              <form
                                className="area-project-draft"
                                onBlur={(event) => {
                                  if (
                                    !draftTitle.trim() &&
                                    !event.currentTarget.contains(event.relatedTarget)
                                  ) {
                                    cancelProjectDraft(false)
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    cancelProjectDraft()
                                  }
                                }}
                                onSubmit={submitProjectDraft}
                              >
                                <PushPin mirrored size={14} weight="regular" style={{ color: area.color }} />
                                <AutoGrowingTextarea
                                  ref={projectDraftInputRef}
                                  aria-label={`New project in ${area.label}`}
                                  autoComplete="off"
                                  placeholder="New project"
                                  value={draftTitle}
                                  onChange={(event) => setDraftTitle(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                      submitProjectDraft(event)
                                    }
                                  }}
                                />
                              </form>
                            ) : null}
                          </div>
                        </>
                      )}
                    </SortableCollectionItem>
                  )
                })
              }
            </SortableCollectionLane>
            <button
              aria-label="New area"
              className="nav-item area-new-area-button"
              hidden={areaDraftOpen}
              type="button"
              onClick={(event) => startAreaDraft(event.currentTarget)}
            >
              <Plus size={15} />
              <span>New area</span>
            </button>
            {areaDraftOpen ? (
              <form
                className="area-draft"
                onBlur={(event) => {
                  if (!areaDraftTitle.trim() && !event.currentTarget.contains(event.relatedTarget)) {
                    cancelAreaDraft(false)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelAreaDraft()
                  }
                }}
                onSubmit={submitAreaDraft}
              >
                <div className="area-draft-main">
                  <Folder size={15} weight="fill" style={{ color: areaDraftColor.color }} />
                  <input
                    ref={areaDraftInputRef}
                    aria-label="New area name"
                    autoComplete="off"
                    placeholder="New area"
                    value={areaDraftTitle}
                    onChange={(event) => setAreaDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        submitAreaDraft(event)
                      }
                    }}
                  />
                </div>
                <div className="area-draft-color-options" aria-label="New Area color">
                  {AREA_COLOR_OPTIONS.map((colorOption) => {
                    const selected = colorOption.id === areaDraftColor.id
                    return (
                      <button
                        aria-label={`Use ${colorOption.label} for new Area`}
                        aria-pressed={selected}
                        className="area-draft-color-option"
                        key={colorOption.id}
                        style={{ '--area-draft-color': colorOption.color }}
                        title={colorOption.label}
                        type="button"
                        onClick={() => setAreaDraftColorId(colorOption.id)}
                      >
                        {selected ? <Check size={9} weight="bold" /> : null}
                      </button>
                    )
                  })}
                </div>
              </form>
            ) : null}
          </div>
        </nav>
      </aside>
      {projectTooltip
        ? createPortal(
            <div
              aria-hidden="true"
              className="sidebar-project-tooltip"
              style={{
                left: projectTooltip.left,
                maxWidth: projectTooltip.maxWidth,
                top: projectTooltip.top,
              }}
            >
              {projectTooltip.title}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
