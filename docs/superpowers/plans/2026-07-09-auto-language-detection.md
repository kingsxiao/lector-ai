# Auto Language Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect the user's language from the browser locale and switch the entire extension UI (side panel, content-script toolbar/popups, context menus) between English and Chinese, with a manual override in Settings.

**Architecture:** A single shared module `src/shared/i18n.ts` holds the en/zh string dictionary and a `t(key, pref)` lookup. The language preference (`'auto' | 'en' | 'zh'`) rides on the existing `ByokSettings` object so it flows to all three surfaces through the storage mechanism that already distributes settings. `t()` takes a `StringKey` literal-union type derived from a `const` dictionary, so a typo'd or missing key is a compile error.

**Tech Stack:** TypeScript, React 18, Chrome Extension Manifest V3, Vite. No test framework — verification is `npm run typecheck` + `npm run build:extension` + a manual string audit.

## Global Constraints

- Two locales only: `en` and `zh`. Locale pref is `'auto' | 'en' | 'zh'`; default `'auto'`.
- Detection reads `navigator.languages` / `navigator.language`; any tag whose primary subtag is `zh` → `zh`, everything else → `en`. Never throws.
- `t()` signature: `t(key: StringKey, pref: LocalePref): string` where `StringKey = keyof typeof STRINGS`. The `STRINGS` object MUST be declared `const` (not `let`/`var`) so the literal-key union works.
- LLM system prompts and suggestion `prompt` fields stay English (they are model instructions, not UI copy). Only user-visible strings are localized.
- Brand name `Lector AI` and the `L` logo glyph are NOT translated.
- Interpolation tokens like `{n}`, `{msg}`, `{label}`, `{settings}` are substituted by the caller via `.replace(...)`. `t()` returns the raw template.
- Every task ends with `npm run typecheck` passing and a commit.

---

## Task 1: Create the i18n module

**Files:**
- Create: `src/shared/i18n.ts`

**Interfaces:**
- Produces: `type Locale`, `type LocalePref`, `function detectLocale()`, `function resolveLocale(pref)`, `const STRINGS`, `type StringKey`, `function t(key, pref)`.

- [ ] **Step 1: Create `src/shared/i18n.ts`**

