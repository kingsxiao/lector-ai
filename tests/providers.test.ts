import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRANSLATION_SETTINGS,
  normalizeByokSettings,
  normalizeTranslationSettings,
  DEFAULT_BYOK_SETTINGS,
  PROVIDERS,
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
    // Default scope is 'whole' (translate every block, matching the long-standing
    // behavior + Immersive Translate). 'smart' is opt-in and can drop text on
    // list/app pages, so it must NOT be the default.
    expect(out.pageScope).toBe('whole')
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
  it('rejects unknown stored language and persona ids', () => {
    const out = normalizeTranslationSettings({
      targetLanguage: 'not-a-language',
      persona: 'not-a-persona',
    })
    expect(out.targetLanguage).toBe(DEFAULT_TRANSLATION_SETTINGS.targetLanguage)
    expect(out.persona).toBe(DEFAULT_TRANSLATION_SETTINGS.persona)
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

describe('provider transports', () => {
  it('uses the native Responses API only for the official OpenAI provider', () => {
    expect(PROVIDERS.openai.transport).toBe('openai-responses')
  })

  it('keeps compatible and Anthropic providers on their actual wire protocols', () => {
    expect(PROVIDERS.openrouter.transport).toBe('openai-chat-completions')
    expect(PROVIDERS.deepseek.transport).toBe('openai-chat-completions')
    expect(PROVIDERS['openrouter-custom'].transport).toBe('openai-chat-completions')
    expect(PROVIDERS.anthropic.transport).toBe('anthropic-messages')
  })

  it('ships active Anthropic/OpenRouter defaults', () => {
    expect(PROVIDERS.anthropic.defaultModel).toBe('claude-haiku-4-5-20251001')
    expect(PROVIDERS.anthropic.models.map((model) => model.id)).not.toContain('claude-3-5-haiku-latest')
    expect(PROVIDERS.openrouter.defaultModel).toBe('openai/gpt-4o-mini')
  })
})

describe('normalizeByokSettings', () => {
  it('migrates retired built-in model ids without rewriting arbitrary custom models', () => {
    expect(normalizeByokSettings({
      provider: 'openai', model: 'o1-mini', apiKey: 'x',
    }).model).toBe('gpt-4o-mini')
    expect(normalizeByokSettings({
      provider: 'openai', model: 'o1-mini-2024-09-12', apiKey: 'x',
    }).model).toBe('gpt-4o-mini')
    expect(normalizeByokSettings({
      provider: 'anthropic', model: 'claude-3-5-haiku-latest', apiKey: 'x',
    }).model).toBe('claude-haiku-4-5-20251001')
    expect(normalizeByokSettings({
      provider: 'openrouter', model: 'anthropic/claude-3.5-haiku', apiKey: 'x',
    }).model).toBe('openai/gpt-4o-mini')
    expect(normalizeByokSettings({
      provider: 'custom', model: 'claude-3-5-haiku-latest', apiKey: 'x', baseUrl: 'https://local.test/v1',
    }).model).toBe('claude-3-5-haiku-latest')
    expect(normalizeByokSettings({
      provider: 'custom', model: 'o1-mini', apiKey: 'x', baseUrl: 'https://local.test/v1',
    }).model).toBe('o1-mini')
  })
  it('falls back from corrupted provider/locale and repairs collection settings', () => {
    const out = normalizeByokSettings({
      provider: 'missing-provider',
      locale: 'xx',
      apiKey: 42,
      model: null,
      translation: { targetLanguage: 'missing-language', concurrency: 99 },
    })
    expect(out.provider).toBe(DEFAULT_BYOK_SETTINGS.provider)
    expect(out.locale).toBe(DEFAULT_BYOK_SETTINGS.locale)
    expect(out.apiKey).toBe('')
    expect(out.model).toBeTruthy()
    expect(out.translation?.targetLanguage).toBe('auto')
    expect(out.translation?.concurrency).toBe(10)
  })
})
