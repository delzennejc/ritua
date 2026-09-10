// Include image reads/imports in the existing native close and backup save handshake.
const pending = new Set<Promise<void>>()
export function trackMediaImport(operation: Promise<void>): Promise<void> {
  pending.add(operation)
  void operation.finally(() => pending.delete(operation)).catch(() => {})
  return operation
}
export const hasPendingMediaImports = () => pending.size > 0
export async function waitForMediaImports(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}
