# Auto Language Detection & Switching — Design

**Date:** 2026-07-09
**Status:** Approved
**Goal:** Auto-detect the user's language from the browser locale and switch the entire extension UI (side panel, content-script toolbar/popups, context menus) accordingly, with a manual override in Settings.

---

## 1. Background & Current State

Lector AI is a Manifest V3 BYOK Chrome extension with **no i18n infrastructure today**. UI strings are hardcoded and inconsistently mixed across three surfaces:

| Surface | File | Current language |
|---|---|---|
| Side panel (React) | `src/sidepanel/App.tsx` | Mostly English (header, composer, settings), but suggestions are Chinese (总结全文, 关键观点…) |
| Content-script toolbar/popups (raw DOM) | `src/content.ts` | Chinese (翻译, 解释, 摘要, AI 处理中…, 复制, 在侧栏继续) |
| Context menus | `src/background.ts` | English (Summarize with Lector AI…) |

There is an existing `detectLang()` in `content.ts`, but it detects **page content** language (for the bilingual-translation feature), not the user/UI language. It is unrelated to this feature.

Settings live in one shared object, `ByokSettings` (`src/shared/providers.ts`), persisted by zustand to `chrome.storage.local` and also read via a `getSettings()` helper in `src/shared/byok.ts`. All three surfaces already consume this object, so it is the natural home for a language preference.

## 2. Decisions (locked with user)

- **Detection method:** Browser locale (`navigator.language` / `navigator.languages`). Zero permissions, instant, offline, privacy-friendly.
- **Supported languages at launch:** English (`en`) and Chinese (`zh`).
- **Manual override:** Yes — a language selector in the Settings drawer, persisted to storage.
- **Architecture:** Single shared module `src/shared/i18n.ts` (Approach A). One source of truth for all surfaces; no third-party i18n library.

## 3. Architecture

A new shared module is the single source of truth. The language preference rides on the existing `ByokSettings` object so it flows to all surfaces through the mechanism that already distributes settings (zustand persist + `chrome.storage.local` + `getSettings()`).

```
                    ┌─────────────────────────┐
                    │  src/shared/i18n.ts     │
                    │  - STRINGS dictionary   │
                    │  - detectLocale()       │
                    │  - resolveLocale(pref)  │
                    │  - t(key, pref)         │
                    └───────────┬─────────────┘
              imports from      │      imports from
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  App.tsx (sidebar)      content.ts            background.ts
  reads byok.locale      reads via getSettings reads via getSettings
  (in-memory)            (chrome.storage)      (chrome.storage)
```

## 4. Components

### 4.1 `src/shared/i18n.ts` (NEW)

Exports:

```ts
export type Locale = 'en' | 'zh'
export type LocalePref = 'auto' | Locale
```

**`detectLocale(): Locale`**
- Reads `navigator.languages` (preferred, an ordered array) then `navigator.language`.
- Maps any tag whose primary subtag is `zh` (covers `zh`, `zh-CN`, `zh-Hans`, `zh-TW`, `zh-Hant`) to `'zh'`.
- Everything else (including unknown/missing) maps to `'en'`.

**`resolveLocale(pref: LocalePref): Locale`**
- `'auto'` → `detectLocale()`.
- `'en'` / `'zh'` → that locale.

**`STRINGS`** — `Record<string, { en: string; zh: string }>`, declared as a `const` object so its keys are a literal union. The complete key set is enumerated in §6. Keys are grouped by surface via naming convention (`side.*`, `toolbar.*`, `popup.*`, `menu.*`, `settings.*`, `err.*`).

**`type StringKey = keyof typeof STRINGS`** — derived from the `const` dictionary, so every valid key is a known string literal and typos/missing keys are compile errors.

**`t(key: StringKey, pref: LocalePref): string`**
- `const locale = resolveLocale(pref)`
- Look up `STRINGS[key]?.[locale]`; if missing, fall back to `STRINGS[key]?.en`; if still missing, return `key`. Never throws. (Because `key` is typed as `StringKey`, a missing key is impossible at runtime — the fallback chain only guards against a value being `undefined`.)

