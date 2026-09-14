import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { useInlineCapture } from '../hooks/useInlineCapture'
import { AutoGrowingTextarea } from './DetailsTitleInput'

export function InlineTaskStack({
  children,
  dateKey,
  firstTaskId,
  onCreateTask,
  total,
  addRowClassName = '',
  stackClassName = '',
}) {
  const draftDateKeyRef = useRef(dateKey)
  const taskStackRef = useRef(null)
  const creationLayoutRef = useRef(null)
  const animationsRef = useRef([])
  const [totalReturning, setTotalReturning] = useState(false)
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
    return onCreateTask({ title, dateKey: draftDateKeyRef.current })
  })

  // Date navigation must save a typed draft to the day where capture began.
  useEffect(() => {
    if (isAdding && draftDateKeyRef.current !== dateKey) {
      setTotalReturning(true)
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
  const finishWithReturningTotal = () => {
    setTotalReturning(true)
    finishAdding()
  }
  const handleCaptureKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') setTotalReturning(true)
    handleKeyDown(event)
  }

  return (
    <>
      {isAdding ? (
        <form
          className={`${rowClassName} inline-capture-form`}
          onSubmit={(event) => {
            setTotalReturning(true)
            submit(event)
          }}
        >
          <Plus size={15} />
          <AutoGrowingTextarea
            ref={inputRef}
            aria-label="New task"
            autoComplete="off"
            placeholder="Add task"
            value={draftTitle}
            onBlur={finishWithReturningTotal}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleCaptureKeyDown}
          />
          <span>{total}</span>
        </form>
      ) : (
        <button
          className={`${rowClassName} ${settlingItemId ? 'is-reappearing' : ''} ${totalReturning ? 'is-total-returning' : ''}`.trim()}
          type="button"
          onClick={() => {
            draftDateKeyRef.current = dateKey
            setTotalReturning(false)
            startAdding()
          }}
        >
          <Plus size={15} /> Add task <span>{total}</span>
        </button>
      )}
      <div ref={taskStackRef} className={`task-stack inline-task-stack ${stackClassName}`.trim()}>
        {children}
      </div>
    </>
  )
}