```ts
// Shared i18n for all surfaces (side panel, content script, background).
//
// The language preference lives in ByokSettings.locale and flows to every
// surface through chrome.storage.local. t() takes a StringKey (a literal
// union derived from STRINGS), so a typo'd or missing key is a compile error.

export type Locale = 'en' | 'zh'
export type LocalePref = 'auto' | Locale

/** Read the browser locale and map it to one of our supported locales. */
export function detectLocale(): Locale {
  const langs =
    (typeof navigator !== 'undefined' &&
      (navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [])) ||
    []
  for (const l of langs) {
    const primary = String(l || '').toLowerCase().split('-')[0]
    if (primary === 'zh') return 'zh'
  }
  return 'en'
}

/** Resolve a pref to a concrete locale, running detection for 'auto'. */
export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'auto' ? detectLocale() : pref
}

export const STRINGS = {
  // --- side panel: header / empty state ---
  'side.header.defaultTitle': { en: 'Lector AI', zh: 'Lector AI' },
  'side.header.noKey': {
    en: 'No API key — tap settings',
    zh: '未设置 API Key — 点击设置',
  },
  'side.onboard.title': { en: 'Bring your own key 🔑', zh: '自带密钥 🔑' },
  'side.onboard.body': {
    en: 'Lector is free and private — you pay your AI provider directly. Open {settings} to add a key (OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint).',
    zh: 'Lector 免费且私密 —— 你直接向 AI 服务商付费。打开{settings}添加密钥（OpenAI、Anthropic、OpenRouter 或任意 OpenAI 兼容接口）。',
  },
  'side.onboard.settingsLink': { en: 'Settings', zh: '设置' },
  'side.empty.title': { en: 'Chat with this page', zh: '与本文对话' },
  'side.empty.subtitle': {
    en: "Ask anything about the article you're reading. Lector reads the page with you.",
    zh: '向正在阅读的文章提问，Lector 与你一起阅读。',
  },
  'side.empty.noPage': {
    en: 'Open a web article, then Lector can read along.',
    zh: '打开一篇网页文章，Lector 即可一同阅读。',
  },
  'side.composer.placeholder.ready': { en: 'Ask about this page…', zh: '向本文提问…' },
  'side.composer.placeholder.noKey': {
    en: 'Add an API key in settings to begin…',
    zh: '在设置中添加 API Key 以开始…',
  },
  'side.composer.hint': {
    en: 'Enter to send · Shift+Enter for newline',
    zh: '回车发送 · Shift+回车换行',
  },
  'side.composer.newChat': { en: '+ New chat', zh: '+ 新对话' },
  'side.error.addKey': {
    en: 'Add your API key in Settings to start chatting.',
    zh: '请在设置中添加 API Key 后开始对话。',
  },
  'side.thinking': { en: 'thinking…', zh: '思考中…' },

  // --- side panel: suggestions (label only; prompt stays English) ---
  'side.suggest.summarize': { en: 'Summarize', zh: '总结全文' },
  'side.suggest.keyPoints': { en: 'Key points', zh: '关键观点' },
  'side.suggest.explain': { en: 'Explain', zh: '解释难点' },
  'side.suggest.followup': { en: 'Follow-up', zh: '继续追问' },

  // --- side panel: library drawer ---
  'side.library.title': { en: 'Library', zh: '历史记录' },
  'side.library.empty': {
    en: 'Saved conversations will appear here.',
    zh: '保存的对话将显示在此。',
  },
  'side.library.clearAll': { en: 'Clear all', zh: '全部清除' },

  // --- settings drawer ---
  'settings.title': { en: '🔑 Bring Your Own Key', zh: '🔑 自带密钥' },
  'settings.privacyNote': {
    en: 'Lector is free and private. Your key is stored only in this browser and sent directly to your chosen provider — never to us.',
    zh: 'Lector 免费且私密。你的密钥仅存储在本浏览器中，并直接发送至你选择的服务商 —— 绝不发送给我们。',
  },
  'settings.provider': { en: 'Provider', zh: '服务商' },
  'settings.baseUrl': { en: 'Base URL', zh: 'Base URL' },
  'settings.baseUrl.hint': { en: '(OpenAI-compatible)', zh: '（OpenAI 兼容）' },
  'settings.apiKey': { en: 'API Key', zh: 'API Key' },
  'settings.apiKey.placeholder': { en: 'sk-…', zh: 'sk-…' },
  'settings.apiKey.show': { en: 'show', zh: '显示' },
  'settings.apiKey.hide': { en: 'hide', zh: '隐藏' },
  'settings.apiKey.getKey': { en: 'Get a key from {label} →', zh: '从 {label} 获取密钥 →' },
  'settings.model': { en: 'Model', zh: '模型' },
  'settings.model.fetch': { en: '⬇ Fetch models', zh: '⬇ 拉取模型列表' },
  'settings.model.refetch': { en: '↻ Refetch', zh: '↻ 重新拉取' },
  'settings.model.fetching': { en: 'Fetching…', zh: '拉取中…' },
  'settings.model.custom': { en: 'Custom model id…', zh: '自定义模型 id…' },
  'settings.model.fetchedCount': { en: 'Fetched {n} models', zh: '已拉取 {n} 个模型' },
  'settings.model.fetchEmpty': {
    en: 'This endpoint returned no model list; enter the model id manually.',
    zh: '该接口未返回模型列表，请手动填写模型 id。',
  },
  'settings.model.fetchFail': { en: 'Fetch failed', zh: '拉取失败' },
  'settings.test': { en: 'Test connection', zh: '测试连接' },
  'settings.testing': { en: 'Testing…', zh: '测试中…' },
  'settings.done': { en: 'Done', zh: '完成' },
  'settings.language': { en: 'Language', zh: '语言' },
  'settings.language.auto': { en: 'Auto', zh: '自动' },
  'settings.language.en': { en: 'English', zh: 'English' },
  'settings.language.zh': { en: '中文', zh: '中文' },

  // --- content script: toolbar ---
  'toolbar.translate': { en: '🌐 Translate', zh: '🌐 翻译' },
  'toolbar.explain': { en: '💬 Explain', zh: '💬 解释' },
  'toolbar.summarize': { en: '📄 Summarize', zh: '📄 摘要' },
  'toolbar.ask': { en: '🤖 Ask', zh: '🤖 提问' },

  // --- content script: popups ---
  'popup.loading': { en: 'AI processing…', zh: 'AI 处理中…' },
  'popup.result.translate': { en: '🌐 Translation', zh: '🌐 翻译结果' },
  'popup.result.summary': { en: '📄 Summary', zh: '📄 摘要结果' },
  'popup.result.explain': { en: '💡 Explanation', zh: '💡 解释' },
  'popup.close': { en: 'Close', zh: '关闭' },
  'popup.copy': { en: '📋 Copy', zh: '📋 复制' },
  'popup.copied': { en: '✅ Copied', zh: '✅ 已复制' },
  'popup.continueInPanel': {
    en: '🤖 Continue in side panel',
    zh: '🤖 在侧栏继续',
  },

  // --- content script: FAB & errors ---
  'fab.title': { en: 'Open Lector AI', zh: '打开 Lector AI' },
  'err.addKey': {
    en: 'Add your API Key in Settings to use this.',
    zh: '请在侧栏设置中添加 API Key 后使用。',
  },
  'err.requestFailed': { en: 'Request failed', zh: '请求失败' },
  'err.failedPrefix': { en: 'Failed: {msg}', zh: '失败: {msg}' },
  'err.emptyResponse': { en: '(empty response)', zh: '(空响应)' },
  'err.extensionNotLoaded': {
    en: 'Extension not loaded; please refresh the page.',
    zh: '扩展未正确加载，请刷新页面。',
  },

  // --- background: context menus ---
  'menu.summarize': { en: 'Summarize with Lector AI', zh: '用 Lector AI 总结' },
  'menu.translate': { en: 'Translate with Lector AI', zh: '用 Lector AI 翻译' },
  'menu.explain': { en: 'Explain with Lector AI', zh: '用 Lector AI 解释' },
  'menu.ask': { en: 'Ask Lector AI about this…', zh: '向 Lector AI 提问…' },
} as const

export type StringKey = keyof typeof STRINGS

/**
 * Look up a localized string. Falls back to English, then to the key itself.
 * Because `key` is typed as StringKey, a missing key is impossible at runtime.
 */
export function t(key: StringKey, pref: LocalePref): string {
  const locale = resolveLocale(pref)
  const entry = STRINGS[key]
  return (entry && (entry[locale] || entry.en)) || key
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (the module compiles standalone; nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add src/shared/i18n.ts
git commit -m "feat(i18n): add shared i18n module with en/zh dictionary"
```

