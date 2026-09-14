// Includes current work, archives, historical drafts and recovery documents.
export function attachmentIds(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return result
  if (Array.isArray(value)) {
    for (const item of value) attachmentIds(item, result)
    return result
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      key === 'attachment' &&
      item &&
      typeof item === 'object' &&
      typeof (item as { id?: unknown }).id === 'string'
    )
      result.add((item as { id: string }).id)
    attachmentIds(item, result)
  }
  return result
}
