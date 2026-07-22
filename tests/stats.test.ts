import { describe, it, expect } from 'vitest'
import { computeReviewStats, type Reviewable } from '../src/shared/stats'

const item = (
  id: string,
  srs: { due: number; interval: number; ease: number; reps: number; lapses: number } | null
): Reviewable => ({ id, srs })

const srs = (over: Partial<{ due: number; interval: number; ease: number; reps: number; lapses: number }> = {}) => ({
  due: over.due ?? Date.now() + 86400000,
  interval: over.interval ?? 1,
  ease: over.ease ?? 2.5,
  reps: over.reps ?? 0,
  lapses: over.lapses ?? 0,
})

describe('computeReviewStats', () => {
  it('returns zeros for an empty list', () => {
    const r = computeReviewStats([])
    expect(r.due).toBe(0)
    expect(r.mastered).toBe(0)
    expect(r.totalReviews).toBe(0)
    expect(r.avgEase).toBe(0)
  })

  it('counts due items (isDue true)', () => {
    const items = [
      item('1', srs({ due: Date.now() - 1000 })),
      item('2', srs({ due: Date.now() + 1000 })),
      item('3', srs({ due: Date.now() - 5000 })),
    ]
    expect(computeReviewStats(items).due).toBe(2)
  })

  it('counts mastered items (reps >= 3)', () => {
    const items = [
      item('1', srs({ reps: 5 })),
      item('2', srs({ reps: 3 })),
      item('3', srs({ reps: 2 })),
      item('4', srs({ reps: 0 })),
    ]
    expect(computeReviewStats(items).mastered).toBe(2)
  })

  it('sums total reviews (sum of reps)', () => {
    const items = [
      item('1', srs({ reps: 5 })),
      item('2', srs({ reps: 3 })),
      item('3', srs({ reps: 0 })),
    ]
    expect(computeReviewStats(items).totalReviews).toBe(8)
  })

  it('averages ease across reviewable items, 1 decimal', () => {
    const items = [
      item('1', srs({ ease: 2.5 })),
      item('2', srs({ ease: 2.3 })),
      item('3', srs({ ease: 2.7 })),
    ]
    expect(computeReviewStats(items).avgEase).toBe(2.5)
  })

  it('rounds avgEase to 1 decimal', () => {
    const items = [item('1', srs({ ease: 2.54 })), item('2', srs({ ease: 2.37 }))]
    const r = computeReviewStats(items)
    expect(r.avgEase).toBe(Math.round(2.455 * 10) / 10)
  })

  it('ignores items with srs=null (passive reference)', () => {
    const items = [
      item('1', srs({ reps: 5, ease: 2.5, due: Date.now() - 1000 })),
      item('2', null),
      item('3', srs({ reps: 3, ease: 2.6 })),
    ]
    const r = computeReviewStats(items)
    expect(r.due).toBe(1)
    expect(r.mastered).toBe(2)
    expect(r.totalReviews).toBe(8)
    expect(r.avgEase).toBe(2.6)
  })

  it('returns avgEase 0 when no reviewable items', () => {
    const items = [item('1', null), item('2', null)]
    expect(computeReviewStats(items).avgEase).toBe(0)
  })
})
