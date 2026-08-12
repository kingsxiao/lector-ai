// Pure Readability-style scoring for content extraction. No DOM, no chrome.
// The DOM glue that turns an Element into a NodeStats lives in content.ts.

/** Selectors stripped from the cloned extraction root (data only). */
export const NOISE_SELECTORS: readonly string[] = [
  'header', 'footer', 'nav', 'aside', 'form', 'iframe',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.advertisement', '.ads', '.ad', '.share', '.social', '.newsletter',
  '.related', '.comments', '.comment', '.sidebar', '.cookie',
] as const

export interface NodeStats {
  text: string
  linkCount: number
  wordCount: number
}

/**
 * Density score: text length + comma bonus - link-density penalty.
 * Pure port of content.ts::scoreNode. Empty text → 0.
 */
export function scoreNodeFromStats({ text, linkCount, wordCount }: NodeStats): number {
  const t = text.trim()
  if (!t) return 0
  const commas = (t.match(/[,.，。、；:;?!]/g) || []).length
  const linkDensity = linkCount / Math.max(1, wordCount)
  return t.length + commas * 8 - linkDensity * 200
}
