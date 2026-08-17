import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react'
import { t, resolveLocale, type LocalePref, type StringKey } from '../../shared/i18n'
import {
  PROVIDERS,
  getProvider,
  type ProviderId,
  type ByokSettings,
  normalizeTranslationSettings,
  DEFAULT_TRANSLATION_SETTINGS,
  type TranslationSettings,
} from '../../shared/providers'
import { useStore } from '../../shared/store'
import { testConnection, fetchModels, type FetchedModel } from '../../shared/byok'
import { getLanguage, searchLanguages } from '../../shared/translation'
import { TRANSLATION_THEMES } from '../../shared/translationThemes'
import { TRANSLATION_PERSONAS } from '../../shared/translationPersonas'
import { totalSavedTokens } from '../../shared/translationCache'
import {
  normalizeSiteRules,
  newSiteRuleId,
  type SiteRule,
} from '../../shared/siteRules'
import { CheckIcon, XIcon } from '../../shared/icons'

// ---------------------------------------------------------------------------
// LanguageSelect — searchable language picker. 100+ langs are unwieldy in a
// flat <select>, so we render a search box + a filtered, scrollable list.
function LanguageSelect({
  value,
  locale,
  autoLabel,
  onChange,
}: {
  value: string
  locale: LocalePref
  autoLabel: string
  onChange: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const loc = resolveLocale(locale)
  const current = value === 'auto' ? null : getLanguage(value)
  const matches = useMemo(() => searchLanguages(query), [query])
  // Cap the rendered list for perf/snappiness on long queries.
  const shown = matches.slice(0, 60)
  return (
    <div className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="field w-full text-left flex items-center justify-between"
      >
        <span>{current ? (loc === 'zh' ? current.zh : current.en) : autoLabel}</span>
        <span className="text-ink-faint text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-surface border border-line rounded-lg shadow-lg max-h-64 flex flex-col">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.translation.languageSearch', locale)}
            className="px-2 py-1.5 text-[11px] border-b border-line outline-none bg-transparent"
          />
          <div className="overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange('auto'); setOpen(false); setQuery('') }}
              className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-muted ${value === 'auto' ? 'text-accent font-medium' : 'text-ink-soft'}`}
            >
              {autoLabel}
            </button>
            {shown.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => { onChange(l.code); setOpen(false); setQuery('') }}
                className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-muted ${value === l.code ? 'text-accent font-medium' : 'text-ink-soft'}`}
              >
                {loc === 'zh' ? l.zh : l.en} <span className="text-ink-faint">({l.en})</span>
              </button>
            ))}
            {matches.length > shown.length && (
              <p className="px-2 py-1 text-[10px] text-ink-faint">
                {t('settings.translation.languageMore', locale).replace('{n}', String(matches.length - shown.length))}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CacheControls — shows the saved-tokens/saved-$ readout and a Clear button.
// Reads the cache directly from chrome.storage.local; pure display + clear.
function CacheControls({ ttlDays, locale }: { ttlDays: number; locale: LocalePref }) {
  const [tokens, setTokens] = useState(0)
  const [cleared, setCleared] = useState(false)

  const refresh = useCallback(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    chrome.storage.local.get('lectorCache', (r) => {
      const raw = (r as Record<string, unknown>).lectorCache
      const store = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      setTokens(totalSavedTokens(store as never))
    })
  }, [])
  useEffect(() => { refresh() }, [refresh, ttlDays])

  const clear = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    chrome.storage.local.set({ lectorCache: {} }, () => {
      setTokens(0)
      setCleared(true)
      setTimeout(() => setCleared(false), 1500)
    })
  }
  const savedUsd = (tokens * 2) / 1_000_000
  return (
    <div className="flex items-center justify-between text-[10px] text-ink-faint mb-3">
      <span>
        {tokens > 0
          ? t('settings.translation.cacheStats', locale)
              .replace('{tokens}', tokens.toLocaleString())
              .replace('{usd}', savedUsd.toFixed(3))
          : t('settings.translation.cacheEmpty', locale)}
      </span>
      <button
        type="button"
        onClick={clear}
        className="px-2 py-0.5 rounded border border-line text-ink-soft hover:bg-surface-muted"
      >
        {cleared ? '✓' : t('settings.translation.cacheClear', locale)}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SiteRulesControls — editable list of per-domain rules + "add current site".
function SiteRulesControls({
  rules,
  locale,
  onChange,
}: {
  rules: SiteRule[]
  locale: LocalePref
  onChange: (next: SiteRule[]) => void
}) {
  const [currentHost, setCurrentHost] = useState('')
  useEffect(() => {
    // The side panel runs in its own origin; ask the active tab for its host.
    if (typeof chrome === 'undefined' || !chrome.tabs) return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (url) {
        try { setCurrentHost(new URL(url).hostname) } catch { /* ignore */ }
      }
    })
  }, [])

  const addCurrent = (mode: 'always' | 'never') => {
    if (!currentHost) return
    // Replace any existing rule for the same host (exact pattern), then
    // prepend. Broader suffix patterns (e.g. "com" matching example.com) are
    // deliberately kept — only the exact-host rule is replaced.
    const filtered = rules.filter((r) => r.hostPattern !== currentHost)
    onChange([{ id: newSiteRuleId(), hostPattern: currentHost, mode, createdAt: Date.now() }, ...filtered])
  }
  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id))
  const setMode = (id: string, mode: SiteRule['mode']) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, mode } : r)))

  const cleanRules = normalizeSiteRules(rules)
  return (
    <div className="mb-2">
      {currentHost && (
        <div className="flex gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => addCurrent('always')}
            className="flex-1 px-1 py-1 text-[10.5px] font-medium rounded-lg border border-line text-ink-soft hover:border-accent hover:bg-accent-softer hover:text-accent"
          >
            + {t('settings.translation.siteRules.always', locale)} ({currentHost})
          </button>
          <button
            type="button"
            onClick={() => addCurrent('never')}
            className="flex-1 px-1 py-1 text-[10.5px] font-medium rounded-lg border border-line text-ink-soft hover:border-accent hover:bg-accent-softer hover:text-accent"
          >
            + {t('settings.translation.siteRules.never', locale)}
          </button>
        </div>
      )}
      {cleanRules.length === 0 ? (
        <p className="text-[10px] text-ink-faint mb-2">
          {t('settings.translation.siteRules.empty', locale)}
        </p>
      ) : (
        <ul className="space-y-1 mb-2">
          {cleanRules.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 text-[10.5px]">
              <span className="flex-1 truncate text-ink-soft" title={r.hostPattern}>{r.hostPattern}</span>
              <select
                value={r.mode}
                onChange={(e) => setMode(r.id, e.target.value as SiteRule['mode'])}
                className="field text-[10px] py-0.5"
              >
                <option value="always">{t('settings.translation.siteRules.always', locale)}</option>
                <option value="never">{t('settings.translation.siteRules.never', locale)}</option>
                <option value="customEngine">{t('settings.translation.siteRules.custom', locale)}</option>
              </select>
              <button
                type="button"
                onClick={() => removeRule(r.id)}
                className="text-ink-faint hover:text-danger"
                aria-label={t('settings.translation.siteRules.remove', locale)}
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// (CurrentSiteChip moved to ./CurrentSiteChip.tsx so this module can be
//  lazy-loaded — the chip lives in the always-visible header.)
export interface SettingsViewProps {
  byok: ByokSettings
  onChange: (next: Partial<ByokSettings>) => void
}

function SettingsViewImpl({ byok, onChange }: SettingsViewProps) {
  const [showKey, setShowKey] = useState(false)
  // When true, the model free-text input is shown even if byok.model happens
  // to match a list entry (the user explicitly chose "Custom model id…").
  const [customMode, setCustomMode] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Debounce handle for the translation-settings tab broadcast. Range sliders
  // fire onChange continuously during a drag; without a trailing debounce each
  // tick fans a message out to EVERY tab (chrome.tabs.query({}) + sendMessage).
  const broadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
  }, [])

  const def = getProvider(byok.provider)
  // Resolve a localized provider description, falling back to the English
  // string baked into providers.ts if no i18n entry exists for this provider.
  const descKey = `provider.desc.${byok.provider}` as StringKey
  const providerDesc = t(descKey, byok.locale) === descKey ? def.description : t(descKey, byok.locale)

  const handleProviderChange = (id: ProviderId) => {
    const next = getProvider(id)
    const isCustom = id === 'custom' || id === 'openrouter-custom'
    // Switching provider leaves custom model mode (the new provider has its
    // own preset/fetched list to pick from).
    setCustomMode(false)
    onChange({
      provider: id,
      // Reset to the provider's default model/baseUrl; keep the key.
      model: next.defaultModel,
      baseUrl: isCustom ? byok.baseUrl : '',
    })
    setTestResult(null)
    setFetchedModels(null)
    setFetchError(null)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    // Read the live store rather than the rendered `byok` prop: if the user
    // typed a key and immediately clicked Test before re-render propagated,
    // the prop could be one keystroke stale and we'd test the previous key.
    // useStore.getState() always returns the freshest committed value.
    const result = await testConnection({ ...useStore.getState().byok })
    setTestResult(result)
    setTesting(false)
  }

  const runFetch = async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const live = useStore.getState().byok
      const models = await fetchModels({ ...live })
      setFetchedModels(models)
      if (models.length > 0) {
        // If the current model isn't in the fetched list, snap to the first.
        if (!models.some((m) => m.id === live.model)) {
          onChange({ model: models[0].id })
        }
      } else {
        setFetchError(t('settings.model.fetchEmpty', byok.locale))
      }
    } catch (e) {
      setFetchedModels(null)
      setFetchError(e instanceof Error ? e.message : t('settings.model.fetchFail', byok.locale))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{t('settings.title', byok.locale)}</h3>
      </div>

      <div className="overflow-y-auto px-4 py-3.5 space-y-3.5">
          <p className="text-[11px] text-ink-soft leading-relaxed bg-surface-muted/50 rounded-lg px-3 py-2">
            {t('settings.privacyNote', byok.locale)}
          </p>

          {/* Language */}
          <div>
            <label className="label mb-1.5">
              {t('settings.language', byok.locale)}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['auto', 'en', 'zh'] as LocalePref[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onChange({ locale: opt })}
                  className={`px-2 py-2 text-[11px] font-medium rounded-lg border transition-colors duration-150 ease-out ${
                    byok.locale === opt
                      ? 'border-accent bg-accent-softer text-accent'
                      : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {opt === 'auto'
                    ? t('settings.language.auto', byok.locale)
                    : opt === 'en'
                      ? t('settings.language.en', byok.locale)
                      : t('settings.language.zh', byok.locale)}
                </button>
              ))}
            </div>
          </div>

          {/* Provider picker */}
          <div>
            <label className="label mb-1.5">{t('settings.provider', byok.locale)}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.values(PROVIDERS).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`px-1.5 py-2 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                    byok.provider === p.id
                      ? 'border-accent bg-accent-softer text-accent'
                      : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">{providerDesc}</p>
          </div>

          {/* Custom base URL */}
          {(byok.provider === 'custom' || byok.provider === 'openrouter-custom') && (
            <div>
              <label htmlFor="lector-base-url" className="label mb-1.5">
                {t('settings.baseUrl', byok.locale)} <span className="text-ink-faint font-normal">{t('settings.baseUrl.hint', byok.locale)}</span>
              </label>
              <input
                id="lector-base-url"
                type="url"
                value={byok.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="field"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label htmlFor="lector-api-key" className="label mb-1.5">{t('settings.apiKey', byok.locale)}</label>
            <div className="relative">
              <input
                id="lector-api-key"
                type={showKey ? 'text' : 'password'}
                value={byok.apiKey}
                onChange={(e) => {
                  onChange({ apiKey: e.target.value })
                  setTestResult(null)
                }}
                placeholder={t('settings.apiKey.placeholder', byok.locale)}
                autoComplete="off"
                spellCheck={false}
                className="field pr-16 font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint hover:text-ink-soft px-1.5 py-0.5 transition-colors"
              >
                {showKey ? t('settings.apiKey.hide', byok.locale) : t('settings.apiKey.show', byok.locale)}
              </button>
            </div>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-[10px] text-accent hover:text-accent-hover hover:underline"
              >
                {t('settings.apiKey.getKey', byok.locale).replace('{label}', def.label)}
              </a>
            )}
          </div>

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="lector-model" className="label">{t('settings.model', byok.locale)}</label>
              <button
                onClick={runFetch}
                disabled={fetching || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
                title={t('settings.model.fetch', byok.locale)}
                className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-40 transition-colors"
              >
                {fetching ? t('settings.model.fetching', byok.locale) : fetchedModels ? t('settings.model.refetch', byok.locale) : t('settings.model.fetch', byok.locale)}
              </button>
            </div>

            {/* Dropdown: prefer fetched models, fall back to presets. */}
            {(() => {
              const list = fetchedModels && fetchedModels.length > 0
                ? fetchedModels.map((m) => ({ id: m.id, label: m.label || m.id }))
                : def.models.map((m) => ({ id: m.id, label: m.label || m.id }))
              const currentInList = list.some((m) => m.id === byok.model)
              if (list.length > 0) {
                return (
                  <select
                    id="lector-model"
                    value={currentInList && !customMode ? byok.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        // Reveal the free-text input WITHOUT discarding the
                        // current model. Previously this reset byok.model to
                        // the provider default (customModel was '' on first
                        // switch), silently losing whatever the user had set.
                        setCustomMode(true)
                      } else {
                        setCustomMode(false)
                        onChange({ model: e.target.value })
                      }
                    }}
                    className="field"
                  >
                    {list.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('settings.model.custom', byok.locale)}</option>
                  </select>
                )
              }
              return null
            })()}

            {fetchError && (
              <div className="mt-1.5 text-[10px] text-warn bg-warn-soft/50 rounded-md px-2 py-1">{fetchError}</div>
            )}
            {fetchedModels && fetchedModels.length > 0 && (
              <div className="mt-1 text-[10px] text-ink-faint">{t('settings.model.fetchedCount', byok.locale).replace('{n}', String(fetchedModels.length))}</div>
            )}

            {/* Free-text input: when custom mode is on, or no list matches. */}
            {(customMode ||
              !(fetchedModels && fetchedModels.length > 0 ? fetchedModels : def.models).some((m) => m.id === byok.model)
            ) && (
              <input
                type="text"
                aria-label={t('settings.model', byok.locale)}
                value={byok.model}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder={def.defaultModel || 'model id, e.g. gpt-4o-mini'}
                className="field mt-1.5 font-mono"
              />
            )}
          </div>

          {/* Test connection */}
          <div className="pt-0.5">
            <button
              onClick={runTest}
              disabled={testing || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
              className="btn-outline w-full py-2 text-[12px]"
            >
              {testing ? t('settings.testing', byok.locale) : t('settings.test', byok.locale)}
            </button>
            {testResult && (
              <div
                className={`mt-2 text-[11px] px-2.5 py-2 rounded-lg flex items-start gap-1.5 leading-relaxed ${
                  testResult.ok ? 'bg-success-soft/60 text-success' : 'bg-danger-soft/60 text-danger'
                }`}
              >
                <span className="mt-px flex-shrink-0">
                  {testResult.ok ? <CheckIcon size={13} /> : <XIcon size={13} />}
                </span>
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Translation settings */}
          {(() => {
            const ts = { ...DEFAULT_TRANSLATION_SETTINGS, ...normalizeTranslationSettings(byok.translation) }
            const setTs = (patch: Partial<TranslationSettings>) => {
              const next = { ...ts, ...patch }
              onChange({ translation: next })
              // Broadcast to content scripts so display mode updates live.
              // Trailing-debounced 300ms so a slider drag doesn't fan a
              // message burst out to every tab on every tick.
              if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
              broadcastTimer.current = setTimeout(() => {
                broadcastTimer.current = null
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                  chrome.tabs.query({}).then((tabs) => {
                    for (const tab of tabs) {
                      if (tab.id !== undefined) {
                        chrome.tabs
                          .sendMessage(tab.id, { action: 'lector-translation-settings-changed' })
                          .catch(() => {})
                      }
                    }
                  }).catch(() => {})
                }
              }, 300)
            }
            return (
              <div className="pt-1 border-t border-line">
                <label className="label mb-1.5 block">{t('settings.translation.title', byok.locale)}</label>

                {/* Target language (searchable — 100+ langs need search) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.targetLanguage', byok.locale)}</label>
                <LanguageSelect
                  value={ts.targetLanguage}
                  locale={byok.locale}
                  autoLabel={t('settings.translation.targetLanguage.auto', byok.locale)}
                  onChange={(code) => setTs({ targetLanguage: code as TranslationSettings['targetLanguage'] })}
                />

                {/* Display mode */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.displayMode', byok.locale)}</label>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {(['bilingual', 'translationOnly', 'hover'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setTs({ displayMode: m })}
                      className={`px-1 py-1.5 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                        ts.displayMode === m
                          ? 'border-accent bg-accent-softer text-accent'
                          : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {t(('settings.translation.displayMode.' + m) as StringKey, byok.locale)}
                    </button>
                  ))}
                </div>

                {/* Auto-translate toggle */}
                <label className="flex items-center gap-2 text-[11px] text-ink-soft mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ts.autoTranslate}
                    onChange={(e) => setTs({ autoTranslate: e.target.checked })}
                    className="accent-[#9C6B3C]"
                  />
                  {t('settings.translation.autoTranslate', byok.locale)}
                </label>

                {/* Concurrency slider */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.concurrency', byok.locale)}: {ts.concurrency}
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={ts.concurrency}
                  onChange={(e) => setTs({ concurrency: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C]"
                />

                {/* Translation theme (style) picker — Immersive-parity */}
                <label className="text-[11px] text-ink-soft mb-1 mt-3 block">{t('settings.translation.theme', byok.locale)}</label>
                <select
                  value={ts.theme}
                  onChange={(e) => setTs({ theme: e.target.value })}
                  className="field w-full mb-2"
                >
                  {TRANSLATION_THEMES.map((th) => (
                    <option key={th.id} value={th.id}>
                      {byok.locale === 'zh' ? th.zh : th.en}
                    </option>
                  ))}
                </select>

                {/* Font size slider */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.fontSize', byok.locale)}: {ts.fontSize.toFixed(2)}
                </label>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.02}
                  value={ts.fontSize}
                  onChange={(e) => setTs({ fontSize: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C] mb-2"
                />

                {/* Reading-focus toggle (surpass-feature) */}
                <label className="flex items-center gap-2 text-[11px] text-ink-soft mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ts.readingFocus}
                    onChange={(e) => setTs({ readingFocus: e.target.checked })}
                    className="accent-[#9C6B3C]"
                  />
                  {t('settings.translation.readingFocus', byok.locale)}
                </label>

                {/* AI Expert persona */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.persona', byok.locale)}</label>
                <select
                  value={ts.persona}
                  onChange={(e) => setTs({ persona: e.target.value })}
                  className="field w-full mb-2"
                >
                  {TRANSLATION_PERSONAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {byok.locale === 'zh' ? p.zh : p.en}
                    </option>
                  ))}
                </select>

                {/* Page scope (smart vs whole) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.pageScope', byok.locale)}</label>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {(['smart', 'whole'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setTs({ pageScope: s })}
                      className={`px-1 py-1.5 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                        ts.pageScope === s
                          ? 'border-accent bg-accent-softer text-accent'
                          : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {t(('settings.translation.pageScope.' + s) as StringKey, byok.locale)}
                    </button>
                  ))}
                </div>

                {/* Custom CSS (advanced) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.customCss', byok.locale)}</label>
                <textarea
                  value={ts.customCss}
                  onChange={(e) => setTs({ customCss: e.target.value })}
                  rows={2}
                  placeholder=".lector-bilingual { color: #c0392b; }"
                  className="field w-full mb-1 font-mono text-[10.5px]"
                />
                <p className="text-[10px] text-ink-faint mb-2">{t('settings.translation.customCssHint', byok.locale)}</p>

                {/* Translation cache */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.cacheTtl', byok.locale)}: {ts.cacheTtlDays}
                </label>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={ts.cacheTtlDays}
                  onChange={(e) => setTs({ cacheTtlDays: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C] mb-1"
                />
                <p className="text-[10px] text-ink-faint mb-1">{t('settings.translation.cacheHint', byok.locale)}</p>
                <CacheControls ttlDays={ts.cacheTtlDays} locale={byok.locale} />

                {/* Site rules */}
                <label className="text-[11px] text-ink-soft mb-1 mt-1 block">{t('settings.translation.siteRules', byok.locale)}</label>
                <SiteRulesControls
                  rules={ts.siteRules}
                  locale={byok.locale}
                  onChange={(next) => setTs({ siteRules: next })}
                />
              </div>
            )
          })()}
        </div>
    </div>
  )
}

// memo'd so unrelated App re-renders don't re-render this view when props are unchanged.
export const SettingsView = memo(SettingsViewImpl)
