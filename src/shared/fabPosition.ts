// Pure geometry for the draggable FAB. No DOM, no chrome — mirrors the
// radialMenu.ts convention so clamping and arc-flipping stay unit-testable.

/** Rendered FAB size (must match #lector-ai-fab in content.ts styles). */
export const FAB_SIZE = 48

/** Closest the FAB may sit to a viewport edge (px). */
export const FAB_EDGE_MARGIN = 8

/** Pointer travel (px) beyond which a press becomes a drag instead of a click. */
export const FAB_DRAG_THRESHOLD_PX = 6

/** Radial menu geometry (must match toggleFabMenu in content.ts). */
export const FAB_MENU_RADIUS = 76
export const FAB_MENU_ITEM_SIZE = 44

export interface FabPosition {
  left: number
  top: number
}

/** Type guard for values read back from chrome.storage. */
export function isFabPosition(v: unknown): v is FabPosition {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as FabPosition).left) &&
    Number.isFinite((v as FabPosition).top)
  )
}

/**
 * Keep the FAB fully inside the viewport (left/top of its top-left corner).
 * On viewports narrower/shorter than the FAB the result collapses to 0,
 * which still renders a (clipped) button rather than losing it off-screen.
 */
export function clampFabPosition(
  pos: FabPosition,
  viewportW: number,
  viewportH: number
): FabPosition {
  const maxLeft = Math.max(0, viewportW - FAB_SIZE - FAB_EDGE_MARGIN)
  const maxTop = Math.max(0, viewportH - FAB_SIZE - FAB_EDGE_MARGIN)
  return {
    left: Math.min(Math.max(pos.left, FAB_EDGE_MARGIN), maxLeft),
    top: Math.min(Math.max(pos.top, FAB_EDGE_MARGIN), maxTop),
  }
}

/**
 * Which semicircle the radial menu should fan out along. Default is upward
 * (the classic bottom-right anchored FAB look); when the FAB has been dragged
 * so close to the top edge that the items would overflow, flip the arc
 * downward instead. On viewports too short for either side, keep upward —
 * some items clipping is unavoidable and the up-arc stays closer to the FAB's
 * original personality.
 */
export function fabMenuArcDegrees(
  fabTop: number,
  viewportH: number
): { startDeg: number; endDeg: number } {
  const centerY = fabTop + FAB_SIZE / 2
  // Space an arc needs beyond the FAB center so no item crosses the edge:
  // item-center radius + half item + edge margin.
  const needed = FAB_MENU_RADIUS + FAB_MENU_ITEM_SIZE / 2 + FAB_EDGE_MARGIN
  const roomAbove = centerY - needed >= 0
  const roomBelow = viewportH - centerY - needed >= 0
  if (!roomAbove && roomBelow) return { startDeg: 20, endDeg: 160 }
  return { startDeg: 200, endDeg: 340 }
}

/** Fan-out point relative to the FAB center (output of fanOutPositions). */
export interface FanPoint {
  dx: number
  dy: number
}

/**
 * Shift the radial menu's origin so every ITEM stays inside the viewport. The
 * FAB itself is clamped ≥8px from the edges, but the fan extends ~93px beyond
 * the FAB center on each side: anchored at the default bottom-right spot the
 * rightmost item already crosses the right edge by ~49px, and a
 * freely-dragged FAB can end up at any edge. Shifting the whole fan (rather
 * than re-aiming the arc) preserves the radial look. Hover labels are NOT
 * counted here — they're transient tooltips; content.ts flips individual
 * labels to the item's right side when they'd overflow the left edge.
 */
export function clampFabMenuOrigin(
  cx: number,
  cy: number,
  positions: FanPoint[],
  viewportW: number,
  viewportH: number
): { cx: number; cy: number } {
  if (positions.length === 0) return { cx, cy }
  const half = FAB_MENU_ITEM_SIZE / 2
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of positions) {
    minX = Math.min(minX, cx + p.dx - half)
    maxX = Math.max(maxX, cx + p.dx + half)
    minY = Math.min(minY, cy + p.dy - half)
    maxY = Math.max(maxY, cy + p.dy + half)
  }
  let nx = cx
  let ny = cy
  if (minX < FAB_EDGE_MARGIN) nx += FAB_EDGE_MARGIN - minX
  if (maxX > viewportW - FAB_EDGE_MARGIN) nx -= maxX - (viewportW - FAB_EDGE_MARGIN)
  if (minY < FAB_EDGE_MARGIN) ny += FAB_EDGE_MARGIN - minY
  if (maxY > viewportH - FAB_EDGE_MARGIN) ny -= maxY - (viewportH - FAB_EDGE_MARGIN)
  return { cx: nx, cy: ny }
}
