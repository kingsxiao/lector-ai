// Pure CSS-color math for the dark/light glass decision in content.ts.
// No DOM, no chrome.

export interface Rgb {
  r: number
  g: number
  b: number
  a?: number
}

/**
 * Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" into components.
 * Returns null if the string doesn't match or any component is NaN.
 * Whitespace-tolerant. Reproduces the parsing logic that used to live inline
 * in content.ts::isDarkPage.
 */
export function parseCssRgb(str: string): Rgb | null {
  const m = str.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  const [r, g, b] = parts
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  const a = parts[3]
  const out: Rgb = { r, g, b }
  if (!Number.isNaN(a)) out.a = a
  return out
}

/**
 * WCAG-style relative luminance normalized to 0..1.
 * `(0.2126*r + 0.7152*g + 0.0722*b) / 255`. Linear with sRGB bytes (good enough
 * for the binary dark/light threshold used by content.ts).
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
