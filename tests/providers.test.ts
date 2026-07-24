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
  it('keeps valid fields and drops invalid ones', () => {
    const out = normalizeTranslationSettings({
      targetLanguage: 'ja',
      displayMode: 'hover',
      autoTranslate: true,
      concurrency: 3,
    })
    expect(out).toEqual({ targetLanguage: 'ja', displayMode: 'hover', autoTranslate: true, concurrency: 3 })
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
})

describe('DEFAULT_BYOK_SETTINGS', () => {
  it('does NOT set translation by default (lazy default applied at read time)', () => {
    expect(DEFAULT_BYOK_SETTINGS.translation).toBeUndefined()
  })
})
