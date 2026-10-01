/** Offsets include the trailing edge, so empty lists and end-of-list windows are valid. */
export function taskWindow(offsets: readonly number[], top: number, bottom: number) {
  const count = offsets.length - 1
  const edge = (position: number) => {
    let low = 0
    let high = count
    while (low < high) {
      const middle = (low + high) >>> 1
      if (offsets[middle + 1]! <= position) low = middle + 1
      else high = middle
    }
    return low
  }
  return { start: edge(top), end: bottom <= 0 ? 0 : Math.min(count, edge(bottom) + 1) }
}
