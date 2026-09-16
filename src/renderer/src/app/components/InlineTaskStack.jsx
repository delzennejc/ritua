import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Folder, Plus } from '@phosphor-icons/react'
import { useInlineCapture } from '../hooks/useInlineCapture'
import { useWorkspaceProjection } from '../../desktop/workspace-store'
import { DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import { AutoGrowingTextarea } from './DetailsTitleInput'
import { Dropdown } from './Dropdown'

export function InlineTaskStack({
  children,
  dateKey,
  firstTaskId,
  onCreateTask,
  addRowClassName = '',
  stackClassName = '',
}) {
  const draftDateKeyRef = useRef(dateKey)
  const taskStackRef = useRef(null)
  const creationLayoutRef = useRef(null)
  const animationsRef = useRef([])
  const captureFormRef = useRef(null)
  const areaTriggerRef = useRef(null)
  const areas = useWorkspaceProjection('areas', DEFAULT_AREAS)
  const [selectedAreaId, setSelectedAreaId] = useState(null)
  const selectedArea = areas.find((area) => area.id === selectedAreaId) || areas[0]
  const {
    isAdding,
    draftTitle,
    inputRef,
    finishAdding,
    handleKeyDown,
    setDraftTitle,
    settlingItemId,
    startAdding,
    submit,
  } = useInlineCapture((title) => {
    const stack = taskStackRef.current
    // Capture the visible positions before the input closes and the task is inserted.
    creationLayoutRef.current = {
      draftTop: inputRef.current?.closest('form')?.getBoundingClientRect().top,
      cards: new Map(
        [...stack.children].map((card) => [card.dataset.taskLayoutId, card.getBoundingClientRect().top]),
      ),
    }
    return onCreateTask({ title, dateKey: draftDateKeyRef.current, area: selectedArea?.label })
  })

  const containsCaptureTarget = (target) => {
    const menuId = areaTriggerRef.current?.getAttribute('aria-controls')
    const menu = menuId ? document.getElementById(menuId) : null
    return captureFormRef.current?.contains(target) || menu?.contains(target)
  }

  useEffect(() => {
    if (!isAdding) return undefined
    const finishOutside = (event) => {
      if (!containsCaptureTarget(event.target)) finishAdding()
    }
    // Save before an outside click dismisses the portalled menu and removes its focused item.
    document.addEventListener('pointerdown', finishOutside, true)
    return () => document.removeEventListener('pointerdown', finishOutside, true)
  }, [isAdding, finishAdding])

  // Date navigation must save a typed draft to the day where capture began.
  useEffect(() => {
    if (isAdding && draftDateKeyRef.current !== dateKey) {
      finishAdding()
    }
  }, [isAdding, dateKey, finishAdding])

  useLayoutEffect(() => {
    const previous = creationLayoutRef.current
    const stack = taskStackRef.current
    if (!previous || !settlingItemId || firstTaskId !== settlingItemId) return
    const cards = [...stack.children]
    if (cards[0]?.dataset.taskLayoutId !== settlingItemId) return
    creationLayoutRef.current = null
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current = []
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Read all final positions before animating. Translate is independent of the
    // transform property used by drag-and-drop, so the two do not overwrite it.
    const positions = cards.map((card) => ({ card, top: card.getBoundingClientRect().top }))
    positions.forEach(({ card, top }) => {
      const isNew = card.dataset.taskLayoutId === settlingItemId
      const from = isNew ? previous.draftTop : previous.cards.get(card.dataset.taskLayoutId)
      if (from === undefined) return
      const animation = card.animate(
        [
          { translate: `0 ${from - top}px`, opacity: isNew ? 0 : 1 },
          { translate: '0 0', opacity: 1 },
        ],
        { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      )
      animationsRef.current.push(animation)
    })
  }, [settlingItemId, firstTaskId])

  useEffect(
    () => () => {
      animationsRef.current.forEach((animation) => animation.cancel())
    },
    [],
  )

  const rowClassName = `add-row inline-task-add ${addRowClassName}`.trim()
  const beginCapture = () => {
    if (!isAdding) draftDateKeyRef.current = dateKey
    startAdding()
  }

  return (
    <>
      <form
        ref={captureFormRef}
        className={`${rowClassName} ${isAdding ? 'inline-capture-form' : ''} ${settlingItemId ? 'is-reappearing' : ''}`.trim()}
        onSubmit={submit}
        onBlur={(event) => {
          if (!isAdding) return
          // The folder menu is portalled outside the form; moving into it keeps the draft open.
          if (containsCaptureTarget(event.relatedTarget)) return
          finishAdding()
        }}
      >
        {isAdding ? (
          <>
            <Plus size={15} />
            <AutoGrowingTextarea
              ref={inputRef}
              aria-label="New task"
              autoComplete="off"
              placeholder="Add task"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </>
        ) : (
          <button className="inline-task-start" type="button" onClick={beginCapture}>
            <Plus size={15} /> Add task
          </button>
        )}
        <Dropdown
          label={`Area for new task: ${selectedArea?.label || 'Choose an Area'}`}
          title="Choose an Area"
          triggerTitle={selectedArea?.label || 'Choose an Area'}
          triggerRef={areaTriggerRef}
          className="inline-task-area"
          triggerClassName="inline-task-area-trigger"
          align="end"
          menuWidth={240}
          disabled={!areas.length}
          trigger={
            <Folder size={16} weight="fill" style={{ color: selectedArea?.color }} aria-hidden="true" />
          }
          items={areas.map((area) => ({
            id: area.id,
            label: area.label,
            icon: <Folder size={16} weight="fill" style={{ color: area.color }} />,
            role: 'menuitemradio',
            checked: area.id === selectedArea?.id,
            onSelect: () => {
              setSelectedAreaId(area.id)
              beginCapture()
            },
          }))}
        />
      </form>
      <div ref={taskStackRef} className={`task-stack inline-task-stack ${stackClassName}`.trim()}>
        {children}
      </div>
    </>
  )
}
