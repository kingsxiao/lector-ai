import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRANSLATION_SETTINGS,
  normalizeTranslationSettings,
  DEFAULT_BYOK_SETTINGS,
} from '../src/shared/providers'

describe('normalizeTranslationSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeTranslationSettings(null)).toEqual(DEFAULT_TRANSLATION_SETTINGS)
    expect(normalizeTranslationSettings('x')).toEqual(DEFAULT_TRANSLATION_SETTINGS)
  })
  it('keeps valid fields and fills defaults for the extended schema', () => {
    const out = normalizeTranslationSettings({
      targetLanguage: 'ja',
      displayMode: 'hover',
      autoTranslate: true,
      concurrency: 3,
    })
    // Explicit fields preserved …
    expect(out.targetLanguage).toBe('ja')
    expect(out.displayMode).toBe('hover')
    expect(out.autoTranslate).toBe(true)
    expect(out.concurrency).toBe(3)
    // … and the new fields default (forward-compatible for upgrades).
    expect(out.theme).toBe('default')
    expect(out.fontSize).toBe(0.92)
    expect(out.customCss).toBe('')
    expect(out.readingFocus).toBe(false)
    expect(out.siteRules).toEqual([])
    expect(out.cacheTtlDays).toBe(30)
    expect(out.persona).toBe('general')
    expect(out.pageScope).toBe('smart')
  })
  it('clamps concurrency to 10 and rejects bad displayMode', () => {
    const out = normalizeTranslationSettings({ concurrency: 99, displayMode: 'weird' })
    expect(out.concurrency).toBe(10)
    expect(out.displayMode).toBe('bilingual')
  })
  it('clamps concurrency below 1 to 1', () => {
    const out = normalizeTranslationSettings({ concurrency: 0 })
    expect(out.concurrency).toBe(1)
  })
  it('clamps concurrency above 10 to 10', () => {
    const out = normalizeTranslationSettings({ concurrency: 50 })
    expect(out.concurrency).toBe(10)
  })
  it('accepts and validates the new theme/fontSize/persona/pageScope fields', () => {
    const out = normalizeTranslationSettings({
      theme: 'dashed', fontSize: 1.1, persona: 'academic', pageScope: 'whole',
    })
    expect(out.theme).toBe('dashed')
    expect(out.fontSize).toBe(1.1)
    expect(out.persona).toBe('academic')
    expect(out.pageScope).toBe('whole')
  })
  it('rejects an unknown theme id (falls back to default)', () => {
    expect(normalizeTranslationSettings({ theme: 'bogus' }).theme).toBe('default')
  })
  it('clamps fontSize into [0.6, 1.6]', () => {
    expect(normalizeTranslationSettings({ fontSize: 9 }).fontSize).toBe(1.6)
    expect(normalizeTranslationSettings({ fontSize: 0.1 }).fontSize).toBe(0.6)
  })
  it('clamps cacheTtlDays below 0 to 0 (cache disabled)', () => {
    expect(normalizeTranslationSettings({ cacheTtlDays: -5 }).cacheTtlDays).toBe(0)
  })
  it('normalizes a malformed siteRules array', () => {
    const out = normalizeTranslationSettings({ siteRules: [{ hostPattern: 'x.com', mode: 'always' }, { mode: 'bad' }] })
    expect(out.siteRules).toHaveLength(1)
    expect(out.siteRules[0].hostPattern).toBe('x.com')
  })
})

describe('DEFAULT_BYOK_SETTINGS', () => {
  it('does NOT set translation by default (lazy default applied at read time)', () => {
    expect(DEFAULT_BYOK_SETTINGS.translation).toBeUndefined()
  })
})
