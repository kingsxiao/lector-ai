import { describe, it, expect } from 'vitest'
import {
  TRANSLATION_THEMES,
  getTheme,
  isValidThemeId,
  buildThemeStylesheet,
  clampFontSize,
} from '../src/shared/translationThemes'

describe('TRANSLATION_THEMES', () => {
  it('has 20+ named themes with unique ids and bilingual labels', () => {
    // Mirrors Immersive Translate's named-style breadth; readingFocus is Lector's.
    expect(TRANSLATION_THEMES.length).toBeGreaterThanOrEqual(20)
    const ids = TRANSLATION_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TRANSLATION_THEMES) {
      expect(t.en.length).toBeGreaterThan(0)
      expect(t.zh.length).toBeGreaterThan(0)
    }
  })
  it('includes the key Immersive-style names + readingFocus (surpass)', () => {
    const ids = TRANSLATION_THEMES.map((t) => t.id)
    for (const id of ['default', 'dashed', 'underline', 'highlight', 'marker', 'paper', 'weakening', 'blockquote', 'readingFocus']) {
      expect(ids).toContain(id)
    }
  })
})

describe('getTheme', () => {
  it('returns the def for a known id', () => {
    expect(getTheme('dashed').en).toBe('Dashed border')
  })
  it('falls back to default for unknown id', () => {
    expect(getTheme('nope').id).toBe('default')
  })
})

describe('isValidThemeId', () => {
  it('accepts known ids', () => {
    expect(isValidThemeId('default')).toBe(true)
    expect(isValidThemeId('readingFocus')).toBe(true)
  })
  it('rejects unknown', () => {
    expect(isValidThemeId('nope')).toBe(false)
    expect(isValidThemeId(123)).toBe(false)
  })
})

describe('clampFontSize', () => {
  it('clamps above and below', () => {
    expect(clampFontSize(3)).toBe(1.6)
    expect(clampFontSize(0.1)).toBe(0.6)
  })
  it('keeps in-range values, rounded to 2dp', () => {
    expect(clampFontSize(0.92)).toBe(0.92)
    expect(clampFontSize(0.923)).toBe(0.92)
  })
  it('defaults bad input to 0.92', () => {
    expect(clampFontSize(NaN)).toBe(0.92)
    expect(clampFontSize('x' as unknown as number)).toBe(0.92)
  })
})

describe('buildThemeStylesheet', () => {
  it('emits a per-theme rule for each theme with css', () => {
    const css = buildThemeStylesheet(0.92, '', false)
    expect(css).toContain('lector-theme-dashed .lector-bilingual')
    expect(css).toContain('lector-theme-readingFocus .lector-bilingual')
  })
  it('does NOT emit a rule for the empty `none` theme', () => {
    const css = buildThemeStylesheet(0.92, '', false)
    // `none` has empty css so its rule is skipped (no selector needed).
    expect(css).not.toMatch(/lector-theme-none \.lector-bilingual\{[^}]*\}/)
  })
  it('includes a font-size rule using the clamped value', () => {
    const css = buildThemeStylesheet(1.2, '', false)
    expect(css).toContain('font-size:1.2em')
  })
  it('appends custom CSS verbatim last', () => {
    const css = buildThemeStylesheet(0.92, '.lector-bilingual{color:red}', false)
    expect(css.endsWith('.lector-bilingual{color:red}')).toBe(true)
  })
  it('emits the reading-focus source-dimming rule when enabled', () => {
    const css = buildThemeStylesheet(0.92, '', true)
    expect(css).toContain('lector-focus-on .lector-bi-source')
    const off = buildThemeStylesheet(0.92, '', false)
    expect(off).not.toContain('lector-focus-on')
  })
  it('omits the custom block when customCss is blank', () => {
    const css = buildThemeStylesheet(0.92, '   ', false)
    expect(css).not.toContain('user custom css')
  })
})
