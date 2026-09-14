// Public workspace boundary. Wire types, projections and validation have separate owners.
export * from './workspace-types'
export { durableFields } from './workspace-fields'
export { normalize, project, changes } from './workspace-projection'
export * from './workspace-validation'
