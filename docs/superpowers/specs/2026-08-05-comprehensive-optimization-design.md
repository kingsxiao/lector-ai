# Comprehensive Codebase Optimization

**Date:** 2026-08-05
**Status:** Approved-in-principle (pending spec review)
**Scope:** Whole project — `src/content.ts`, `src/sidepanel/App.tsx`, `src/shared/*`, plus build/docs follow-up.

## Goal

Comprehensively optimize lector-ai across maintainability, performance, and correctness until further gains are not worth the risk. The baseline is healthy (typecheck clean, 436 tests green), so this is a refactoring + hardening pass, not a rescue.

**Decisions locked in with the user:**

- Focus: **all of** maintainability, performance, correctness.
- Behavior change tolerance: **free to reshape** (but tests must stay green per batch; small UX-facing changes are acceptable when clearly improvements).
- Sequence: **iterate in batches, report after each.** User can stop anytime.
- Approach: **layered, risk-ordered** (pure-logic extraction first, structural changes later).
- Test coverage: **test every extraction** as it lands.

## Non-goals

- No new user-facing features.
- No dependency upgrades unless one is blocking a concrete change.
- No changes to the BYOK provider protocol or storage schema (would break user data).
- No rewriting the content-script bundling strategy (single IIFE is a hard MV3 constraint).

## Guiding principles

1. **Behavior-preserving first, reshape later.** Each batch either (a) keeps observable behavior identical, or (b) makes a clearly-correct change called out in this spec. The 436-test suite is the regression net; typecheck + `build:extension` are the build net. **If a "free to reshape" change breaks an existing test's expectation, the test is updated first (TDD-style: write the new expectation, watch it fail, then make the change) — never silently deleted.**
2. **Honor the `shared/*` boundary.** `src/shared/*.ts` stays zero-DOM, zero-chrome — that is what makes them unit-testable in jsdom. New pure logic goes here; new DOM/chrome glue stays in `content.ts` / `background.ts` / `sidepanel/*`.
3. **One batch = one commit = green tests.** If a batch can't be left green, it's too big; split it.
4. **YAGNI.** Don't extract a helper until a second caller exists or is imminent in this plan. Don't add abstraction layers "for the future."
5. **Measure before claiming perf wins.** A "performance" change must be justified by a concrete cost (re-mount, re-parse, layout thrash, repeated query) — not vibes.

---

## Batch 1 — Extract pure logic out of `content.ts` → `src/shared/*`

**Why first:** lowest risk, highest testability gain, unblocks later batches by making the trapped heuristics testable.

### New modules

| New file | Moves from `content.ts` | Pure-ness |
|---|---|---|
| `src/shared/langDetect.ts` | `detectLang(text)` only (content.ts:149-165). **`detectScript` stays in `translation.ts`** (it has 6 internal callers there + existing tests); `langDetect.ts` imports it from `translation`. | pure |
| `src/shared/readability.ts` | `scoreNode` formula (92-100, accept `{text, linkCount, wordCount}` to stay pure) + `NOISE_SELECTORS` list (85-90, data only) | pure (data + pure fn) |
| `src/shared/radialMenu.ts` | polar→cartesian geometry of `toggleFabMenu` body (387-426): `fanOutPositions(n, radius, startDeg, endDeg): {dx,dy}[]` | pure trig |
| `src/shared/color.ts` | `relativeLuminance(rgb)` + `parseCssRgb(str)` extracted from `isDarkPage` (483-505); DOM walk stays in content.ts | pure |
| **extend** `src/shared/siteRules.ts` | `INPUT_BLACKLIST` (2166) + `inputBoxDisabledForHost` (2168-2171) — **and fix the `h.includes(b)` substring bug** to a proper hostname-suffix match (`host === b || host.endsWith('.' + b)`) | pure |

### Acceptance

- Each new module gets a vitest test file with cases covering edge behavior (empty input, ASCII/Unicode, hostname boundary cases, polar angles at n=1/n=2).
- `content.ts` imports the new modules; behavior identical.
- **Bug fix:** `inputBoxDisabledForHost('notion.so.evil.com')` → `false` (was `true`). Add a test that pins this.
- Tests + typecheck green; `build:extension` succeeds.

### Risk note

`scoreNode` currently reads `el.textContent` / `el.querySelectorAll('a')` directly. To stay pure, the extracted function takes a small input struct. The DOM glue in content.ts reads those values and calls the pure scorer. This is a deliberate signature change but local to one caller.

---

## Batch 2 — Shared UI helpers + kill cross-cutting duplication

**Why:** sets up primitives that batch 3's view extraction depends on, and removes duplicated patterns in both `content.ts` and `App.tsx`.

### New `src/sidepanel/lib/`

- `downloads.ts` — `downloadBlob(filename, content, mime)`, `readJsonFile(file, parse): Promise<T>` (kills the 3 blob-download + 2 JSON-import duplications in App.tsx).
- `chromeUtils.ts` — `jumpToBlock(blockId)` (used by `onViewSource` App:1553-1566 + `CitationContent` onClick 1613-1622), `useCurrentHost()` hook (de-dupes the two independent `chrome.tabs.query` sites: App:210 + SiteRulesControls:2474).
- `ankiFormat.ts` — `formatAnkiResult(tr, result)` (App:1573 + VocabView:1810-1813).

