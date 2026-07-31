import { describe, it, expect } from 'vitest'
import {
  matchHost,
  findRuleForHost,
  siteToggleState,
  normalizeSiteRules,
  isValidSiteRuleMode,
  type SiteRule,
  shouldAutoTranslatePage,
} from '../src/shared/siteRules'

describe('matchHost', () => {
  it('exact host matches', () => {
    expect(matchHost('example.com', 'example.com')).toBe(true)
  })
  it('bare host matches subdomains (lenient)', () => {
    expect(matchHost('example.com', 'www.example.com')).toBe(true)
    expect(matchHost('example.com', 'a.b.example.com')).toBe(true)
  })
  it('wildcard matches subdomains and the base', () => {
    expect(matchHost('*.example.com', 'www.example.com')).toBe(true)
    expect(matchHost('*.example.com', 'a.b.example.com')).toBe(true)
    expect(matchHost('*.example.com', 'example.com')).toBe(true)
  })
  it('wildcard does NOT match an unrelated domain', () => {
    expect(matchHost('*.example.com', 'evilexample.com')).toBe(false)
    expect(matchHost('example.com', 'notexample.com')).toBe(false)
  })
  it('is case-insensitive and trims leading dots', () => {
    expect(matchHost('.Example.COM', 'example.com')).toBe(true)
    expect(matchHost('EXAMPLE.com', 'WWW.example.com')).toBe(true)
  })
  it('empty pattern or host never matches', () => {
    expect(matchHost('', 'example.com')).toBe(false)
    expect(matchHost('example.com', '')).toBe(false)
  })
})

const rule = (id: string, hostPattern: string, mode: SiteRule['mode']): SiteRule => ({
  id, hostPattern, mode, createdAt: 1000,
})

describe('findRuleForHost', () => {
  it('returns the first matching rule in list order (priority)', () => {
    const rules = [
      rule('1', 'blog.example.com', 'never'),
      rule('2', 'example.com', 'always'),
    ]
    expect(findRuleForHost(rules, 'blog.example.com')?.id).toBe('1')
    expect(findRuleForHost(rules, 'www.example.com')?.id).toBe('2')
  })
  it('returns undefined when nothing matches', () => {
    expect(findRuleForHost([rule('1', 'x.com', 'always')], 'y.com')).toBeUndefined()
  })
})

describe('siteToggleState', () => {
  it('reports always/never/auto correctly', () => {
    const rules = [rule('1', 'example.com', 'always')]
    expect(siteToggleState(rules, 'example.com')).toBe('always')
    expect(siteToggleState(rules, 'other.com')).toBe('auto')
    const never = [rule('1', 'example.com', 'never')]
    expect(siteToggleState(never, 'example.com')).toBe('never')
  })
})

describe('shouldAutoTranslatePage', () => {
  it('uses the global setting when no site rule matches', () => {
    expect(shouldAutoTranslatePage(true)).toBe(true)
    expect(shouldAutoTranslatePage(false)).toBe(false)
  })
  it('lets always/never rules override the global setting', () => {
    expect(shouldAutoTranslatePage(false, rule('a', 'x.com', 'always'))).toBe(true)
    expect(shouldAutoTranslatePage(true, rule('n', 'x.com', 'never'))).toBe(false)
  })
})

describe('isValidSiteRuleMode', () => {
  it('accepts the three modes', () => {
    expect(isValidSiteRuleMode('always')).toBe(true)
    expect(isValidSiteRuleMode('never')).toBe(true)
    expect(isValidSiteRuleMode('customEngine')).toBe(true)
  })
  it('rejects unknown', () => {
    expect(isValidSiteRuleMode('maybe')).toBe(false)
  })
})

describe('normalizeSiteRules', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeSiteRules(undefined)).toEqual([])
    expect(normalizeSiteRules(null)).toEqual([])
    expect(normalizeSiteRules({})).toEqual([])
  })
  it('keeps well-formed rules and coerces ids', () => {
    const out = normalizeSiteRules([
      { hostPattern: 'example.com', mode: 'always' },
      { id: 'r2', hostPattern: 'x.com', mode: 'never', engine: 'openai' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].hostPattern).toBe('example.com')
    expect(out[0].id).toBeTruthy()
    expect(out[1].engine).toBe('openai')
  })
  it('drops entries with empty hostPattern or invalid mode', () => {
    const out = normalizeSiteRules([
      { hostPattern: '', mode: 'always' },
      { hostPattern: 'x.com', mode: 'bogus' },
      { hostPattern: 'y.com', mode: 'never' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].hostPattern).toBe('y.com')
  })
  it('preserves selectors / excludeSelectors, dropping empties', () => {
    const out = normalizeSiteRules([
      { hostPattern: 'x.com', mode: 'always', selectors: ['p.special', '', '  '], excludeSelectors: ['.ad'] },
    ])
    expect(out[0].selectors).toEqual(['p.special'])
    expect(out[0].excludeSelectors).toEqual(['.ad'])
  })
})
