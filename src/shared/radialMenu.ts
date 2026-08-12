// Pure trig for the FAB radial menu. No DOM, no chrome.

/**
 * Compute n fan-out positions along a circular arc, in screen coordinates
 * (y grows downward). Reproduces the formula used by the FAB menu in
 * content.ts: angleDeg = startDeg + (i * (endDeg - startDeg)) / max(1, n - 1).
 *
 * For n === 1 the single point sits at startDeg (avoids divide-by-zero and
 * matches the existing Math.max(1, n - 1) guard).
 */
export function fanOutPositions(
  n: number,
  radius: number,
  startDeg: number,
  endDeg: number
): Array<{ dx: number; dy: number }> {
  if (n <= 0) return []
  const span = endDeg - startDeg
  const out: Array<{ dx: number; dy: number }> = []
  for (let i = 0; i < n; i++) {
    const angleDeg = startDeg + (i * span) / Math.max(1, n - 1)
    const rad = (angleDeg * Math.PI) / 180
    out.push({ dx: Math.cos(rad) * radius, dy: Math.sin(rad) * radius })
  }
  return out
}