### New `src/sidepanel/components/Primitives.tsx`

- `<Row>` — the hover-action list row pattern repeated 6× (Highlights, Library, Vocab, Templates, Glossary, Sentences). Slots: `title`, `subtitle`, `actions`, `onClick`.
- `<Tab>` — single tab button (replaces 4 tab-bar + 4 MoreMenu near-identical `<button>` blocks in App 945-1039).
- `<IconButton>` — small icon-only button with shared a11y (`aria-label`, `title`) for the hover-action buttons.
- Hoist `StatsBar`'s inner `Cell` (App:3417) to module scope so it stops re-mounting.

### `content.ts` consistency pass (same batch, file-local)

- `clearPopups()` helper replacing 3× `removeLoading(); removeResult();` openers.
- `isLectorUiTarget(target)` helper + `LECTOR_UI_SELECTOR` constant, unifying the 3 hand-written dismiss-selector lists (2130, 2264-2267, 2323-2326).
- `requireApiKey()` returning `Promise<ByokSettings|null>` replacing 3× no-key UX blocks (290-295, 1074-1080, 1118-1123).
- `SUMMARIZE_SYSTEM_PROMPT` constant shared by `summarizePage` (297) + `runByokAction` (1152).
- All 6 raw `sendMessage('open-side-panel').catch(()=>{})` sites → use existing `tryOpenSidePanel()` (which handles sync `Extension context invalidated`). Add a `tryOpenSidePanelWithSeed(seed)` companion for the two seed-bearing sites (680, 803).

### Acceptance

- All duplicated sites replaced; grep for the old inline patterns returns nothing.
- New primitives have unit tests (`downloadBlob`, `readJsonFile`, `formatAnkiResult`, `jumpToBlock` mock; `<Row>`/`<Tab>` render test via react testing in jsdom — pattern already exists in `tests/shared/icons.test.tsx`).
- Tests + typecheck + build green.

---

## Batch 3 — Split `App.tsx` into view modules

**Why:** the single biggest maintainability win. `App` (3434 lines, ~35 components, ~18 handlers) becomes a router/shell.

### New structure

```
src/sidepanel/
  App.tsx                      # router + provider shell only (~300-400 lines)
  views/
    ChatView.tsx               # inline chat view (App 1071-1296) + streaming pipeline
    SettingsView.tsx           # SettingsView + LanguageSelect + CacheControls
                               # + SiteRulesControls + CurrentSiteChip (2349-3060)
    VocabView.tsx              # 1701-1910
    TemplatesView.tsx          # 1925-2104
    GlossaryView.tsx           # 2118-2342
    SentencesView.tsx          # 3077-3336 + PasteBox + ImportMsg
  components/
    Primitives.tsx             # from batch 2
    ViewShell.tsx              # 1584-1593
    Empty.tsx                  # 1595-1604
    SlashMenu.tsx              # 1633-1682
    CitationContent.tsx        # 1608-1628
    SrsGradeButtons.tsx        # 3382-3411
    StatsBar.tsx               # 3416-3434 (with hoisted Cell)
  hooks/
    useTr.ts                   # context-based tr, replaces prop-drilled `tr`
    useChromePage.ts           # page-context bootstrap effect (App 276-341)
    useRelayQueue.ts           # relay-queue sync effect (346-381)
    useBilingualProgress.ts    # bilingual message listener (401-444)
  lib/
    downloads.ts               # from batch 2
    chromeUtils.ts             # from batch 2
    ankiFormat.ts              # from batch 2
  context/
    LocaleContext.tsx          # provides `tr` to all descendants
```

### State relocation

