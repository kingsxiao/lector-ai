// Simplified SM-2 spaced-repetition scheduler. Pure functions, zero deps.
// Constants follow Anki's published SM-2 defaults.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  /** Epoch ms when the card is next due. */
  due: number
  /** Interval in days. */
  interval: number
  /** Ease factor (multiplier), floored at 1.3. */
  ease: number
  /** Successful reviews. */
  reps: number
  /** Times forgotten (again). */
  lapses: number
}

const DAY = 86_400_000
const EASE_FLOOR = 1.3

export function newSrs(now: number = Date.now()): SrsState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
}

/**
 * Advance a card given a review grade. SM-2 simplified to a 4-button Anki-like
 * scheme. `again` resets to a short relearn with a lapse; the others grow
 * the interval by ease and adjust ease.
 */
export function scheduleSrs(card: SrsState, grade: Grade, now: number = Date.now()): SrsState {
  let { ease, interval, reps, lapses } = card

  if (grade === 'again') {
    ease = Math.max(EASE_FLOOR, ease - 0.2)
    lapses += 1
    return { due: now + 10 * 60 * 1000, interval: 0, ease, reps, lapses }
  }

  if (grade === 'hard') {
    ease = Math.max(EASE_FLOOR, ease - 0.15)
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 'good') {
    interval = reps === 0 ? 1 : Math.round(interval * ease)
  } else {
    // easy
    ease = ease + 0.15
    interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3)
  }

  reps += 1
  interval = Math.max(1, interval)
  return { due: now + interval * DAY, interval, ease, reps, lapses }
}

export function isDue(card: SrsState, now: number = Date.now()): boolean {
  return card.due <= now
}