### 4.2 `src/shared/providers.ts` (MODIFIED)

- Add `locale: LocalePref` to the `ByokSettings` interface.
- Add `locale: 'auto'` to `DEFAULT_BYOK_SETTINGS`.
- Re-export `LocalePref` and `Locale` types from `i18n.ts` so consumers can import types from one place.

### 4.3 Side panel — `src/sidepanel/App.tsx` (MODIFIED)

- Replace every hardcoded UI string with `t(KEY, byok.locale)`.
- Localize the suggestion labels (`SUGGESTIONS` array) — their `label` becomes a translation key; the English `prompt` stays as-is (it is an LLM instruction, not user-facing copy).
- **Settings drawer:** add a Language selector (a small segmented control or `<select>`): `Auto`, `English`, `中文`. Changing it calls `onChange({ locale })`, which flows through the existing `saveSettings` path.

### 4.4 Content script — `src/content.ts` (MODIFIED)

- On load (and when rendering toolbars/popups), read the locale pref from `getSettings()` and cache the resolved locale in a module-level variable refreshed on each `getSettings()` call.
- Replace all Chinese UI strings with `t(KEY, pref)`:
  - Toolbar buttons: 翻译 → `toolbar.translate`, 解释 → `toolbar.explain`, 摘要 → `toolbar.summarize`, 提问 → `toolbar.ask`.
  - Loading: AI 处理中… → `popup.loading`.
  - Result titles: 🌐 翻译结果 / 📄 摘要结果 / 💡 解释 → keyed.
  - Buttons: 关闭, 📋 复制, ✅ 已复制, 🤖 在侧栏继续 → keyed.
  - FAB tooltip (`Open Lector AI`) → keyed.
  - Error strings (请在侧栏设置中添加 API Key…, 失败: …) → keyed.

### 4.5 Background — `src/background.ts` (MODIFIED)

- In `onInstalled`, read the locale pref from `getSettings()` and create context-menu entries with localized titles (`menu.summarize`, `menu.translate`, `menu.explain`, `menu.ask`).
- Because MV3 menu titles are fixed at creation time, they reflect the language active on install/update. This limitation is documented; a page reload re-runs the content script which always uses the current pref.

## 5. Data Flow

```
User picks language in Settings (or leaves 'auto')
        │
        ▼
onChange({ locale })  ──►  saveSettings({...byok, locale})
        │                              │
        ▼                              ▼
zustand store updates          chrome.storage.local
(byok.locale, in-memory)       (read by content + background)
        │                              │
        ▼                              ▼
App.tsx re-renders with        content.ts / background.ts
t(KEY, byok.locale)            read pref → t(KEY, pref)
```

- **Sidebar:** synchronous via zustand in-memory state — instant re-render on change.
- **Content script / background:** read via the existing async `getSettings()` helper. Toolbar/popups render on the next interaction (selection, message) and pick up the fresh pref.

## 6. String Dictionary (complete key set)

Keys and both locales (authoritative list — implementation must cover every key):

**Side panel — header / empty state**
- `side.header.defaultTitle` — "Lector AI" / "Lector AI"
- `side.header.noKey` — "No API key — tap settings" / "未设置 API Key — 点击设置"
- `side.onboard.title` — "Bring your own key 🔑" / "自带密钥 🔑"
- `side.onboard.body` — en: "Lector is free and private — you pay your AI provider directly. Open {settings} to add a key (OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint)." where `{settings}` wraps a clickable link. zh: "Lector 免费且私密 —— 你直接向 AI 服务商付费。打开{settings}添加密钥（OpenAI、Anthropic、OpenRouter 或任意 OpenAI 兼容接口）。"
- `side.empty.title` — "Chat with this page" / "与本文对话"
- `side.empty.subtitle` — "Ask anything about the article you're reading. Lector reads the page with you." / Chinese equivalent
- `side.empty.noPage` — "Open a web article, then Lector can read along." / Chinese equivalent
- `side.composer.placeholder.ready` — "Ask about this page…" / "向本文提问…"
- `side.composer.placeholder.noKey` — "Add an API key in settings to begin…" / "在设置中添加 API Key 以开始…"
- `side.composer.hint` — "Enter to send · Shift+Enter for newline" / "回车发送 · Shift+回车换行"
- `side.composer.newChat` — "+ New chat" / "+ 新对话"
- `side.error.addKey` — "Add your API key in Settings to start chatting." / "请在设置中添加 API Key 后开始对话。"
- `side.thinking` — "thinking…" / "思考中…"