---

## Task 2: Add `locale` to ByokSettings (both defaults)

**Files:**
- Modify: `src/shared/providers.ts` (interface `ByokSettings` ~line 395, `DEFAULT_BYOK_SETTINGS` ~line 403)
- Modify: `src/shared/byok.ts` (`settingsWithDefaults()` ~line 45)

**Interfaces:**
- Consumes: `LocalePref` from `src/shared/i18n.ts`.
- Produces: `ByokSettings.locale: LocalePref` available to all surfaces. `ByokSettings` re-exports `LocalePref` and `Locale` types for convenience.

- [ ] **Step 1: Update `src/shared/providers.ts`**

Add the import at the top (after the existing header comment, with the other imports — there are none yet, so add it as the first import line):

```ts
import type { Locale, LocalePref } from './i18n'
export type { Locale, LocalePref }
```

Change the `ByokSettings` interface (around line 395) from:

```ts
export interface ByokSettings {
  provider: ProviderId
  apiKey: string
  model: string
  /** Only used by the custom provider. */
  baseUrl: string
}
```

to:

```ts
export interface ByokSettings {
  provider: ProviderId
  apiKey: string
  model: string
  /** Only used by the custom provider. */
  baseUrl: string
  /** UI language: 'auto' follows the browser locale. */
  locale: LocalePref
}
```

Change `DEFAULT_BYOK_SETTINGS` (around line 403) from:

```ts
export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  provider: 'openrouter',
  apiKey: '',
  model: PROVIDERS.openrouter.defaultModel,
  baseUrl: '',
}
```

to:

```ts
export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  provider: 'openrouter',
  apiKey: '',
  model: PROVIDERS.openrouter.defaultModel,
  baseUrl: '',
  locale: 'auto',
}
```

- [ ] **Step 2: Update `src/shared/byok.ts` `settingsWithDefaults()`**

Change (around line 45):

