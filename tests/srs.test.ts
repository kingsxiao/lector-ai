import { describe, it, expect } from 'vitest'
import { scheduleSrs, isDue, newSrs, type SrsState } from '../src/shared/srs'

const NOW = new Date('2026-06-16T00:00:00Z').getTime()

describe('scheduleSrs', () => {
  it('again resets to a short interval and counts a lapse', () => {
    const card: SrsState = { due: NOW, interval: 6, ease: 2.5, reps: 3, lapses: 0 }
    const next = scheduleSrs(card, 'again', NOW)
    expect(next.interval).toBeLessThanOrEqual(0)
    expect(next.lapses).toBe(1)
    expect(next.reps).toBe(3)
    expect(next.due).toBeLessThan(NOW + DAY())
  })
  it('good on a first review sets a 1-day interval and bumps reps', () => {
    const next = scheduleSrs(newSrs(NOW), 'good', NOW)
    expect(next.interval).toBe(1)
    expect(next.reps).toBe(1)
  })
  it('second good review grows interval beyond 1', () => {
    const card: SrsState = { due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0 }
    const next = scheduleSrs(card, 'good', NOW)
    expect(next.interval).toBeGreaterThan(1)
    expect(next.reps).toBe(2)
  })
  it('ease never drops below 1.3, even after repeated hard/again', () => {
    let card: SrsState = { due: NOW, interval: 1, ease: 1.31, reps: 1, lapses: 0 }
    card = scheduleSrs(card, 'hard', NOW)
    expect(card.ease).toBeGreaterThanOrEqual(1.3)
    card = scheduleSrs(card, 'again', NOW)
    expect(card.ease).toBeGreaterThanOrEqual(1.3)
  })
  it('easy increases ease', () => {
    const card: SrsState = { due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0 }
    expect(scheduleSrs(card, 'easy', NOW).ease).toBeGreaterThan(2.5)
  })
  it('first easy review sets a 4-day interval', () => {
    const next = scheduleSrs(newSrs(NOW), 'easy', NOW)
    expect(next.interval).toBe(4)
  })
})

describe('isDue', () => {
  it('is due when due <= now', () => {
    expect(isDue({ due: NOW - 1000, interval: 1, ease: 2.5, reps: 1, lapses: 0 }, NOW)).toBe(true)
  })
  it('is not due in the future', () => {
    expect(isDue({ due: NOW + DAY(), interval: 1, ease: 2.5, reps: 1, lapses: 0 }, NOW)).toBe(false)
  })
  it('new card is due immediately', () => {
    expect(isDue(newSrs(NOW), NOW)).toBe(true)
  })
})

function DAY(): number {
  return 86_400_000
}