**Side panel — suggestions (label localized; prompt stays English)**
- `side.suggest.summarize` — "Summarize" / "总结全文"
- `side.suggest.keyPoints` — "Key points" / "关键观点"
- `side.suggest.explain` — "Explain" / "解释难点"
- `side.suggest.followup` — "Follow-up" / "继续追问"

**Side panel — library drawer**
- `side.library.title` — "Library" / "历史记录"
- `side.library.empty` — "Saved conversations will appear here." / "保存的对话将显示在此。"
- `side.library.clearAll` — "Clear all" / "全部清除"

**Side panel — settings drawer**
- `settings.title` — "🔑 Bring Your Own Key" / "🔑 自带密钥"
- `settings.privacyNote` — en: "Lector is free and private. Your key is stored only in this browser and sent directly to your chosen provider — never to us." zh: "Lector 免费且私密。你的密钥仅存储在本浏览器中，并直接发送至你选择的服务商 —— 绝不发送给我们。"
- `settings.provider` — "Provider" / "服务商"
- `settings.baseUrl` — "Base URL" / "Base URL"
- `settings.baseUrl.hint` — "(OpenAI-compatible)" / "（OpenAI 兼容）"
- `settings.apiKey` — "API Key" / "API Key"
- `settings.apiKey.placeholder` — "sk-…" / "sk-…"
- `settings.apiKey.show` — "show" / "显示"
- `settings.apiKey.hide` — "hide" / "隐藏"
- `settings.apiKey.getKey` — "Get a key from {label} →" / "从 {label} 获取密钥 →"
- `settings.model` — "Model" / "模型"
- `settings.model.fetch` — "⬇ Fetch models" / "⬇ 拉取模型列表"
- `settings.model.refetch` — "↻ Refetch" / "↻ 重新拉取"
- `settings.model.fetching` — "Fetching…" / "拉取中…"
- `settings.model.custom` — "Custom model id…" / "自定义模型 id…"
- `settings.model.fetchedCount` — "Fetched {n} models" / "已拉取 {n} 个模型"
- `settings.model.fetchEmpty` — "This endpoint returned no model list; enter the model id manually." / "该接口未返回模型列表，请手动填写模型 id。"
- `settings.model.fetchFail` — "Fetch failed" / "拉取失败"
- `settings.test` — "Test connection" / "测试连接"
- `settings.testing` — "Testing…" / "测试中…"
- `settings.done` — "Done" / "完成"
- **`settings.language` — "Language" / "语言"**
- **`settings.language.auto` — "Auto" / "自动"**
- **`settings.language.en` — "English" / "English"**
- **`settings.language.zh` — "中文" / "中文"**

**Content script — toolbar**
- `toolbar.translate` — "🌐 Translate" / "🌐 翻译"
- `toolbar.explain` — "💬 Explain" / "💬 解释"
- `toolbar.summarize` — "📄 Summarize" / "📄 摘要"
- `toolbar.ask` — "🤖 Ask" / "🤖 提问"