```ts
function settingsWithDefaults(): ByokSettings {
  return {
    provider: 'openrouter',
    apiKey: '',
    model: getProvider('openrouter').defaultModel,
    baseUrl: '',
  }
}
```

to:

```ts
function settingsWithDefaults(): ByokSettings {
  return {
    provider: 'openrouter',
    apiKey: '',
    model: getProvider('openrouter').defaultModel,
    baseUrl: '',
    locale: 'auto',
  }
}
```

Note: `getSettings()` in this file already does `{ ...settingsWithDefaults(), ...(stored || {}) }`, so an existing user whose stored object lacks `locale` gets `'auto'` from the spread. No migration code needed.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/providers.ts src/shared/byok.ts
git commit -m "feat(i18n): add locale field to ByokSettings (both defaults)"
```

---

## Task 3: Localize the side panel (App.tsx)

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `t`, `StringKey`, `LocalePref` from `src/shared/i18n.ts`; `byok.locale` from the store.

- [ ] **Step 1: Add imports and a `tr` helper**

At the top of `src/sidepanel/App.tsx`, add to the existing imports (after line 10, the byok import):

```ts
import { t, type StringKey } from '../shared/i18n'
```

Inside the `App` component (after the `const { byok, ... } = useStore()` line, ~line 31), add a small helper that binds the current locale pref:

```ts
  const tr = (key: StringKey) => t(key, byok.locale)
```

- [ ] **Step 2: Localize the SUGGESTIONS labels**

Change the `SUGGESTIONS` constant (lines 19-24) so `label` becomes a `StringKey`:

```ts
const SUGGESTIONS: { label: StringKey; prompt: string }[] = [
  { label: 'side.suggest.summarize', prompt: 'Summarize this page in 3-5 bullets and a one-line takeaway.' },
  { label: 'side.suggest.keyPoints', prompt: 'What are the 3 most important points the author is making?' },
  { label: 'side.suggest.explain', prompt: 'Explain the most difficult concept on this page simply, with an example.' },
  { label: 'side.suggest.followup', prompt: 'What questions should I ask myself to test my understanding of this page?' },
]
```

(`SUGGESTIONS` is module-level, outside the component, so it cannot use `tr`; the render site calls `tr(s.label)`.)

- [ ] **Step 3: Localize the header**

In the header JSX (~lines 198-230), replace:

- `{page?.title || 'Lector AI'}` → `{page?.title || tr('side.header.defaultTitle')}`
- `: 'No API key — tap settings'` → `: tr('side.header.noKey')`
- `title="Library"` → `title={tr('side.library.title')}`
- `title="Settings"` → `title={tr('settings.title')}`

- [ ] **Step 4: Localize the empty-state + onboarding block**

Replace the BYOK onboarding card (~lines 234-243). The body string has a `{settings}` token marking where the clickable link goes. Replace the whole card content with:

```tsx
        {!providerConfigured && (
          <div className="mx-1 p-3 rounded-xl bg-blue-50 border border-blue-100 text-[12px] text-blue-700">
            <div className="font-semibold mb-1">{tr('side.onboard.title')}</div>
            {(() => {
              const body = tr('side.onboard.body')
              const [before, after] = body.split('{settings}')
              return (
                <>
                  {before}
                  <button onClick={() => setShowSettings(true)} className="underline font-medium">
                    {tr('side.onboard.settingsLink')}
                  </button>
                  {after}
                </>
              )
            })()}
          </div>
        )}
```

Replace the empty-state text (~lines 246-270):

- `<h2 ...>Chat with this page</h2>` → `<h2 ...>{tr('side.empty.title')}</h2>`
- The subtitle `<p>` → `{tr('side.empty.subtitle')}`
- Suggestion button label `{s.label}` → `{tr(s.label)}`
- The no-page `<p>` text → `{tr('side.empty.noPage')}`

- [ ] **Step 5: Localize the "thinking" indicator**

Replace `thinking…` (~line 288) → `{tr('side.thinking')}`.

- [ ] **Step 6: Localize the composer**

In the composer JSX (~lines 297-333):

- `placeholder={providerConfigured ? 'Ask about this page…' : 'Add an API key in settings to begin…'}` →
  `placeholder={providerConfigured ? tr('side.composer.placeholder.ready') : tr('side.composer.placeholder.noKey')}`
- `Enter to send · Shift+Enter for newline` → `{tr('side.composer.hint')}`
- `+ New chat` → `{tr('side.composer.newChat')}`

- [ ] **Step 7: Localize the `handleSend` error**

In `handleSend` (~line 95):

```ts
        setError('Add your API key in Settings to start chatting.')
