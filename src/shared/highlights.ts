// Highlight domain logic for Feature ② (and reused by ③). Pure functions.

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

export interface Highlight {
  id: string
  /** The highlighted text. */
  text: string
  /** User note, if any. */
  note: string
  /** Source context ±100 chars around the highlight. */
  quote: string
  url: string
  title: string
  /** The page block id the highlight sits in, if any (links to ①). */
  blockId?: string
  createdAt: number
  color: HighlightColor
}

/**
 * Two highlights are duplicates when their text AND url match. Used to prevent
 * double-highlighting the same passage.
 */
export function isDuplicateHighlight(a: Highlight, b: Highlight): boolean {
  return a.text === b.text && a.url === b.url
}

/**
 * Group highlights by origin (title + url). Within each group, newest-first.
 */
export function groupHighlights(hs: Highlight[]): Map<string, Highlight[]> {
  const map = new Map<string, Highlight[]>()
  for (const h of hs) {
    const key = `${h.title}\u0000${h.url}`
    const arr = map.get(key) ?? []
    arr.push(h)
    map.set(key, arr)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => b.createdAt - a.createdAt)
  }
  return map
}

/**
 * Search highlights across text/note/title. Case-insensitive substring.
 */
export function searchHighlights(hs: Highlight[], q: string): Highlight[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return hs
  return hs.filter(
    (h) =>
      h.text.toLowerCase().includes(needle) ||
      h.note.toLowerCase().includes(needle) ||
      h.title.toLowerCase().includes(needle)
  )
}
