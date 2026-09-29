import { reportActionError } from '../../desktop/ActionErrors'
import { AREA_COLOR_OPTIONS } from '../data/areaColors'
import { areaIdFromLabel, reorderAreas } from '../utils/workspace-presenters.js'
import {
  replaceWorkspaceDocument,
  getWorkspaceFields,
  getWorkspaceDocument,
  queueBulkWorkspaceUpdate,
} from '../../desktop/workspace-store'
import {
  colorWorkspaceArea,
  renameWorkspaceArea,
  archiveWorkspaceArea,
  deleteWorkspaceArea,
} from '../../../../domain/area-commands'

export function useAreaActions({
  setWeeklyObjectives,
  setToast,
  areas,
  setAreas,
  setTaskScope,
  setView,
  boardStateRef,
  setActiveAreaId,
  setPendingScheduleDrop,
}) {
  const createAreaProject = (area, title) => {
    setWeeklyObjectives((items) => [
      ...items,
      {
        id: `objective-${Date.now()}`,
        title,
        channel: area.label,
        complete: false,
        focusedThisWeek: true,
        tasks: [],
      },
    ])
    setToast(`${title} added to ${area.label}.`)
  }

  const createArea = (nextLabel, requestedColorOption) => {
    const label = nextLabel.trim()
    if (!label) return null
    const duplicateArea = areas.some(
      (area) => area.label.localeCompare(label, undefined, { sensitivity: 'accent' }) === 0,
    )
    if (duplicateArea) {
      reportActionError(`An Area named ${label} already exists.`)
      return null
    }

    const paletteEntry =
      AREA_COLOR_OPTIONS.find((option) => option.id === requestedColorOption?.id) ||
      AREA_COLOR_OPTIONS[areas.length % AREA_COLOR_OPTIONS.length]
    const area = {
      id: areaIdFromLabel(label, areas),
      label,
      accent: paletteEntry.accent,
      color: paletteEntry.color,
    }
    setAreas((items) => [...items, area])
    setTaskScope(`area:${area.id}`)
    setView('backlog')
    setToast(`${label} Area created.`)
    return area
  }

  const moveArea = (move) => {
    setAreas((items) => reorderAreas(items, move))
  }

  const restoreAreaOrder = (snapshot) => {
    setAreas(snapshot)
  }

  const publishActionDocument = (fields) => {
    replaceWorkspaceDocument(fields)
    boardStateRef.current = getWorkspaceFields()
  }

  const changeAreaColorFromDetails = (areaId, colorOption) => {
    if (!colorOption) return
    publishActionDocument(colorWorkspaceArea(getWorkspaceDocument(), areaId, colorOption, true))
    queueBulkWorkspaceUpdate(`area-color:${areaId}`, { type: 'area-color', areaId, color: colorOption }, true)
  }

  const renameAreaFromDetails = (areaId, label) => {
    try {
      if (!label.trim()) return false
      const current = getWorkspaceDocument()
      const previous = current.entities.find((entity) => entity.kind === 'area' && entity.id === areaId)?.data
        .content.label
      if (!previous || previous === label.trim()) return true
      publishActionDocument(renameWorkspaceArea(current, areaId, label, true))
      queueBulkWorkspaceUpdate(`area-rename:${areaId}`, {
        type: 'area-rename',
        previous,
        label: label.trim(),
      })
      return true
    } catch (error) {
      reportActionError(error.message)
      return false
    }
  }

  const archiveAreaFromDetails = (areaId) => {
    publishActionDocument(archiveWorkspaceArea(getWorkspaceDocument(), areaId, new Date()))
    setActiveAreaId(null)
  }

  const deleteAreaFromDetails = (areaId) => {
    const result = deleteWorkspaceArea(getWorkspaceDocument(), areaId)
    publishActionDocument(result.document)
    setPendingScheduleDrop((pending) => (result.deletedTaskIds.includes(pending?.taskId) ? null : pending))
    setActiveAreaId(null)
  }
  return {
    createAreaProject,
    createArea,
    moveArea,
    restoreAreaOrder,
    publishActionDocument,
    changeAreaColorFromDetails,
    renameAreaFromDetails,
    archiveAreaFromDetails,
    deleteAreaFromDetails,
  }
}