```

→

```ts
        setError(t('side.error.addKey', byok.locale))
```

(Inside `handleSend`, `byok` is in scope from the component closure; `tr` would also work but `t(..., byok.locale)` is explicit and avoids re-creating `tr` inside the callback.)

- [ ] **Step 8: Localize the Library drawer**

In the library drawer JSX (~lines 346-405):

- `<h3 ...>Library</h3>` → `<h3 ...>{tr('side.library.title')}</h3>`
- `Saved conversations will appear here.` → `{tr('side.library.empty')}`
- `Clear all` (button text) → `{tr('side.library.clearAll')}`

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If a key is misspelled, the `StringKey` type makes it a compile error here.

- [ ] **Step 10: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(i18n): localize side panel UI strings"
```

---

## Task 4: Add the language selector to the Settings drawer

**Files:**
- Modify: `src/sidepanel/App.tsx` (the `SettingsDrawer` component, ~lines 420-671)

**Interfaces:**
- Consumes: `LocalePref` type; `byok.locale`; `onChange({ locale })`.

- [ ] **Step 1: Add the import for the `LocalePref` type**

At the top of `App.tsx`, change the i18n import line added in Task 3 to also import the type:

```ts
import { t, type StringKey, type LocalePref } from '../shared/i18n'
```

- [ ] **Step 2: Localize the existing Settings drawer strings**

