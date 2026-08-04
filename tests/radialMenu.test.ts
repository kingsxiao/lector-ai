import { describe, it, expect } from 'vitest'
import { fanOutPositions } from '../src/shared/radialMenu'

describe('fanOutPositions', () => {
  it('returns one point at startDeg when n === 1 (no divide-by-zero)', () => {
    const [p] = fanOutPositions(1, 76, 200, 340)
    expect(p.dx).toBeCloseTo(Math.cos((200 * Math.PI) / 180) * 76, 5)
    expect(p.dy).toBeCloseTo(Math.sin((200 * Math.PI) / 180) * 76, 5)
  })

  it('returns n points for n >= 2, evenly fanned between startDeg and endDeg', () => {
    const pts = fanOutPositions(3, 76, 200, 340)
    expect(pts).toHaveLength(3)
    expect(pts[0].dx).toBeCloseTo(Math.cos((200 * Math.PI) / 180) * 76, 5)
    expect(pts[2].dx).toBeCloseTo(Math.cos((340 * Math.PI) / 180) * 76, 5)
    expect(pts[1].dx).toBeCloseTo(Math.cos((270 * Math.PI) / 180) * 76, 5)
    expect(pts[1].dy).toBeCloseTo(Math.sin((270 * Math.PI) / 180) * 76, 5)
  })

  it('returns [] for n === 0', () => {
    expect(fanOutPositions(0, 76, 200, 340)).toEqual([])
  })

  it('handles negative angles and radius 0 (positions collapse to origin)', () => {
    const [p] = fanOutPositions(1, 0, -90, 90)
    // radius 0 collapses both components to (signed) zero; compare magnitude.
    expect(Math.abs(p.dx)).toBe(0)
    expect(Math.abs(p.dy)).toBe(0)
  })
})