Move single-consumer state out of `App`:
- `revealedVocab`, `revealedSentences`, `histSearch`, `hintDismissed` → into their respective views.
- Chat subsystem (`messages`, `input`, `streaming`, `error`, `errorBanner`, `activeSessionId`, `slashMenu`, `busyExample`, `assistantBuf`, `abortRef`, `tokenFrameRef`, `scrollRef`) → encapsulated in a `useChat()` hook inside `ChatView.tsx`. (Consider a `chatReducer` if the hook's `useState` count stays >8; decide during implementation.)

### Extraction order (each a green commit)

1. Extract leaf views that already take props: `VocabView`, `TemplatesView`, `GlossaryView`, `SentencesView`.
2. Extract `SettingsView` cluster.
3. Extract `ChatView` + `useChat` (the riskiest; do it last when the rest is stable).
4. `App` becomes router/shell; verify with full test suite.

### Acceptance

- `App.tsx` ≤ 500 lines, no inline view rendering, no prop-drilled `tr`.
- Every view imports `tr` from `useTr()` context, not as a prop.
- All 24 test files still pass; `tests/store.test.ts` (the heaviest integration test) untouched and green.
- `build:extension` produces a `sidepanel.js` bundle (size delta reported, not gate).
- `CLAUDE.md` updated to describe the new view directory layout.

### Risk note

`ChatView` extraction is the highest-risk batch. The streaming pipeline uses `useStore.getState()` in 12+ places to dodge stale closures (App:89, 116, 508, 734, 844, 1303, 1568…). During extraction I'll preserve those reads verbatim. (Consolidating them into a `useByok()` selector was considered and rejected — YAGNI, and the `getState()` pattern is an intentional documented choice, not a smell to fix.)

---

## Batch 4 — Performance + correctness

**Why:** with the structure clean, targeted perf and correctness fixes are low-risk.

### Performance

1. **Hoist `Cell` in `StatsBar`** (done in batch 2) — eliminates re-mount per render.
2. **Memoize streaming markdown** — `renderMarkdown` + `renderCitations` re-run every rAF token frame (App 1170-1173). Memoize on `m.content`; re-render only when content changes, not every frame.
3. **`React.memo` on heavy view components** — `VocabView`/`SentencesView`/`TemplatesView`/`GlossaryView` so they don't re-render on chat-token state changes (mostly already gated by `activeView`, but `memo` future-proofs).
4. **`extractExamples` called twice per sentence render** (SentencesView 3290 + 3292) → compute once into a const.
5. **Remove redundant `extractPage()` call** at content.ts:1884 — it re-traverses h1-h6/p/li/etc. just to read `.lang`; compute lang from `candidateText` already built at 1888-1892.
6. **Throttle Shift-hover mousemove** (content.ts:2116) — gate the `closest('p, li, ...')` traversal behind a debounce/raf so it doesn't run on every held-Shift mousemove.
7. **Throttle bilingual progress reports** — on a 200-block page, ~200 `sendMessage` calls fire in bursts; throttle to e.g. every 250ms or 5%.
8. **Cancel stale `saveCache` timer** on bilingual re-entry — the abort guard at content.ts:1824 doesn't cancel the pending debounced `setTimeout`, so a stale snapshot can be written.
9. **SentencesView list cap** — VocabView caps at 2000 (1849), SentencesView has no cap; add one or virtualize if lists are routinely large.

### Correctness

1. **`inputBoxDisabledForHost` substring bug** — fixed in batch 1 (`notion.so` matching `notion.so.evil.com`).
2. **Async `sendMessage` uncaught throws** — all 6 raw sites routed through `tryOpenSidePanel` in batch 2.
3. **Error-handling unification** — `translateBlockOnHover` (2091-2114) and `translateInputField` (2194-2223) swallow all errors with bare `catch {}`; give them at least the rendered-error-UI path or structured telemetry so a provider auth failure isn't indistinguishable from an abort.
4. **`isLectorUiTarget` selector unification** — the hover handler (2130) uses a *different* selector list than mouseup/mousedown. Unify so the user can't dismiss their own UI inconsistently.

### SPA translation-loss (assess, don't commit)

Modern SPAs (React/Vue route changes) re-render and silently drop bilingual translations; the FAB stays but translations vanish. Investigate a `MutationObserver` to detect significant DOM replacement and offer re-translation. **This is a behavior change**, so I'll spike it, measure the cost (observer fires on every minor mutation without careful filtering), and report before adding. If it's too noisy or expensive, skip.

### Acceptance

- Each perf change has a one-line "before/after" justification in the commit message.
- Tests green; if a perf change has no observable test effect, note that explicitly.
- Correctness fixes get new regression tests.

---

## Batch 5 — Polish + docs

- Full sweep: `npm run typecheck`, `npm test`, `npm run build:extension`. Compare bundle sizes vs baseline (`sidepanel.js` 184K, `content.js` 34K, `byok` chunk 21K).
- Update `CLAUDE.md`: new `views/` / `components/` / `hooks/` / `lib/` layout, new `shared/` modules, the `useTr` context pattern.
- Update `.gitignore` if `dist.zip` / stray artifacts are tracked (verify).
- Final review: confirm no `as any` regressions, no new `console.log` in hot paths, no dead imports.
- **Stop condition:** declare "no more worthwhile gains" only after a full pass finds nothing that clears the bar (concrete cost + safe fix + tests stay green).

---

## Verification plan (every batch)

| Gate | Command |
|---|---|
| Types | `NODE_ENV=development node_modules/.bin/tsc --noEmit` |
| Unit/integration | `NODE_ENV=development npm test` (must stay ≥436 passing) |
| Build | `NODE_ENV=development npm run build:extension` |
| Bundle sanity | `ls -lh dist/*.js dist/chunks/*.js` (report, not gate) |

E2E (`npm run test:browser`) requires a real Chrome on macOS with hardcoded paths; run at the end of batch 5 if the environment allows, otherwise flag as a manual check.

## Rollback

Each batch is one or more green commits on `main`. If a batch goes wrong, `git revert` the commit. No long-lived feature branch.

## Out of scope (explicit)

- Provider list expansion, new personas/themes, new languages.
- BYOK protocol changes, storage schema migrations.
- Switching off Vite, off Tailwind, off Zustand.
- i18n string additions/changes (except where a bug demands it).
- Accessibility overhaul (separate concern; only opportunistic `<IconButton>` a11y in batch 2).
