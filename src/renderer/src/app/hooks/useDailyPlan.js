import {
  dailyReviewTasks,
  dailyReviewTimeData,
  dailyReviewActivity,
  dailyReviewCompleted,
} from '../../../../domain/daily-review'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { workspaceStore } from '../../desktop/workspace-store'
import { dailyPlanningTasks, dailySelection } from '../../../../domain/daily-plan'
import { CURRENT_DATE_KEY } from '../utils/dates'

export function useDailyPlan() {
  const document = useStore(workspaceStore, (state) => state.document)
  return useMemo(
    () => ({
      ...dailyPlanningTasks(document, CURRENT_DATE_KEY),
      reviewTasks: dailyReviewTasks(document, CURRENT_DATE_KEY),
      reviewCompleted: dailyReviewCompleted(document, CURRENT_DATE_KEY),
      reviewTime: dailyReviewTimeData(document, CURRENT_DATE_KEY),
      reviewActivity: dailyReviewActivity(document, CURRENT_DATE_KEY),
      selection: dailySelection(document, CURRENT_DATE_KEY),
    }),
    [document],
  )
}
