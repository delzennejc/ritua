import { createContext, useContext } from 'react'

export const SessionContext = createContext(null)
export const useCalendarSessions = () => useContext(SessionContext)