**Content script — popups**
- `popup.loading` — "AI processing…" / "AI 处理中…"
- `popup.result.translate` — "🌐 Translation" / "🌐 翻译结果"
- `popup.result.summary` — "📄 Summary" / "📄 摘要结果"
- `popup.result.explain` — "💡 Explanation" / "💡 解释"
- `popup.close` — "Close" / "关闭"
- `popup.copy` — "📋 Copy" / "📋 复制"
- `popup.copied` — "✅ Copied" / "✅ 已复制"
- `popup.continueInPanel` — "🤖 Continue in side panel" / "🤖 在侧栏继续"

**Content script — FAB & errors**
- `fab.title` — "Open Lector AI" / "打开 Lector AI"
- `err.addKey` — "Add your API Key in Settings to use this." / "请在侧栏设置中添加 API Key 后使用。"
- `err.requestFailed` — "Request failed" / "请求失败"
- `err.failedPrefix` — "Failed: {msg}" / "失败: {msg}"
- `err.emptyResponse` — "(empty response)" / "(空响应)"
- `err.extensionNotLoaded` — "Extension not loaded; please refresh the page." / "扩展未正确加载，请刷新页面"

**Background — context menus**
- `menu.summarize` — "Summarize with Lector AI" / "用 Lector AI 总结"
- `menu.translate` — "Translate with Lector AI" / "用 Lector AI 翻译"
- `menu.explain` — "Explain with Lector AI" / "用 Lector AI 解释"
- `menu.ask` — "Ask Lector AI about this…" / "向 Lector AI 提问…"

**Interpolation:** a few strings contain `{label}` / `{n}` / `{msg}` / `{settings}` placeholders. `t()` returns the raw template; callers do the substitution (keeps `t()` dead simple and avoids pulling a template library). The exact substitution API for callers: `t(key, pref).replace('{n}', String(n))`. (The `{settings}` token in `side.onboard.body` marks where the clickable "Settings" link is inserted; callers split on it.)

## 7. Error Handling & Edge Cases

- **`navigator.language` missing/unrecognized** → `detectLocale()` returns `'en'`. Deterministic, never throws.
- **Missing key in dictionary** → `t()` falls back to English, then to the key string itself. No runtime crash; surfaces a visible-but-English fallback.
- **Existing users upgrading** → their persisted `ByokSettings` has no `locale` field; the spread default (`locale: 'auto'`) applies. No migration code needed because consumers always read through `resolveLocale()`.
- **Context-menu staleness (MV3)** → menu titles are fixed at creation. After a language change they update on the next install/update event. Documented limitation; the content script always reflects the current pref.
- **`zh-*` regional variants** → all map to `zh` (simplified-leaning copy). Traditional-Chinese distinction is out of scope for launch.
- **Placeholder mismatch** → if a caller forgets to substitute a `{...}` token, the literal `{n}` shows. Acceptable; rare and obvious.

## 8. Testing & Verification

The project has no test framework. Verification strategy:

1. **`npm run typecheck`** — because `t()` takes a `StringKey` (a literal union derived from `STRINGS`), every call site must reference a real key or it fails to compile. This is the primary guard against typos/missing keys, and also confirms `ByokSettings.locale` is wired everywhere.
2. **`npm run build:extension`** — confirms all three surfaces bundle cleanly with the new shared import.
3. **String audit** — manually grep for remaining Chinese/English literals in `App.tsx`, `content.ts`, `background.ts` and confirm each is either replaced by a `t()` call or intentionally left (e.g., LLM prompts, `L` logo, `Lector AI` brand name).
4. **Manual smoke test (documented in plan, not automated):**
   - Set browser language to Chinese → all surfaces render Chinese.
   - Set to English → all surfaces render English.
   - Override to a specific language in Settings → overrides regardless of browser locale.

## 9. Out of Scope

- More than 2 locales (ja/ko/es etc.) — deferred.
- IP-based geolocation.
- Traditional vs. Simplified Chinese distinction.
- Localizing the LLM system prompts or suggestion prompts (those are model instructions, stay English).
- Dynamic reloading of context-menu titles without an install/update event.
- Adding a test framework.
