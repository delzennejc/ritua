// Identify supported raster files from their bytes, never from a supplied MIME type.
export function imageMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (bytes.length >= 24 && starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png'
  if (bytes.length >= 4 && starts(255, 216, 255)) return 'image/jpeg'
  if (bytes.length >= 13 && starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]!) && bytes[5] === 97) return 'image/gif'
  if (bytes.length >= 16 && starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'image/webp'
  return null
}