In `SettingsDrawer`, the component receives `byok` and `onChange` as props, so use `t(key, byok.locale)` directly (there's no `tr` helper inside `SettingsDrawer`). Replace these literals:

- `'🔑 Bring Your Own Key'` (settings title `<h2>`) → `{t('settings.title', byok.locale)}`
- The privacy note paragraph text → `{t('settings.privacyNote', byok.locale)}`
- `Provider` label → `{t('settings.provider', byok.locale)}`
- The provider `def.description` stays dynamic (it comes from `PROVIDERS`), NOT translated.
- `Base URL` label → `{t('settings.baseUrl', byok.locale)}` and its hint `(OpenAI-compatible)` → `{t('settings.baseUrl.hint', byok.locale)}`
- `API Key` label → `{t('settings.apiKey', byok.locale)}`
- The key input `placeholder="sk-…"` → `placeholder={t('settings.apiKey.placeholder', byok.locale)}`
- The show/hide button text `{showKey ? 'hide' : 'show'}` → `{showKey ? t('settings.apiKey.hide', byok.locale) : t('settings.apiKey.show', byok.locale)}`
- The "Get a key" link `Get a key from {def.label} →` → `{t('settings.apiKey.getKey', byok.locale).replace('{label}', def.label)}`
- `Model` label → `{t('settings.model', byok.locale)}`
- The fetch button text `{fetching ? '拉取中…' : fetchedModels ? '↻ 重新拉取' : '⬇ 拉取模型列表'}` → `{fetching ? t('settings.model.fetching', byok.locale) : fetchedModels ? t('settings.model.refetch', byok.locale) : t('settings.model.fetch', byok.locale)}`
- The `<option value="__custom__">自定义模型 id…</option>` → `<option value="__custom__">{t('settings.model.custom', byok.locale)}</option>`
- The fetch-empty error `'该接口未返回模型列表，请手动填写模型 id。'` → `t('settings.model.fetchEmpty', byok.locale)`
- The fetch-fail `'拉取失败'` → `t('settings.model.fetchFail', byok.locale)`
- The fetched-count `已拉取 {fetchedModels.length} 个模型` → `{t('settings.model.fetchedCount', byok.locale).replace('{n}', String(fetchedModels.length))}`
- The test button text `{testing ? 'Testing…' : 'Test connection'}` → `{testing ? t('settings.testing', byok.locale) : t('settings.test', byok.locale)}`
- The `Done` button → `{t('settings.done', byok.locale)}`

- [ ] **Step 3: Add the Language selector UI**

Inside `SettingsDrawer`, add a new block immediately **after** the privacy-note `<p>` (before the Provider picker `<div>`). Use a 3-option segmented control:

```tsx
          {/* Language */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              {t('settings.language', byok.locale)}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['auto', 'en', 'zh'] as LocalePref[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onChange({ locale: opt })}
                  className={`px-2 py-2 text-[11px] font-medium rounded-lg border transition-colors ${
                    byok.locale === opt
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
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
```

`onChange` is already wired in the parent (`App`) to call `saveSettings({ ...byok, ...next })`, so selecting a language persists immediately and the zustand store updates, re-rendering the whole panel in the new language.

- [ ] **Step 4: Run typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(i18n): localize settings drawer + add language selector"
```

---

## Task 5: Localize the content script

**Files:**
- Modify: `src/content.ts`

**Interfaces:**
- Consumes: `t`, `StringKey`, `LocalePref` from `src/shared/i18n.ts`; `getSettings` (already imported).

- [ ] **Step 1: Add the i18n import**

In `src/content.ts`, the BYOK helpers import is at ~line 360:

```ts
import { getSettings, completeOnce } from './shared/byok'
```

Add right after it:

```ts
import { t, type LocalePref } from './shared/i18n'
```

- [ ] **Step 2: Add a cached locale-pref loader**

Near the top of the file (after the `injectStyles()` call, ~line 52), add a module-level cache and loader:

```ts
// --- i18n: content script reads the locale pref from storage once per action ---
let cachedPref: LocalePref = 'auto'

async function loadPref(): Promise<LocalePref> {
  try {
    const settings = await getSettings()
    cachedPref = settings.locale ?? 'auto'
  } catch {
    cachedPref = 'auto'
  }
  return cachedPref
}
const tr = (key: Parameters<typeof t>[0]) => t(key, cachedPref)
```

(`getSettings` is imported below in the file via the BYOK import; since these are ES module imports hoisted by the bundler, the reference is fine even though it textually appears before the import statement. If typecheck complains about use-before-declaration, move this block to immediately after the existing `import` line at ~360 instead.)

- [ ] **Step 3: Localize the FAB**

In `ensureFab()` (~line 146), change:

```ts
  fab.title = 'Open Lector AI'
```

The FAB is created once at load with the default pref; updating its title live on language change is out of scope (reload picks it up). Change to:

```ts
  fab.title = t('fab.title', 'auto')
```

- [ ] **Step 4: Localize the selection toolbar buttons**

In `createToolbar()` (~lines 198-201), replace the four `mk(...)` button labels. The toolbar renders synchronously, so use the cached `tr`. Replace:

```ts
  selectionToolbar.appendChild(mk('t-btn', '🌐 翻译', () => handleAction('translate', text)))
  selectionToolbar.appendChild(mk('t-btn', '💬 解释', () => handleAction('explain', text)))
  selectionToolbar.appendChild(mk('summary-btn', '📄 摘要', () => handleAction('summarize', text)))
  selectionToolbar.appendChild(mk('t-btn', '🤖 提问', () => handleAction('ask', text)))
```

with:

```ts
  selectionToolbar.appendChild(mk('t-btn', tr('toolbar.translate'), () => handleAction('translate', text)))
  selectionToolbar.appendChild(mk('t-btn', tr('toolbar.explain'), () => handleAction('explain', text)))
  selectionToolbar.appendChild(mk('summary-btn', tr('toolbar.summarize'), () => handleAction('summarize', text)))
  selectionToolbar.appendChild(mk('t-btn', tr('toolbar.ask'), () => handleAction('ask', text)))
```

Also localize the "extension not loaded" alert in the `mk` closure (~line 190):

```ts
        alert('扩展未正确加载，请刷新页面')
```

→

```ts
        alert(tr('err.extensionNotLoaded'))
```

**And refresh the pref before rendering the toolbar.** In the `mouseup` listener (~lines 474-499), the toolbar is created inside a `setTimeout`. Wrap the creation so the pref is loaded first. Change the `setTimeout(() => { ... })` body so that just before `createToolbar(x, y, text)` it awaits the pref. Since `setTimeout` can't be async cleanly, restructure to:

```ts
  setTimeout(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (text.length < 2 || text.length > 5000) {
      removeToolbar()
      return
    }
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const x = Math.max(10, Math.min(rect.left, window.innerWidth - 280))
    const y = rect.bottom + window.scrollY
    loadPref().then(() => createToolbar(x, y, text))
  }, 100)
```

- [ ] **Step 5: Localize the loading popup**

In `showLoading()` (~line 250), replace:

```ts
  t.textContent = 'AI 处理中...'
```

→

```ts
  t.textContent = tr('popup.loading')
```

- [ ] **Step 6: Localize the result popup**

In `showResult()` (~lines 263-337):

The `titleMap` (~line 292):

```ts
  const titleMap = { translate: '🌐 翻译结果', summary: '📄 摘要结果', explain: '💡 解释' }
```

→

```ts
  const titleMap = {
    translate: tr('popup.result.translate'),
    summary: tr('popup.result.summary'),
    explain: tr('popup.result.explain'),
  }
```

The close button (~line 297):

```ts
  closeBtn.textContent = '关闭'
```

→

```ts
  closeBtn.textContent = tr('popup.close')
```

The copy button (~lines 312-316):

```ts
  copyBtn.textContent = '📋 复制'
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(result)
    copyBtn.textContent = '✅ 已复制'
    setTimeout(() => (copyBtn.textContent = '📋 复制'), 1500)
  }
```

→

```ts
  copyBtn.textContent = tr('popup.copy')
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(result)
    copyBtn.textContent = tr('popup.copied')
    setTimeout(() => (copyBtn.textContent = tr('popup.copy')), 1500)
  }
```

The "continue in panel" button (~line 322):

```ts
  chatBtn.textContent = '🤖 在侧栏继续'
```

→

```ts
  chatBtn.textContent = tr('popup.continueInPanel')
```

- [ ] **Step 7: Localize the BYOK action error strings**

In `runByokAction()` (~lines 382-424), refresh the pref at the start of the function so error popups use the current language. Change the function opening:

```ts
async function runByokAction(kind: 'translate' | 'summarize' | 'explain', text: string) {
  const settings = await getSettings()
  const r = () => selectionToolbar?.getBoundingClientRect()
```

→ (note: `getSettings()` already called, so `cachedPref` is now fresh — `tr` will use it):

```ts
async function runByokAction(kind: 'translate' | 'summarize' | 'explain', text: string) {
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  const r = () => selectionToolbar?.getBoundingClientRect()
```

Then replace the no-key result string (~line 388):

```ts
    showResult(r()?.left || 100, r()?.top || 100, '请在侧栏设置中添加 API Key 后使用。', 'translate')
```

→

```ts
    showResult(r()?.left || 100, r()?.top || 100, tr('err.addKey'), 'translate')
```

The empty-response result (~line 416):

```ts
      out || '(空响应)',
```

→

```ts
      out || tr('err.emptyResponse'),
```

The catch block (~lines 420-422):

```ts
    const msg = e instanceof Error ? e.message : '请求失败'
    showResult(r()?.left || 100, r()?.top || 100, `失败: ${msg}`, 'translate')
```

→

```ts
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    showResult(r()?.left || 100, r()?.top || 100, tr('err.failedPrefix').replace('{msg}', msg), 'translate')
```

- [ ] **Step 8: Run typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build:extension`
Expected: build succeeds, `dist/content.js` regenerated.

- [ ] **Step 9: Commit**

```bash
git add src/content.ts
git commit -m "feat(i18n): localize content-script toolbar, popups, and errors"
```

---

## Task 6: Localize the background context menus

**Files:**
- Modify: `src/background.ts`

**Interfaces:**
- Consumes: `t`, `StringKey` from `src/shared/i18n.ts`; `getSettings` from `src/shared/byok.ts`.

- [ ] **Step 1: Add imports**

At the top of `src/background.ts`, add:

```ts
import { t, type StringKey } from './shared/i18n'
import { getSettings } from './shared/byok'
```

- [ ] **Step 2: Make `onInstalled` async and localize menu titles**

Change `chrome.runtime.onInstalled.addListener(() => { ... })` (~lines 9-27) to an async handler that reads the pref and uses localized titles. Replace the `menus` array and its loop:

```ts
chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')

  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {})
  }

  const menus: { id: string; title: string }[] = [
    { id: 'lector-summarize', title: 'Summarize with Lector AI' },
    { id: 'lector-translate', title: 'Translate with Lector AI' },
    { id: 'lector-explain', title: 'Explain with Lector AI' },
    { id: 'lector-ask', title: 'Ask Lector AI about this…' },
  ]
  menus.forEach((m) => {
    chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ['selection'] })
  })
})
```

→

```ts
chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')

  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {})
  }

  // Context-menu titles are fixed at creation in MV3; they reflect the
  // language active on install/update. Re-run loadPref + recreate if needed.
  void setupMenus()
})

