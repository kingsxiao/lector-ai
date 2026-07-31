# Immersive Translate Parity (Tier 1 + Signature Features) — Design

**Date:** 2026-07-31
**Goal:** Replicate and surpass Immersive Translate's core translation UX while preserving Lector's BYOK, free-forever, language-learning advantages.

## Context & Gap Analysis

Lector already has strong translation foundations (BYOK × 19 providers, bilingual paragraph translation w/ streaming + chunking + concurrency + unchanged-retry, selection popup w/ target picker, display modes bilingual/translationOnly/hover, glossary, history, TTS) **plus** things Immersive lacks (chat/summarize, highlights + vocab + SRS, sentence library w/ CEFR, Anki export, prompt templates).

Immersive Translate's advantages over Lector today (this is what we close):

| # | Gap | Tier |
|---|-----|------|
| 1 | Translation themes (21+ styles + custom CSS) | Tier 1 |
| 2 | 100+ languages (Lector has 12) | Tier 1 |
| 3 | Full keyboard shortcuts (Alt+A toggle, Alt+W whole page) | Tier 1 |
| 4 | Domain/site rules (always/never + custom selectors + per-site engine) | Tier 1 |
| 5 | Translation cache (Immersive caches; Lector re-pays each time) | Tier 1 |
| 6 | Input-box translation (triple-space + `/ja` slash + `//word` partial) | Signature |
| 7 | Shift+hover paragraph translation trigger | Signature |
| 8 | AI Expert / translation personas | Signature |

Decisions confirmed with the user:
- **Cache:** yes, by content hash, local-only (BYOK privacy preserved).
- **Site rules UI:** Settings list + current-site quick toggle.
- **Personas:** preset persona dropdown.

## Architecture

Lector's existing clean layering is preserved and extended:

```
shared/*.ts  (pure logic, DOM-free, chrome-free, unit-tested)
    ↓ used by
content.ts   (DOM + chrome at the boundary)
sidepanel/App.tsx  (React UI)
shared/store.ts + chrome.storage  (persistence)
```

Two new structural additions:
1. **New pure modules:** `translationThemes.ts`, `translationCache.ts`, `siteRules.ts`, `translationPersonas.ts`. Each is a single responsibility, DOM-free, fully unit-tested.
2. **`TranslationSettings` extension** (in `providers.ts`) — new fields added to the existing object so the forward-filling `normalizeTranslationSettings` migration stays smooth. No new top-level store slice.

Single source of truth principle: `buildTranslateSystemPrompt` (translation.ts:116) is the **only** place that assembles the translation system prompt from `{ targetLang, persona, glossary }`. All call sites (selection popup, bilingual, vocab, sentence) route through it → consistent semantics.

## Feature Designs

### 1. Translation Themes & Styling
- `shared/translationThemes.ts`: `TRANSLATION_THEMES` table with 21 named styles mirroring Immersive's names (`none, grey, dashed, solidBorder, dotted, underline, highlight, marker, marker2, paper, dividingLine, weakening, italic, bold, wavy, background, blockquote, nativeDashed, nativeUnderline, nativeDotted, thinDashed`). Each provides CSS declarations applied to `.lector-bilingual`.
- New `TranslationSettings` fields: `translationTheme: string`, `customCss: string`, `fontSize: number` (relative, default 0.92).
- `content.ts` injects a theme stylesheet into the existing `#lector-ai-styles` block; body class `lector-theme-<name>` makes themes hot-swappable & composable.
- Settings UI: theme picker (live preview swatch) + font-size slider + custom-CSS textarea.
- **Surpass:** a `readingFocus` mode that dims source + emphasizes translation for readability.

### 2. Languages (100+)
- Expand `LANGUAGES` in `translation.ts` to ~105 BCP-47 entries (en + zh name + speechCode). `TargetLangCode` widens to a string-validated alias with `isValidLangCode()`. `detectScript` extends to Hebrew/Greek/Devanagari/Thai for better `auto` direction.
- Settings dropdown becomes searchable (datalist / filtered grid) — 100 langs needs search.
- **Surpass:** show the detected source language next to each auto-resolution so the user can trust the direction.

