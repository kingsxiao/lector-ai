import { describe, it, expect } from 'vitest'
import {
  THEMES,
  DEFAULT_THEME_ID,
  isThemeId,
  normalizeThemeId,
  getTheme,
  hexToRgbTriple,
  wcagContrastRatio,
  buildPaletteCss,
  type ThemePalette,
} from '../src/shared/themes'

const PALETTE_KEYS = [
  'bg', 'surface', 'surfaceMuted', 'surfaceSunken', 'line', 'lineStrong',
  'ink', 'inkSoft', 'inkFaint',
  'accent', 'accentHover', 'accentSoft', 'accentSofter', 'onAccent',
] as const satisfies ReadonlyArray<keyof ThemePalette>

const HEX_RE = /^#[0-9a-f]{6}$/i

describe('themes — catalog integrity', () => {
  it('ships at least 5 themes with unique ids, paper first', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(5)
    expect(THEMES[0].id).toBe('paper')
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    expect(THEMES.map((t) => t.id)).toContain('ink')
  })

  it('every theme has bilingual names, descriptions and complete hex palettes', () => {
    for (const th of THEMES) {
      expect(th.zh.length).toBeGreaterThan(0)
      expect(th.en.length).toBeGreaterThan(0)
      expect(th.descZh.length).toBeGreaterThan(0)
      expect(th.descEn.length).toBeGreaterThan(0)
      for (const scheme of ['light', 'dark'] as const) {
        for (const key of PALETTE_KEYS) {
          const v = th[scheme][key]
          expect(v, `${th.id}.${scheme}.${key}`).toMatch(HEX_RE)
        }
      }
    }
  })
})