async function setupMenus() {
  const pref = (await getSettings()).locale ?? 'auto'
  const menus: { id: string; key: StringKey }[] = [
    { id: 'lector-summarize', key: 'menu.summarize' },
    { id: 'lector-translate', key: 'menu.translate' },
    { id: 'lector-explain', key: 'menu.explain' },
    { id: 'lector-ask', key: 'menu.ask' },
  ]
  // Remove old entries first (create() throws on duplicate id).
  chrome.contextMenus.removeAll(() => {
    menus.forEach((m) => {
      chrome.contextMenus.create({ id: m.id, title: t(m.key, pref), contexts: ['selection'] })
    })
  })
}
```

- [ ] **Step 3: Run typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build:extension`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/background.ts
git commit -m "feat(i18n): localize context-menu titles from stored locale"
```

---

## Task 7: Final verification & string audit

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors.

- [ ] **Step 2: Run full extension build**

Run: `npm run build:extension`
Expected: succeeds; `dist/` regenerated (content.js, background.js, sidepanel bundle).

- [ ] **Step 3: String audit — confirm no hardcoded UI literals remain**

Run these greps and confirm each hit is either (a) intentionally not localized per the Global Constraints, or (b) zero hits:

```bash
# Chinese literals that should now be gone from App.tsx:
grep -nE '[\x{4e00}-\x{9fff}]' src/sidepanel/App.tsx
# (expected: only inside the STRINGS-adjacent comments, if any — should be ~0)

