import { join } from 'node:path'

export const databasePath = (directory: string): string => join(directory, 'workspace.sqlite')
