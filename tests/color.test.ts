import { describe, it, expect } from 'vitest'
import { parseCssRgb, relativeLuminance } from '../src/shared/color'

describe('parseCssRgb', () => {
  it('parses rgb() with spaces', () => {
    expect(parseCssRgb('rgb(20, 22, 28)')).toEqual({ r: 20, g: 22, b: 28 })
  })
  it('parses rgba() with alpha', () => {
    expect(parseCssRgb('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })
  it('returns null for non-matching strings', () => {
    expect(parseCssRgb('transparent')).toBeNull()
    expect(parseCssRgb('')).toBeNull()
    expect(parseCssRgb('#fff')).toBeNull()
  })
  it('returns null when components are NaN', () => {
    expect(parseCssRgb('rgb(foo, bar, baz)')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('returns 1 for pure white', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })
  it('returns 0 for pure black', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })
  it('matches the dark-threshold formula from content.ts', () => {
    const dark = relativeLuminance({ r: 20, g: 22, b: 28 })
    expect(dark).toBeLessThan(0.35)
    const light = relativeLuminance({ r: 240, g: 240, b: 240 })
    expect(light).toBeGreaterThan(0.35)
  })
})
