import { describe, it, expect } from 'vitest'
import {
  FAB_SIZE,
  FAB_EDGE_MARGIN,
  FAB_DRAG_THRESHOLD_PX,
  FAB_MENU_RADIUS,
  FAB_MENU_ITEM_SIZE,
  isFabPosition,
  clampFabPosition,
  fabMenuArcDegrees,
  clampFabMenuOrigin,
} from '../src/shared/fabPosition'

describe('isFabPosition', () => {
  it('accepts finite {left, top}', () => {
    expect(isFabPosition({ left: 100, top: 200 })).toBe(true)
    expect(isFabPosition({ left: 0, top: 0 })).toBe(true)
  })

  it('rejects junk read back from storage', () => {
    expect(isFabPosition(null)).toBe(false)
    expect(isFabPosition(undefined)).toBe(false)
    expect(isFabPosition('100,200')).toBe(false)
    expect(isFabPosition({})).toBe(false)
    expect(isFabPosition({ left: 100 })).toBe(false)
    expect(isFabPosition({ left: NaN, top: 5 })).toBe(false)
    expect(isFabPosition({ left: Infinity, top: 5 })).toBe(false)
    // chrome.storage returns plain JSON; extra keys are tolerated, only the
    // two coordinates matter.
    expect(isFabPosition({ left: 1, top: 2, extra: 'x' })).toBe(true)
  })
})

describe('clampFabPosition', () => {
  it('leaves an in-viewport position untouched', () => {
    expect(clampFabPosition({ left: 300, top: 400 }, 1280, 800)).toEqual({
      left: 300,
      top: 400,
    })
  })

  it('pulls an off-screen position back inside the edges', () => {
    expect(clampFabPosition({ left: -500, top: -3 }, 1280, 800)).toEqual({
      left: FAB_EDGE_MARGIN,
      top: FAB_EDGE_MARGIN,
    })
    // saved on a 2560-wide monitor, restored into a 1280 window
    expect(clampFabPosition({ left: 2400, top: 790 }, 1280, 800)).toEqual({
      left: 1280 - FAB_SIZE - FAB_EDGE_MARGIN,
      top: 800 - FAB_SIZE - FAB_EDGE_MARGIN,
    })
  })

  it('collapses toward 0 on viewports smaller than the FAB', () => {
    const p = clampFabPosition({ left: 20, top: 20 }, 30, 30)
    // maxLeft = max(0, 30 - 48 - 8) = 0 → clamped to 0, never negative
    expect(p).toEqual({ left: 0, top: 0 })
  })
})

describe('fabMenuArcDegrees', () => {
  const needed = FAB_MENU_RADIUS + FAB_MENU_ITEM_SIZE / 2 + FAB_EDGE_MARGIN

  it('fans upward while there is room above (the classic look)', () => {
    // FAB at the default bottom-right spot: top ≈ viewportH - 24 - 48
    expect(fabMenuArcDegrees(800 - 24 - 48, 800)).toEqual({
      startDeg: 200,
      endDeg: 340,
    })
  })

  it('flips downward when the FAB is dragged near the top edge', () => {
    // centerY = fabTop + 24 must be < needed for the flip
    const topEdge = FAB_EDGE_MARGIN
    expect(topEdge + FAB_SIZE / 2).toBeLessThan(needed)
    expect(fabMenuArcDegrees(topEdge, 800)).toEqual({ startDeg: 20, endDeg: 160 })
  })

  it('keeps the upward arc on viewports too short for either side', () => {
    // A 150px-tall viewport fits neither arc; upward stays the default.
    expect(fabMenuArcDegrees(50, 150)).toEqual({ startDeg: 200, endDeg: 340 })
  })
})

describe('clampFabMenuOrigin', () => {
  // 4 items, the production arc: angles 200/246.7/293.3/340 at radius 76.
  // Reproduce via the same trig so the test tracks the real geometry.
  const arc = (n: number, r = 76, start = 200, end = 340) =>
    Array.from({ length: n }, (_, i) => {
      const deg = start + (i * (end - start)) / Math.max(1, n - 1)
      const rad = (deg * Math.PI) / 180
      return { dx: Math.cos(rad) * r, dy: Math.sin(rad) * r }
    })

  it('shifts the fan left at the default bottom-right anchor so no item overflows the right edge', () => {
    const vw = 1280
    const vh = 800
    const cx = vw - 20 - FAB_SIZE / 2 // right:20px default
    const cy = vh - 24 - FAB_SIZE / 2 // bottom:24px default
    const positions = arc(4)
    const o = clampFabMenuOrigin(cx, cy, positions, vw, vh)
    const half = FAB_MENU_ITEM_SIZE / 2
    for (const p of positions) {
      expect(o.cx + p.dx + half).toBeLessThanOrEqual(vw - FAB_EDGE_MARGIN + 1e-6)
      expect(o.cx + p.dx - half).toBeGreaterThanOrEqual(FAB_EDGE_MARGIN - 1e-6)
      expect(o.cy + p.dy + half).toBeLessThanOrEqual(vh - FAB_EDGE_MARGIN + 1e-6)
    }
    // sanity: without the clamp the rightmost item DID overflow (regression pin)
    const rightmost = Math.max(...positions.map((p) => cx + p.dx + half))
    expect(rightmost).toBeGreaterThan(vw - FAB_EDGE_MARGIN)
    // and the vertical flip never triggers at the default spot, so only the x
    // origin moves
    expect(o.cy).toBeCloseTo(cy, 6)
  })

  it('shifts the fan right when the FAB is parked at the left edge', () => {
    const cx = FAB_EDGE_MARGIN + FAB_SIZE / 2
    const o = clampFabMenuOrigin(cx, 400, arc(4), 1280, 800)
    const half = FAB_MENU_ITEM_SIZE / 2
    expect(o.cx).toBeGreaterThan(cx)
    for (const p of arc(4)) {
      expect(o.cx + p.dx - half).toBeGreaterThanOrEqual(FAB_EDGE_MARGIN - 1e-6)
    }
  })

  it('returns the origin unchanged when everything already fits', () => {
    const o = clampFabMenuOrigin(640, 500, arc(4), 1280, 800)
    expect(o).toEqual({ cx: 640, cy: 500 })
  })

  it('handles the empty fan', () => {
    expect(clampFabMenuOrigin(10, 10, [], 1280, 800)).toEqual({ cx: 10, cy: 10 })
  })

  it('respects the downward arc geometry too (FAB near the top edge)', () => {
    const cx = 640
    const cy = FAB_EDGE_MARGIN + FAB_SIZE / 2
    const positions = arc(4, 76, 20, 160) // downward arc
    const o = clampFabMenuOrigin(cx, cy, positions, 1280, 800)
    const half = FAB_MENU_ITEM_SIZE / 2
    for (const p of positions) {
      expect(o.cy + p.dy + half).toBeLessThanOrEqual(800 - FAB_EDGE_MARGIN + 1e-6)
    }
  })
})

describe('constants stay in sync with content.ts styles', () => {
  it('FAB geometry matches the shipped CSS', () => {
    // #lector-ai-fab { width:48px; height:48px } and radial R=76, item 44px.
    // If these change in content.ts the constants here must follow — pinned
    // so a drift fails loudly instead of shifting clamping by a few px.
    expect(FAB_SIZE).toBe(48)
    expect(FAB_DRAG_THRESHOLD_PX).toBe(6)
    expect(FAB_MENU_RADIUS).toBe(76)
    expect(FAB_MENU_ITEM_SIZE).toBe(44)
  })
})
