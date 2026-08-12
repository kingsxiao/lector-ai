import { describe, it, expect } from 'vitest'
import { scoreNodeFromStats, NOISE_SELECTORS } from '../src/shared/readability'

describe('NOISE_SELECTORS', () => {
  it('includes the standard set used by extractPage', () => {
    expect(NOISE_SELECTORS).toContain('header')
    expect(NOISE_SELECTORS).toContain('footer')
    expect(NOISE_SELECTORS).toContain('[role="navigation"]')
    expect(NOISE_SELECTORS.length).toBeGreaterThanOrEqual(15)
  })
})

describe('scoreNodeFromStats', () => {
  it('returns 0 for empty/whitespace text', () => {
    expect(scoreNodeFromStats({ text: '', linkCount: 0, wordCount: 0 })).toBe(0)
    expect(scoreNodeFromStats({ text: '   ', linkCount: 0, wordCount: 0 })).toBe(0)
  })
  it('rewards long comma-rich text', () => {
    const long = 'one, two, three, four, five, six, seven, eight, nine, ten words here ok'
    const score = scoreNodeFromStats({ text: long, linkCount: 0, wordCount: 12 })
    expect(score).toBeGreaterThan(0)
    // text.length + commas*8 - 0
    expect(score).toBe(long.length + 9 * 8)
  })
  it('penalizes link-heavy (nav-like) nodes', () => {
    const nav = 'a b c d' // 4 words
    const navScore = scoreNodeFromStats({ text: nav, linkCount: 4, wordCount: 4 })
    expect(navScore).toBeLessThan(0) // 7 - (4/4)*200 = -193
  })
  it('guards wordCount against divide-by-zero (wordCount 0 → density uses max(1,0)=1)', () => {
    const score = scoreNodeFromStats({ text: 'hello', linkCount: 5, wordCount: 0 })
    expect(score).toBe(5 - 1000) // linkDensity = 5/max(1,0) = 5; 5*200 = 1000
  })
})