### 3. Full Keyboard Shortcuts
- New manifest commands: `lector-toggle-bilingual` (Alt+A), `lector-translate-whole-page` (Alt+W), `lector-translate-selection` (Alt+Q). Alt+T kept as back-compat alias.
- `background.ts` command handlers forward to the content script.
- "whole" vs "smart" = new `mode` that scopes translation to `extractPage()`'s main-content root vs `document.body`.

### 4. Domain/Site Rules
- `shared/siteRules.ts`: `SiteRule { id, hostPattern, mode: 'always'|'never'|'customEngine', engine?, selectors?, excludeSelectors? }` + wildcard host matcher.
- Stored in `ByokSettings.siteRules` (migration-safe).
- `content.ts`: on load, check rules → `always` auto-runs bilingual; `never` skips auto-translate + hides FAB. Custom `selectors`/`excludeSelectors` augment the block query at content.ts:1326.
- Side-panel header **current-site chip** (default/always/never cycle) mirrored into an editable Settings list.

### 5. Translation Cache (content hash)
- `shared/translationCache.ts`: `cacheKey = hash(source + '|' + targetLang + '|' + model + '|' + glossaryHash)` → `{ value, at }`. Pure LRU trim + serialization helpers.
- `translateOneChunk` in `content.ts` checks cache (cache adapter injected); hit → resolves immediately, miss → stream + write.
- Persisted under `chrome.storage.local` `lectorCache`, 1000-entry cap + configurable TTL (default 30 days) + Clear button + size readout.
- **Surpass:** local-only (no cloud, BYOK privacy), and a saved-cost estimate (tokens × model pricing) surfaced in settings.

### 6. Input-Box Translation (signature)
- New focus-input listener in `content.ts`: triple-space triggers translation of the active input (replace/append-bilingual configurable). Slash `/ja /fr …` sets target for the call. Partial `//word` translates just that token. Configurable trigger symbol (some sites swallow spaces). Per-site disable via site rules; default blacklist of known-incompatible sites.

### 7. Shift+Hover Paragraph Translation
- Lector already has a CSS-only `hover` display mode. This adds the **trigger** (hold Shift + hover → translate just that paragraph on demand), distinct from pre-rendering everything.
- Debounced hover handler in `content.ts`; on Shift+hover calls `translateOneChunk` for the single block. Configurable hold key, debounce ms.

### 8. AI Expert / Personas
- `shared/translationPersonas.ts`: preset table — `通用 (default), 学术, 科技, 口语, 文学, 新闻, 商务`. Each adds a domain sub-prompt.
- `TranslationSettings.persona: string`. `buildTranslateSystemPrompt` (translation.ts:116) inserts the persona sub-prompt before the glossary block — single integration point.
- Settings UI: dropdown + read-only view of the injected text.

## Integration & Data Flow
- Settings change → live update: the existing `lector-translation-settings-changed` broadcast extends to theme/font/persona/rules via incremental merge (`applyDisplayMode` → `applyTranslationStyle`).
- Cache sits behind the fetcher, never in the prompt builder, so persona/glossary changes correctly invalidate stale cache entries (they're part of the hash).
- No new permissions required for inputs capture (already have `<all_urls>` + `storage` + `activeTab`).

## Testing
New pure-module tests: `translationThemes.test.ts`, `translationCache.test.ts`, `siteRules.test.ts`, `translationPersonas.test.ts`, plus extensions to `translation.test.ts` (100+ langs, auto-direction). All DOM-free pure functions following the existing `tests/translation.test.ts` pattern. Gate: `npm test` + `npm run build:extension`.

## Build Order (8 phases, each independently shippable)
1. Languages (100+) + auto-direction foundations.
2. Translation themes + custom CSS.
3. Keyboard shortcuts + smart/whole-page mode.
4. Site rules + current-site toggle.
5. Translation cache.
6. Shift+hover.
7. Input-box translation.
8. AI personas.

Every surpass-point is labeled: readingFocus mode, BYOK cost-savings display, local-only cache (privacy), detected-source-language display.
