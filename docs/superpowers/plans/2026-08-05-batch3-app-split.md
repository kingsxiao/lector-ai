# Batch 3: Split `App.tsx` into view modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the 6 prop-driven views (`VocabView`, `TemplatesView`, `GlossaryView`, `SentencesView`, `SettingsView` cluster, `ChatView`) out of `App.tsx` (3399 lines) into `src/sidepanel/views/*.tsx`. `App.tsx` shrinks to a router/shell. Behavior-preserving — each view keeps its exact current props (incl. `tr`); `useTr()` context is **deferred** (see Scope Decisions).

**Architecture:** Each leaf view is already a clean, prop-driven function — extraction is mechanical: move the function + its `Props` interface + the imports it needs into `src/sidepanel/views/<Name>.tsx`, then `import` it back into `App.tsx`. State relocation (`revealedVocab`, `revealedSentences`, `histSearch`) happens in a later task after the views exist, by hoisting the `useState` into the view and removing the prop. Order = risk-ascending: 4 leaf views → SettingsView cluster → ChatView (highest risk, done last).

**Tech Stack:** TypeScript, React 18, vitest + jsdom.

## Global Constraints
- `NODE_ENV=development` prefix on every command.
- 469-test suite stays green after every task.
- One commit per view extraction.
- **`tr` stays a prop in this batch.** Don't introduce a context mid-extraction — it multiplies risk. (See Scope Decisions.)
- Extracted view files import from `../shared/*`, `../components/Primitives`, `../lib/*`, `../icons` (existing shared modules). They do NOT import from `../App` (no circular deps).
- After each extraction: `tsc --noEmit` + `npm test` + `npm run build:extension` all green.

## Scope Decisions (honest)

1. **`useTr()` context — DEFERRED.** The spec listed it for Batch 3. On inspection, the `tr` prop is a single line per view, and introducing a context means N×churn (extract + remove-prop + wrap-app) stacked on the same commits as the structural extraction — exactly the "stack risk" the spec warned against. The real win of Batch 3 is the **file extraction** (3399-line god file → focused views). `useTr` is a candidate for Batch 4 or a follow-up; it's YAGNI for the file-split goal.
2. **State relocation — DO selectively.** `revealedVocab` (only VocabView consumes), `revealedSentences` (only SentencesView), `histSearch` (only TranslationHistory inline) move into their consumers. This is a real simplification (removes App-owned state + its prop wiring). Done as a follow-up task AFTER the views exist (so the move is one focused change, not entangled with extraction).
3. **`ChatView` extraction — DO, carefully, LAST.** The streaming pipeline uses `useStore.getState()` in ~12 places to dodge stale closures. Extraction preserves those reads verbatim. The risk is the chat subsystem state (`messages`, `input`, `streaming`, `error`, … 12 states + 5 refs) — I'll move them as a block into `ChatView`'s own `useState`/`useRef`, which is the bulk of App's render. If `ChatView` extraction gets risky, I stop after the leaf+settings extractions and report — those alone take App from 3399 → ~1500 lines.
4. **`<Row>` adoption into the 6 list sites — DEFERRED to a follow-up.** Batch 2 added the primitive; rewiring each view's bespoke row layout is per-view polish, not the file-split goal.

## File Structure (this batch)

```
src/sidepanel/
  App.tsx                 # router/shell only (target ≤ 1500 lines after ChatView)
  views/
    VocabView.tsx
    TemplatesView.tsx
    GlossaryView.tsx
    SentencesView.tsx
    SettingsView.tsx      # + LanguageSelect + CacheControls + SiteRulesControls + CurrentSiteChip
    ChatView.tsx          # (highest risk; last)
  components/
    Primitives.tsx        # (exists from Batch 2)
  lib/
    downloads.ts          # (exists)
    chromeUtils.ts        # (exists)
    ankiFormat.ts         # (exists)
```

Each view file is self-contained: its `Props` interface + the function + the imports it needs.

## Extraction recipe (applies to every view task)

The leaf views are already prop-driven. The mechanical extraction is identical each time:

1. **Read** the view's full source range (function + its `interface XProps`) in `App.tsx`.
2. **Identify its imports**: from the view body, list every external symbol used (types, components, icons, shared modules, lib helpers). Cross-reference against `App.tsx`'s import block to find the source module for each.
3. **Create** `src/sidepanel/views/<Name>.tsx` with: the needed imports (paths adjusted: `../shared/...`, `../icons`, `../components/Primitives`, `../lib/...`), the `Props` interface, and the function (renamed to a named export — `export function VocabView(...)`).
4. **Delete** the function + interface from `App.tsx`.
5. **Add** `import { VocabView } from './views/VocabView'` to `App.tsx`.
6. **Verify**: `tsc --noEmit` (catches missing imports / accidental duplicate identifiers), `npm test` (469 green), `npm run build:extension`.
7. **Commit**: `refactor(sidepanel): extract VocabView to views/VocabView.tsx`.