# English UI literals that should now be gone from content.ts/background.ts toolbars/menus:
grep -n "Summarize with Lector\|Translate with Lector\|Explain with Lector\|Ask Lector" src/background.ts
# (expected: 0 — replaced by t() calls)

# Leftover hardcoded Chinese toolbar/popup strings in content.ts:
grep -n "翻译\|解释\|摘要\|提问\|处理中\|翻译结果\|复制\|已复制\|在侧栏继续\|关闭" src/content.ts
# (expected: 0 in UI-building code; review any hit)
```

Acceptable non-localized remnants (do NOT "fix" these):
- `src/shared/providers.ts` — provider `label`/`description` strings (dynamic data, not UI chrome).
- LLM `systemPrompt` strings in `content.ts` and `App.tsx` (model instructions).
- `SUGGESTIONS[].prompt` English prompts (model instructions).
- The `'L'` logo glyph and `'Lector AI'` brand (the `side.header.defaultTitle` value IS `'Lector AI'` in both locales, which is correct).
- `dist/*` — generated; ignore (it's in git status as a pre-existing modified file).

- [ ] **Step 4: Commit (if the audit found any fixups)**

Only if Step 3 surfaced strings that needed fixing and you fixed them:

```bash
git add -A
git commit -m "fix(i18n): stragglers from string audit"
```

Otherwise skip — the feature is complete.

---

## Self-Review Notes

**Spec coverage check** (spec §4 components → tasks):
- §4.1 i18n.ts → Task 1 ✓
- §4.2 providers.ts locale field → Task 2 ✓ (also covers the `byok.ts` `settingsWithDefaults` second default, which the spec called out in §7 edge cases)
- §4.3 App.tsx localization + suggestions → Task 3 ✓
- §4.3 Settings language selector → Task 4 ✓
- §4.4 content.ts → Task 5 ✓
- §4.5 background.ts → Task 6 ✓
- Spec §6 dictionary → Task 1 STRINGS (every key in the spec is present) ✓
- Spec §8 verification (typecheck + build + audit) → Task 7 ✓

**Type consistency check:**
- `t(key: StringKey, pref: LocalePref)` — `StringKey` defined in Task 1, used identically in Tasks 3/4/5/6 ✓
- `ByokSettings.locale: LocalePref` — added in Task 2, read as `byok.locale` in Tasks 3/4 and `settings.locale` in Tasks 5/6 ✓
- `LocalePref` imported from `i18n` everywhere; re-exported from `providers.ts` for Task 4's `(['auto','en','zh'] as LocalePref[])` ✓
- `tr` helper: defined per-surface (component-scoped in App, module-scoped in content) — no cross-surface name clash ✓