describe('themes — id normalization', () => {
  it('isThemeId accepts only catalog ids', () => {
    expect(isThemeId('paper')).toBe(true)
    expect(isThemeId('sea')).toBe(true)
    expect(isThemeId('Paper')).toBe(false)
    expect(isThemeId('neon')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
    expect(isThemeId(42)).toBe(false)
  })

  it('normalizeThemeId falls back to the default for anything invalid', () => {
    expect(DEFAULT_THEME_ID).toBe('paper')
    expect(normalizeThemeId('dusk')).toBe('dusk')
    expect(normalizeThemeId(undefined)).toBe('paper')
    expect(normalizeThemeId('hotdog')).toBe('paper')
    expect(normalizeThemeId({})).toBe('paper')
  })

  it('getTheme never throws and always returns a catalog entry', () => {
    expect(getTheme('ink').id).toBe('ink')
    expect(getTheme('bogus').id).toBe('paper')
    expect(getTheme(null).id).toBe('paper')
  })
})

describe('themes — color utils', () => {
  it('hexToRgbTriple parses 3/6-digit hex and rejects garbage', () => {
    expect(hexToRgbTriple('#FFF')).toEqual([255, 255, 255])
    expect(hexToRgbTriple('#8F5E30')).toEqual([143, 94, 48])
    expect(hexToRgbTriple(' #1f6f68 ')).toEqual([31, 111, 104])
    expect(hexToRgbTriple('#12345')).toBeNull()
    expect(hexToRgbTriple('red')).toBeNull()
    expect(hexToRgbTriple('#GGGGGG')).toBeNull()
  })

  it('wcagContrastRatio matches known anchors', () => {
    // White vs black is exactly 21:1 by definition.
    expect(wcagContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    // Identity is 1:1.
    expect(wcagContrastRatio('#8F5E30', '#8F5E30')).toBeCloseTo(1, 5)
    // Symmetric.
    expect(wcagContrastRatio('#FFFFFF', '#8F5E30')).toBeCloseTo(
      wcagContrastRatio('#8F5E30', '#FFFFFF')!,
      10
    )
    expect(wcagContrastRatio('#nope', '#FFF')).toBeNull()
  })
})

describe('themes — generated CSS', () => {
  it('emits light + dark override blocks for every theme', () => {
    const css = buildPaletteCss()
    for (const th of THEMES) {
      expect(css).toContain(`:root[data-palette='${th.id}'] {`)
      expect(css).toContain(`:root.dark[data-palette='${th.id}'] {`)
    }
  })

  it('declares every token as hex + matching rgb triplet', () => {
    const css = buildPaletteCss()
    const decl = /--([\w-]+): (#[0-9a-fA-F]{6}); --\1-rgb: (\d+) (\d+) (\d+);/g
    let seen = 0
    let m: RegExpExecArray | null
    while ((m = decl.exec(css))) {
      seen++
      const [, name, hex, r, g, b] = m
      const want = hexToRgbTriple(hex)!
      expect([Number(r), Number(g), Number(b)], `--${name}-rgb`).toEqual(want)
    }
    // 14 tokens × 2 schemes × 5 themes = 140 declarations.
    expect(seen).toBe(14 * 2 * THEMES.length)
  })

  it('never emits a token that tokens.css does not define (no typos)', () => {
    const css = buildPaletteCss()
    for (const name of ['shadow', 'font', 'danger', 'success', 'warn']) {
      expect(css).not.toMatch(new RegExp(`--${name}`))
    }
  })
})

describe('themes — WCAG AA contrast matrix (every theme × scheme)', () => {
  // Thresholds follow how tokens are actually used in the panel:
  //  - ink: 13px body text → ≥7 (AAA-ish, comfortable)
  //  - ink-soft: secondary text → ≥4.5
  //  - ink-faint: 9–11px labels/chips → ≥4.5 (AA small text)
  //  - accent: used as text on bg AND on card surfaces → ≥4.5
  //  - accent on accent-soft: active-tab text (12px semibold) — paper ships
  //    ≈4.0; hold every theme to ≥3.8 to never regress below the baseline.
  //  - on-accent on accent & accent-hover: primary button label → ≥4.5
  const checks: Array<{
    label: string
    pair: (p: ThemePalette) => [string, string]
    min: number
  }> = [
    { label: 'ink on bg', pair: (p) => [p.ink, p.bg], min: 7 },
    { label: 'ink on surface', pair: (p) => [p.ink, p.surface], min: 7 },
    { label: 'ink-soft on bg', pair: (p) => [p.inkSoft, p.bg], min: 4.5 },
    { label: 'ink-soft on surface', pair: (p) => [p.inkSoft, p.surface], min: 4.5 },
    // Unselected segments of the joined segmented control (语言/外观) sit on
    // the sunken track, not on bg.
    { label: 'ink-soft on surface-sunken (segmented track)', pair: (p) => [p.inkSoft, p.surfaceSunken], min: 4.5 },
    { label: 'ink-faint on bg', pair: (p) => [p.inkFaint, p.bg], min: 4.5 },
    { label: 'ink-faint on surface', pair: (p) => [p.inkFaint, p.surface], min: 4.5 },
    { label: 'accent on bg', pair: (p) => [p.accent, p.bg], min: 4.5 },
    { label: 'accent on surface', pair: (p) => [p.accent, p.surface], min: 4.5 },
    { label: 'accent on accent-soft (active tab)', pair: (p) => [p.accent, p.accentSoft], min: 3.8 },
    { label: 'on-accent on accent (primary button)', pair: (p) => [p.onAccent, p.accent], min: 4.5 },
    { label: 'on-accent on accent-hover', pair: (p) => [p.onAccent, p.accentHover], min: 4.5 },
  ]

  for (const th of THEMES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${th.id}/${scheme}: all pairs clear their thresholds`, () => {
        const p = th[scheme]
        for (const c of checks) {
          const [fg, bgs] = c.pair(p)
          const ratio = wcagContrastRatio(fg, bgs)!
          expect(
            ratio,
            `${th.id}/${scheme} ${c.label}: ${fg} on ${bgs} = ${ratio.toFixed(2)} (need ≥${c.min})`
          ).toBeGreaterThanOrEqual(c.min)
        }
      })
    }
  }
})

describe('themes — paper mirrors the tokens.css baseline', () => {
  // The shipped 「暖纸」 values are the design baseline; keeping the runtime
  // copy byte-identical means switching paper→paper can never shift a color.
  it('light accent family matches the shipped tokens', () => {
    const p = getTheme('paper').light
    expect(p.accent).toBe('#8F5E30')
    expect(p.accentHover).toBe('#7A4E27')
    expect(p.accentSoft).toBe('#EAD9BE')
    expect(p.accentSofter).toBe('#F4EBD9')
    expect(p.onAccent).toBe('#FFF6EA')
    expect(p.bg).toBe('#F5EFE3')
    expect(p.inkFaint).toBe('#766A56')
  })

  it('dark accent family matches the shipped tokens', () => {
    const p = getTheme('paper').dark
    expect(p.accent).toBe('#C89866')
    expect(p.bg).toBe('#1B1712')
    expect(p.onAccent).toBe('#221709')
  })
})