The risk per view is low because the function signature is unchanged — callers in `App.tsx` keep passing the same props. The only failure modes are: (a) a missed import (tsc catches), (b) an App-local helper the view uses that wasn't moved (tsc catches), (c) two exports with the same name (tsc catches).

---

### Task 1: Extract `VocabView`

**Files:**
- Create: `src/sidepanel/views/VocabView.tsx`
- Modify: `src/sidepanel/App.tsx` (lines 1672-1892: `interface VocabViewProps` + `function VocabView`)

**Imports VocabView needs** (derived from its body 1686-1892):
- React: `useState`
- `ViewShell` (App-local component — see Task 7 caveat; for now, VocabView references `ViewShell`, `Empty`, `StatsBar`, `SrsGradeButtons` which are ALL App-local. **Decision: move the small leaf components `ViewShell`, `Empty`, `SrsGradeButtons`, `StatsBar` into `components/` in Task 7 BEFORE the views that need them, OR keep VocabView importing them from App.** Since App exports `App` only by default, the leaf components must move first.)

**Reorder**: Do Task 7 (move shared leaf components `ViewShell`/`Empty`/`SrsGradeButtons`/`StatsBar` to `components/`) FIRST, then the view extractions. Update plan order below.

---

### Task 2-5: Extract `TemplatesView`, `GlossaryView`, `SentencesView` (same recipe)

Each is a clean prop-driven function already. Same mechanical steps as Task 1.

---

### Task 6: Extract `SettingsView` cluster (`SettingsView` + `LanguageSelect` + `CacheControls` + `SiteRulesControls` + `CurrentSiteChip`)

These 5 components form the settings screen; move them as a group into `views/SettingsView.tsx` (they're only used together). Read 2327-3060 in full first.

---

### Task 7 (DO FIRST, before Task 1): Move shared leaf components to `components/`

**Files:**
- Create/extend: `src/sidepanel/components/ViewShell.tsx`, `Empty.tsx`, `SrsGradeButtons.tsx` (or add them to a single `components/leaf.tsx`)
- Modify: `src/sidepanel/App.tsx` (delete the local defs, import from `components/`)

Move these App-local leaf components that views depend on:
- `ViewShell` (1574)
- `Empty` (1585)
- `SrsGradeButtons` (3353)
- `StatsBar` (3387) — already partially in Primitives via `StatsCell`; `StatsBar` itself stays but can move too.

Each is a tiny pure component. Putting them in `components/leaf.tsx` (one file, multiple exports) avoids file proliferation.

---

### Task 8: State relocation — `revealedVocab` → VocabView, `revealedSentences` → SentencesView, `histSearch` → inline

**Files:**
- Modify: `src/sidepanel/App.tsx`, `views/VocabView.tsx`, `views/SentencesView.tsx`

Move the `useState` declarations out of `App` into the consuming view; remove the prop from the view's `Props` interface and its call site. The grade-clearing effect (App clears `revealedVocab` on grade) moves into the view.

---

### Task 9: Extract `ChatView` (highest risk — LAST)

**Files:**
- Create: `src/sidepanel/views/ChatView.tsx`
- Modify: `src/sidepanel/App.tsx`

The chat subsystem state (`messages`, `input`, `streaming`, `error`, `errorBanner`, `activeSessionId`, `slashMenu`, `busyExample`, `assistantBuf`, `abortRef`, `tokenFrameRef`, `scrollRef`) + the handlers (`handleSend`, `stopStreaming`, `retryLast`, `startNewChat`, `openSession`) + the inline chat render (1071-1296) move into `ChatView`. The `useStore.getState()` reads stay verbatim. This is the biggest single move; if it destabilizes, stop and report (leaf + settings extractions already delivered the bulk of the file-split value).

**Stop condition for Batch 3:** if ChatView extraction can't be left green after reasonable effort, leave it inline and document; the other extractions still take App from 3399 → ~1500 lines.

---

### Task 10: Final Batch 3 verification + report

Full sweep + LOC report + what was deferred (useTr context, Row adoption) and why.

---

## Self-Review

**1. Spec coverage:** leaf views (V/T/G/S) → Tasks 1-5 ✓; SettingsView cluster → Task 6 ✓; ChatView → Task 9 ✓; shared leaf components → Task 7 ✓ (added — views depend on them); state relocation → Task 8 ✓; `useTr` context → **deferred, documented** (Scope Decision 1). **2. Placeholder scan:** none — each task follows the same verified mechanical recipe. **3. Type consistency:** view Props interfaces move WITH their functions, so signatures stay identical; the only cross-file change is the import path.
