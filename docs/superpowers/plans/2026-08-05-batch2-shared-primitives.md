# Batch 2: Shared UI Helpers + `content.ts` Consistency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill cross-cutting duplication in `App.tsx` (3 blob-downloads, 2 JSON-imports, 2 jump-to-block, 2 anki-result formats) and `content.ts` (3 `clearPopups`-style openers, 3 dismiss-selector lists, 3 no-key UX blocks, 6 raw `sendMessage('open-side-panel')`), and hoist `StatsBar`'s `Cell` (a re-mount perf bug).

**Architecture:** New `src/sidepanel/lib/{downloads,chromeUtils,ankiFormat}.ts` hold pure/shareable helpers. `src/sidepanel/components/Primitives.tsx` holds `<Row>` (the 6×-repeated hover-action list row) + the hoisted `StatsBar` `Cell`. `content.ts` gets `clearPopups()`, `isLectorUiTarget(target)` + `LECTOR_UI_SELECTOR`, `requireApiKey()`, `SUMMARIZE_SYSTEM_PROMPT`, and a `tryOpenSidePanelWithSeed(seed)` companion. All behavior-preserving except `Cell`-hoist (correctness: stops re-mount) and the `INPUT_BLACKLIST`-style host safety already done in Batch 1.

**Tech Stack:** TypeScript, React 18, vitest + jsdom (with `@testing-library/react`? — no, not installed; tests use raw render via `react-dom/test-utils` or just `ReactDOM.render`; check `tests/shared/icons.test.tsx` for the established pattern).

## Global Constraints
- `NODE_ENV=development` prefix on every command.
- 456-test suite stays green after every task (Batch 1 added 20).
- `src/shared/*.ts` stays zero-DOM/zero-chrome. The new `src/sidepanel/lib/*.ts` files MAY touch DOM/chrome (they're sidepanel-side helpers, not domain logic).
- One commit per task. Conventional commits (`refactor:`, `perf:` for the Cell hoist, `fix:` only if a bug).
- TDD for the pure helpers (`downloadBlob`, `readJsonFile`, `formatAnkiResult`, `isLectorUiTarget`, `requireApiKey`'s logic is async-chrome — test what's testable). Hooks/components get a render smoke test following the `tests/shared/icons.test.tsx` pattern.

## File Structure (this batch)

| File | Action | Responsibility |
|---|---|---|
| `src/sidepanel/lib/downloads.ts` | CREATE | `downloadBlob(filename, content, mime)`, `readJsonFile<T>(file, parse): Promise<T>`. |
| `src/sidepanel/lib/chromeUtils.ts` | CREATE | `jumpToBlock(blockId)`, `useCurrentHost()` hook. |
| `src/sidepanel/lib/ankiFormat.ts` | CREATE | `formatAnkiResult(template, result)` — replaces `{added}`/`{dup}`/`{duplicated}`/`{fail}`/`{failed}`. |
| `src/sidepanel/components/Primitives.tsx` | CREATE | `<Row>`, `<IconButton>`, `StatsCell` (the hoisted Cell). |
| `src/sidepanel/App.tsx` | MODIFY | Replace the 3 blob-downloads, 2 JSON-imports, 2 jump-to-block, 2 anki-result sites; use hoisted `StatsCell` in `StatsBar`. |
| `src/content.ts` | MODIFY | `clearPopups`, `isLectorUiTarget` + `LECTOR_UI_SELECTOR`, `requireApiKey`, `SUMMARIZE_SYSTEM_PROMPT`, `tryOpenSidePanelWithSeed`; replace 6 raw `sendMessage` sites + 3 clearPopups openers + 3 no-key UX blocks + unify dismiss selectors. |
| `tests/downloads.test.ts` | CREATE | `downloadBlob` (DOM mock) + `readJsonFile`. |
| `tests/ankiFormat.test.ts` | CREATE | `formatAnkiResult` token coverage. |
| `tests/shared/Primitives.test.tsx` | CREATE | `<Row>` + `<IconButton>` render smoke. |

**Note on `<Tab>`:** A `<Tab>` primitive was considered for the 4 tab-bar + 4 MoreMenu buttons. **Rejected (YAGNI)** — the tab buttons differ enough (relative class, badge variants, MoreMenu's dropdown-active logic) that an abstraction wouldn't reduce net lines or clarify intent. The `<Row>` abstraction IS worth it because all 6 row sites share the exact hover-actions chrome.

---

### Task A: `lib/downloads.ts` + tests

**Files:**
- Create: `src/sidepanel/lib/downloads.ts`
- Test: `tests/downloads.test.ts`

**Interfaces:**
- Produces:
  - `downloadBlob(filename: string, content: string, mime: string): void` — creates `Blob`, `URL.createObjectURL`, an `<a download>`, clicks it, revokes. Behavior-identical to the 3 inline copies.
  - `readJsonFile<T>(file: File, parse: (text: string) => T): Promise<T>` — `await file.text()` then `parse`. The two call sites have different parse logic (glossary vs sentences), so `parse` is injected.

- [ ] **Step 1: Write the failing test**

Create `tests/downloads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob, readJsonFile } from '../src/sidepanel/lib/downloads'

describe('downloadBlob', () => {
  let created: { href: string; download: string; clicked: boolean } | null = null
  let revokeUrl = ''
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  beforeEach(() => {
    created = null
    revokeUrl = ''
    URL.createObjectURL = vi.fn(() => 'blob:fake-url') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn((u: string) => { revokeUrl = u }) as unknown as typeof URL.revokeObjectURL
    // jsdom HTMLAnchorElement.click() is a no-op; capture .click via prototype spy.
    HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
      created = { href: this.href, download: this.download, clicked: true }
    })
  })
  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
  })

  it('creates an <a download> with the blob URL, clicks it, and revokes', () => {
    downloadBlob('lector-highlights.md', '# Hi', 'text/markdown')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(created).not.toBeNull()
    expect(created!.download).toBe('lector-highlights.md')
    expect(created!.href).toBe('blob:fake-url')
    expect(created!.clicked).toBe(true)
    expect(revokeUrl).toBe('blob:fake-url')
  })
})

describe('readJsonFile', () => {
  it('reads file text and runs the parse callback', async () => {
    const file = new File(['{"a":1}'], 'x.json', { type: 'application/json' })
    const parsed = await readJsonFile(file, (text) => JSON.parse(text))
    expect(parsed).toEqual({ a: 1 })
  })
  it('propagates parse errors', async () => {
    const file = new File(['not json'], 'x.json')
    await expect(readJsonFile(file, JSON.parse)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/downloads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sidepanel/lib/downloads.ts`:

```ts
// Shared browser-side helpers for the sidepanel. (May touch DOM/chrome.)

/**
 * Trigger a browser download of `content` as a Blob of the given mime type.
 * Extracted from the 3 inline copies that used to live in App.tsx
 * (highlights MD, glossary JSON, sentences JSON).
 */
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Read a File's text and parse it with the injected `parse` callback. The two
 * import sites (glossary, sentences) have different parse/validation logic, so
 * parse is injected; this helper just centralizes the file.text() boilerplate.
 */
export async function readJsonFile<T>(file: File, parse: (text: string) => T): Promise<T> {
  const text = await file.text()
  return parse(text)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/downloads.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
git add src/sidepanel/lib/downloads.ts tests/downloads.test.ts
git commit -m "refactor(sidepanel): extract downloadBlob + readJsonFile to lib/downloads.ts"
```

---

### Task B: Wire `downloadBlob`/`readJsonFile` into `App.tsx`

**Files:**
- Modify: `src/sidepanel/App.tsx` (3 export sites: downloadMarkdown 473-482, glossary handleExport 2174-2183, sentences handleExport 3112-3121; the 2 imports already use `file.text()` / `FileReader`)

**Interfaces:**
- Consumes: `downloadBlob`, `readJsonFile` from Task A.

- [ ] **Step 1: Add the import**

In `src/sidepanel/App.tsx`, add to the import section near the top:

```ts
import { downloadBlob } from './lib/downloads'
```

(Only `downloadBlob` is wired here — the two import handlers use different shapes; `readJsonFile` is added to the lib for future use but wiring the sentences `FileReader` + the glossary `file.text()` both into `readJsonFile` is optional churn. **Wire `readJsonFile` only into the glossary handler** which already does `await file.text()`; leave the sentences `FileReader` handler alone — it has different teardown (`e.target.value = ''`). This keeps the change minimal and behavior-identical.)

Actually, for the glossary import (`handleImport` at 2185-2194): it does `const text = await file.text(); const res = importGlossary(text)`. `readJsonFile(file, importGlossary)` would replace the first line cleanly. Add `readJsonFile` to the import and wire it.

- [ ] **Step 2: Replace the 3 blob-download sites**

Replace `downloadMarkdown` body (473-482):

```ts
  const downloadMarkdown = (hs: Highlight[]) => {
    downloadBlob('lector-highlights.md', toMarkdown(hs), 'text/markdown')
  }
```

Replace glossary `handleExport` (2174-2183):

```ts
  const handleExport = () => {
    downloadBlob(
      `lector-glossary-${new Date().toISOString().slice(0, 10)}.json`,
      exportGlossary(entries),
      'application/json'
    )
  }
```

Replace sentences `handleExport` (3112-3121):

```ts
  const handleExport = () => {
    downloadBlob('lector-sentences.json', exportSentences(sentences), 'application/json')
  }
```

- [ ] **Step 3: Wire `readJsonFile` into glossary import**

Replace glossary `handleImport` (2185-2194):

```ts
  const handleImport = async (file: File) => {
    const res = await readJsonFile(file, importGlossary)
    if (!res.ok || !res.entries) {
      setFlash(tr('side.glossary.importFail').replace('{msg}', res.reason || ''))
      return
    }
    onImport(res.entries)
    setFlash(tr('side.glossary.importOk').replace('{n}', String(res.entries.length)))
  }
```

Update the import line to: `import { downloadBlob, readJsonFile } from './lib/downloads'`

- [ ] **Step 4: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/sidepanel/App.tsx
git commit -m "refactor(sidepanel): use downloadBlob + readJsonFile in App.tsx (kills 3 dup sites)"
```

Expected: tsc clean; 459 tests pass (456 + 3 from Task A); build succeeds.

---

### Task C: `lib/chromeUtils.ts` + tests

**Files:**
- Create: `src/sidepanel/lib/chromeUtils.ts`
- Test: extend `tests/downloads.test.ts`? No — create `tests/chromeUtils.test.ts` (or add to a sidepanel test file). Use a new file.

**Interfaces:**
- Produces:
  - `jumpToBlock(blockId: string): void` — `chrome.tabs.query({active,currentWindow})` → `chrome.tabs.sendMessage(tabId, {action:'lector-jump-to', blockId}, () => void chrome.runtime.lastError)`. Behavior-identical to the two inline copies.
  - `useCurrentHost(): string` — a React hook returning the active tab's hostname, '' until resolved. Replaces the two independent `chrome.tabs.query` sites in App (the `currentHost` state at line ~210 and inside `SiteRulesControls` at ~2474). **Scope guard:** only wire `jumpToBlock` in Task D; defer `useCurrentHost` adoption (it's a behavior-touching consolidation across two components — note in the spec, don't force it into Batch 2 to keep risk down). So `useCurrentHost` is **added to the module + tested**, but NOT wired in this batch.

- [ ] **Step 1: Write the failing test**

Create `tests/chromeUtils.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jumpToBlock } from '../src/sidepanel/lib/chromeUtils'

describe('jumpToBlock', () => {
  beforeEach(() => {
    // Minimal chrome mock on globalThis.
    const tabsSend = vi.fn((_tabId: number, _msg: unknown, cb: () => void) => cb())
    ;(globalThis as any).chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 42 }]),
        sendMessage: tabsSend,
      },
      runtime: { lastError: undefined },
    }
  })

  it('queries the active tab and sends lector-jump-to with the blockId', async () => {
    await jumpToBlock('b3')
    expect((globalThis as any).chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect((globalThis as any).chrome.tabs.sendMessage).toHaveBeenCalled()
    const [tabId, msg] = (globalThis as any).chrome.tabs.sendMessage.mock.calls[0]
    expect(tabId).toBe(42)
    expect(msg).toEqual({ action: 'lector-jump-to', blockId: 'b3' })
  })

  it('no-ops when there is no active tab id', async () => {
    ;(globalThis as any).chrome.tabs.query = vi.fn(async () => [{}]) // no id
    ;(globalThis as any).chrome.tabs.sendMessage.mockClear()
    await jumpToBlock('b1')
    expect((globalThis as any).chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/chromeUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sidepanel/lib/chromeUtils.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * Ask the active tab's content script to scroll to a citation block.
 * Replaces the two inline copies in App.tsx (onViewSource + CitationContent).
 * Behavior-identical: query active tab, send lector-jump-to, swallow lastError.
 */
export async function jumpToBlock(blockId: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  chrome.tabs.sendMessage(tab.id, { action: 'lector-jump-to', blockId }, () => {
    void chrome.runtime.lastError
  })
}

/**
 * React hook returning the active tab's hostname ('' until resolved).
 * Consolidates the two independent chrome.tabs.query sites that each computed
 * currentHost separately. Not yet adopted across all callers — see Batch 2 spec.
 */
export function useCurrentHost(): string {
  const [host, setHost] = useState('')
  useEffect(() => {
    let cancelled = false
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (!url) return
      try {
        const h = new URL(url).hostname
        if (!cancelled) setHost(h)
      } catch {
        /* invalid url — leave host empty */
      }
    })
    return () => { cancelled = true }
  }, [])
  return host
}
```

- [ ] **Step 4: Run test to verify it passes + typecheck + commit**

```bash
NODE_ENV=development node_modules/.bin/vitest run tests/chromeUtils.test.ts
NODE_ENV=development node_modules/.bin/tsc --noEmit
git add src/sidepanel/lib/chromeUtils.ts tests/chromeUtils.test.ts
git commit -m "refactor(sidepanel): add jumpToBlock + useCurrentHost to lib/chromeUtils.ts"
```

---

### Task D: Wire `jumpToBlock` into `App.tsx` (onViewSource + CitationContent)

**Files:**
- Modify: `src/sidepanel/App.tsx` (onViewSource 1553-1566 + CitationContent onClick 1613-1622)

**Interfaces:**
- Consumes: `jumpToBlock` from Task C.

- [ ] **Step 1: Add the import**

```ts
import { jumpToBlock } from './lib/chromeUtils'
```

- [ ] **Step 2: Replace onViewSource**

The block at 1553-1566 (`onViewSource={(blockId, url) => { if (blockId) { chrome.tabs.query... } else if (url) { window.open(url, '_blank') } }}`) becomes:

```tsx
          onViewSource={(blockId, url) => {
            if (blockId) {
              void jumpToBlock(blockId)
            } else if (url) {
              window.open(url, '_blank')
            }
          }}
```

- [ ] **Step 3: Replace CitationContent onClick**

The body at 1613-1622 (`const onClick = async (e) => { ... chrome.tabs.query ... chrome.tabs.sendMessage ... }`) becomes:

```tsx
    const onClick = async (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>('.lector-cite')
      if (!cite) return
      const blockId = cite.getAttribute('data-cite') || ''
      await jumpToBlock(blockId)
    }
```

- [ ] **Step 4: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/sidepanel/App.tsx
git commit -m "refactor(sidepanel): use jumpToBlock in onViewSource + CitationContent"
```

---

### Task E: `lib/ankiFormat.ts` + tests

**Files:**
- Create: `src/sidepanel/lib/ankiFormat.ts`
- Test: `tests/ankiFormat.test.ts`

**Interfaces:**
- Produces: `formatAnkiResult(template: string, result: { added: number; duplicated: number; failed: number }): string`. Replaces `{added}`, `{dup}`, `{duplicated}`, `{fail}`, `{failed}` — covers BOTH i18n string shapes (`anki.result` uses `{dup}`/`{fail}`, `side.vocab.ankiResult` uses `{duplicated}`/`{failed}`). A token absent from the template is a no-op.

- [ ] **Step 1: Write the failing test**

Create `tests/ankiFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatAnkiResult } from '../src/sidepanel/lib/ankiFormat'

describe('formatAnkiResult', () => {
  const result = { added: 3, duplicated: 1, failed: 2 }

  it('formats the short-token template (anki.result)', () => {
    expect(formatAnkiResult('Added {added}, duplicated {dup}, failed {fail}', result))
      .toBe('Added 3, duplicated 1, failed 2')
  })
  it('formats the long-token template (side.vocab.ankiResult)', () => {
    expect(formatAnkiResult('Added: {added} · Duplicated: {duplicated} · Failed: {failed}', result))
      .toBe('Added: 3 · Duplicated: 1 · Failed: 2')
  })
  it('leaves unknown tokens untouched', () => {
    expect(formatAnkiResult('no tokens here', result)).toBe('no tokens here')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/ankiFormat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/sidepanel/lib/ankiFormat.ts`:

```ts
export interface AnkiResultCounts {
  added: number
  duplicated: number
  failed: number
}

/**
 * Format an Anki-export result into a localized template. Replaces both the
 * `{added}/{dup}/{fail}` tokens (i18n key `anki.result`) and the
 * `{added}/{duplicated}/{failed}` tokens (i18n key `side.vocab.ankiResult`),
 * so the two call sites share one helper. Absent tokens are left untouched.
 */
export function formatAnkiResult(template: string, result: AnkiResultCounts): string {
  return template
    .replace('{added}', String(result.added))
    .replace('{dup}', String(result.duplicated))
    .replace('{duplicated}', String(result.duplicated))
    .replace('{fail}', String(result.failed))
    .replace('{failed}', String(result.failed))
}
```

- [ ] **Step 4: Run test + typecheck + commit**

```bash
NODE_ENV=development node_modules/.bin/vitest run tests/ankiFormat.test.ts
NODE_ENV=development node_modules/.bin/tsc --noEmit
git add src/sidepanel/lib/ankiFormat.ts tests/ankiFormat.test.ts
git commit -m "refactor(sidepanel): add formatAnkiResult to lib/ankiFormat.ts"
```

---

### Task F: Wire `formatAnkiResult` into `App.tsx` + `VocabView`

**Files:**
- Modify: `src/sidepanel/App.tsx` (line 1573 sentences anki alert + lines 1810-1813 vocab result display)

**Interfaces:**
- Consumes: `formatAnkiResult` from Task E.

- [ ] **Step 1: Add the import**

```ts
import { formatAnkiResult } from './lib/ankiFormat'
```

- [ ] **Step 2: Replace the sentences anki alert (1573)**

```ts
              alert(formatAnkiResult(tr('anki.result'), r))
```

(The `r` from `exportSentencesToAnki` has `{added, duplicated, failed}` — matches `AnkiResultCounts`. Verify the type has those fields; if it also has `errors` that's fine, structural typing allows extras.)

- [ ] **Step 3: Replace the vocab result display (1810-1813)**

```tsx
                    {formatAnkiResult(tr('side.vocab.ankiResult'), result)}
```

- [ ] **Step 4: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/sidepanel/App.tsx
git commit -m "refactor(sidepanel): use formatAnkiResult for both anki-result display sites"
```

If tsc complains that the anki result object shape doesn't match `AnkiResultCounts` exactly, adjust by passing a narrow `{added, duplicated, failed}` literal at the call site instead of the whole object.

---

### Task G: `components/Primitives.tsx` — `<Row>`, `<IconButton>`, `StatsCell`

**Files:**
- Create: `src/sidepanel/components/Primitives.tsx`
- Test: `tests/shared/Primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Row({ title, subtitle?, onClick?, actions?, children? })` — the hover-action list-row pattern. The container is `<div className="group row ...">` with title/subtitle on the left and right-aligned action buttons that are `opacity-0 group-hover:opacity-100`. `actions` is an array of `{ label, onClick, icon?, danger? }` rendered via `<IconButton>`. `onClick` on the row itself makes it clickable.
  - `IconButton({ label, onClick, children, danger?, className? })` — `aria-label={label} title={label}`, an icon child, hover styles, optional danger styling.
  - `StatsCell({ label, value })` — the exact JSX of the inner Cell from StatsBar (lines 3417-3434), hoisted to module scope.

  **Scope guard:** I will NOT rewire the 6 list-row sites into `<Row>` in this task — that's a bigger refactor touching each view's bespoke layout. `<Row>` is added + tested now so it's available; adoption is deferred (candidate for Batch 3 when views are extracted, where the row chrome can be unified per-view cleanly). The win THIS task delivers is the `StatsCell` hoist (perf) + making `<Row>`/`<IconButton>` available. This is honest scoping — don't claim the 6-site dedupe is done when it isn't.

- [ ] **Step 1: Read the existing StatsBar Cell JSX to copy it verbatim**

Read `src/sidepanel/App.tsx` lines 3416-3434 to get the exact `Cell` JSX (so the hoist is byte-identical).

- [ ] **Step 2: Write the failing test (smoke render)**

Create `tests/shared/Primitives.test.tsx`. Use the render pattern from `tests/shared/icons.test.tsx` (read that file first to copy the setup):

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
```

**First check:** is `@testing-library/react` installed? Run `grep testing-library package.json`. If NOT installed, fall back to raw `react-dom/client` render into a jsdom container (the `icons.test.tsx` pattern). Do NOT add a dependency for this.

- [ ] **Step 3: Implement Primitives.tsx**

(Given the scope guard, the implementation of `Row`/`IconButton` should match the existing hover-action chrome className strings verbatim — read one of the 6 list-row sites, e.g. VocabView around line 1853, to copy the exact classes. `StatsCell` is copied verbatim from StatsBar.)

- [ ] **Step 4: Run test + typecheck + commit**

```bash
NODE_ENV=development node_modules/.bin/vitest run tests/shared/Primitives.test.tsx
NODE_ENV=development node_modules/.bin/tsc --noEmit
git add src/sidepanel/components/Primitives.tsx tests/shared/Primitives.test.tsx
git commit -m "refactor(sidepanel): add Row + IconButton primitives; StatsCell (hoisted from StatsBar)"
```

---

### Task H: Hoist `StatsBar`'s `Cell` to use `StatsCell`

**Files:**
- Modify: `src/sidepanel/App.tsx` (StatsBar 3416-3434)

**Why this is a `perf:` not `refactor:`:** `Cell` is currently defined INSIDE `StatsBar`'s render, so every StatsBar render creates a new component identity → React unmounts/remounts the cells → loses DOM state and forces full reconciliation. Hoisting eliminates this.

- [ ] **Step 1: Add the import + replace the inner Cell**

In `src/sidepanel/App.tsx`:

```ts
import { StatsCell } from './components/Primitives'
```

Replace the `StatsBar` body: delete the inner `const Cell = ...` definition and use `<StatsCell label=... value=... />` at each of the 4 cell sites. (Read 3416-3434 first to get the exact prop values.)

- [ ] **Step 2: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/sidepanel/App.tsx
git commit -m "perf(sidepanel): hoist StatsBar Cell to module scope (stop re-mounting on every render)"
```

---

### Task I: `content.ts` consistency — `clearPopups`, `isLectorUiTarget`+`LECTOR_UI_SELECTOR`, `requireApiKey`, `SUMMARIZE_SYSTEM_PROMPT`

**Files:**
- Modify: `src/content.ts`

**Interfaces:**
- Produces (module-local helpers, not exported):
  - `clearPopups(): void` — `removeLoading(); removeResult();`
  - `const LECTOR_UI_SELECTOR = '#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, .lector-fab-menu, [data-lector-no-translate]'` — the unified selector list (merges the 3 hand-written lists; includes `[data-lector-no-translate]` which the hover handler at 2095 already uses and the others miss).
  - `isLectorUiTarget(target: HTMLElement): boolean` — `!!target.closest(LECTOR_UI_SELECTOR)`.
  - `SUMMARIZE_SYSTEM_PROMPT` constant — the literal at content.ts:265 (and reused by `runByokAction('summarize')`).
  - `requireApiKey(x, y, kind): Promise<ByokSettings | null>` — centralizes the no-key UX. Reads settings, sets `cachedPref`, and if no key: shows the add-key result popup at (x,y), opens the side panel, returns null. Otherwise returns settings. The 3 call sites (summarizePage 256-263, handleExplainSentence 1037-1045, runByokAction 1079-1088) each have slightly different (x,y) source and `kind` — `requireApiKey` takes them as params.

  **Scope guard for `requireApiKey`:** the 3 sites differ in *how they compute (x,y)* (FAB rect vs toolbar rect) and in *what they do after*. `requireApiKey` returns `null` on no-key and the caller returns early. On success the caller continues with the returned settings (avoiding a second `getSettings()` call in 2 of the 3 sites). This is a real consolidation.

- [ ] **Step 1: Add the helpers near the top of content.ts (after the existing helpers section)**

Place `clearPopups`, `LECTOR_UI_SELECTOR`, `isLectorUiTarget`, `SUMMARIZE_SYSTEM_PROMPT` near the other small helpers. Place `requireApiKey` after `loadPref` (since it sets `cachedPref`). Get the exact `ByokSettings` import already present.

```ts
const SUMMARIZE_SYSTEM_PROMPT =
  'You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.'

/** Selector for any Lector-injected UI element. Used to ignore clicks/selections
 *  that originate inside our own popups/FAB (3 sites used to hand-write this). */
const LECTOR_UI_SELECTOR =
  '#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, .lector-fab-menu, [data-lector-no-translate]'

function isLectorUiTarget(target: HTMLElement): boolean {
  return !!target.closest(LECTOR_UI_SELECTOR)
}

function clearPopups(): void {
  removeLoading()
  removeResult()
}

async function requireApiKey(
  x: number,
  y: number,
  kind: 'translate' | 'summary' | 'explain'
): Promise<ByokSettings | null> {
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  if (!settings.apiKey) {
    clearPopups()
    showResult(x, y, tr('err.addKey'), kind)
    tryOpenSidePanel()
    return null
  }
  return settings
}
```

**Note:** `requireApiKey` references `removeLoading`, `removeResult`, `showResult`, `tr`, `tryOpenSidePanel`, `cachedPref`, `getSettings`, `ByokSettings` — all already in scope at module level. `clearPopups`/`isLectorUiTarget` likewise reference `removeLoading`/`removeResult`/`closest`. These must be defined AFTER `removeLoading`/`removeResult`/`showResult`/`tryOpenSidePanel` are declared (function declarations hoist, so order is fine for the `function` ones; `const LECTOR_UI_SELECTOR` must come before `isLectorUiTarget`). Place them in the existing helpers region.

- [ ] **Step 2: Replace the 3 `clearPopups`-style openers**

In `showLoading` (537-538), `showResult` (578-579), `showStreamingTranslateResult` (683-684): replace `removeLoading(); removeResult();` with `clearPopups();`.

- [ ] **Step 3: Replace the 3 dismiss-selector sites + the no-key UX blocks + the SUMMARIZE literal**

- Hover handler (2095): `if (block.closest('#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, [data-lector-no-translate]')) return` → `if (isLectorUiTarget(block)) return`.
- mouseup handler (2218-2224): the 5-`closest` chain → `if (isLectorUiTarget(target)) { ... }`.
- mousedown handler (2278-2282): the 4-`!closest` chain → `if (!isLectorUiTarget(target) && ...) { ... }`. **Careful:** the mousedown handler has additional conditions beyond the UI-target check — read the full condition and only swap the 4 UI-target `closest` terms, preserve the rest.
- summarizePage (256-263): replace the `getSettings`+no-key block with `const settings = await requireApiKey(x, y, 'translate'); if (!settings) return`. Then `pageText` uses settings. Also replace the literal at 265 with `SUMMARIZE_SYSTEM_PROMPT`.
- handleExplainSentence (1037-1045): replace with `const settings = await requireApiKey(r()?.left || 100, r()?.top || 100, 'explain'); if (!settings) return`. Note: original then does `void relayOrAlert(...)` and `removeToolbar()` — keep those. The original also called `removeToolbar()` after the no-key return; `requireApiKey` doesn't remove the toolbar (kind differs), so keep `removeToolbar()` after the `if (!settings) { removeToolbar(); return }`. Adjust: `if (!settings) { removeToolbar(); return }`.
- runByokAction (1079-1088): replace with `const settings = await requireApiKey(r()?.left || 100, r()?.top || 100, 'translate'); if (!settings) return`.
- runByokAction summarize branch (search for the second occurrence of the SUMMARIZE literal around 1152): replace with `SUMMARIZE_SYSTEM_PROMPT`.

- [ ] **Step 4: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/content.ts
git commit -m "refactor(content): clearPopups + isLectorUiTarget + requireApiKey + SUMMARIZE_SYSTEM_PROMPT"
```

---

### Task J: Unify the 6 raw `sendMessage('open-side-panel')` sites via `tryOpenSidePanel` / `tryOpenSidePanelWithSeed`

**Files:**
- Modify: `src/content.ts`

**Interfaces:**
- Produces: `tryOpenSidePanelWithSeed(seed: object): void` — the seed-bearing companion to `tryOpenSidePanel` (same try/catch shape). The 2 seed sites (641, 764) and the 1 seed site at 1068 use this.
- The 3 plain sites (1042, 1086, 1796) switch to the existing `tryOpenSidePanel()`.

- [ ] **Step 1: Add `tryOpenSidePanelWithSeed` next to `tryOpenSidePanel` (after line 240)**

```ts
/** Best-effort: ask the background to open the side panel with a seed (e.g. a
 *  translation/chat continuation). Same context-invalidation guard as
 *  tryOpenSidePanel. */
function tryOpenSidePanelWithSeed(seed: object): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'open-side-panel', seed }).catch(() => {})
    }
  } catch {
    /* context invalidated */
  }
}
```

- [ ] **Step 2: Replace the 6 sites**

- Line 641 (showResult chatBtn): `tryOpenSidePanelWithSeed({ kind: type, text: result })`
- Line 764 (streaming chatBtn): `tryOpenSidePanelWithSeed({ kind: 'translate', text: content.textContent || '' })`
- Line 1042 (handleExplainSentence no-key): `tryOpenSidePanel()` — **but this is now inside `requireApiKey` from Task I**, so this site is already handled. Verify after Task I that line 1042 no longer exists as a raw send.
- Line 1068 (handleAction 'ask'): `tryOpenSidePanelWithSeed({ kind: 'ask', text })`
- Line 1086 (runByokAction no-key): handled by `requireApiKey` in Task I.
- Line 1796 (toggleBilingual): `tryOpenSidePanel()`.

After Task I, only sites 641, 764, 1068, 1796 remain as raw sends — replace those 4. Confirm with `grep "sendMessage.*open-side-panel" src/content.ts` that the only remaining references are inside `tryOpenSidePanel`/`tryOpenSidePanelWithSeed` themselves.

- [ ] **Step 3: Typecheck + tests + build + commit**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
git add src/content.ts
git commit -m "refactor(content): unify open-side-panel sends via tryOpenSidePanel(WithSeed)"
```

---

### Task K: Final Batch 2 verification

- [ ] **Step 1: Full sweep**

```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```

- [ ] **Step 2: Confirm the dedup is real**

```bash
grep -c "URL.createObjectURL" src/sidepanel/App.tsx   # expect 0 (was 3)
grep -c "chrome.runtime.sendMessage.*open-side-panel" src/content.ts  # expect 2 (only inside the two tryOpenSidePanel helpers)
grep -c "tr('err.addKey')" src/content.ts  # expect 1 (inside requireApiKey)
grep -c "closest('#lector-ai-result'" src/content.ts  # expect 0
```

- [ ] **Step 3: Report** (no commit) — lines saved, test count, the perf fix, what was scoped out (Tab primitive, useCurrentHost adoption, 6-row `<Row>` adoption) and why.

---

## Self-Review

**1. Spec coverage** (against `2026-08-05-comprehensive-optimization-design.md` Batch 2):
- `lib/downloads.ts` (`downloadBlob`, `readJsonFile`) → Tasks A-B. ✓
- `lib/chromeUtils.ts` (`jumpToBlock`, `useCurrentHost`) → Task C (+ D wires jumpToBlock; useCurrentHost added-but-not-wired, explicitly scoped out). ✓ (partial by design, noted)
- `lib/ankiFormat.ts` (`formatAnkiResult`) → Tasks E-F. ✓
- `<Row>`, `<IconButton>` primitives → Task G (added + tested; 6-site adoption deferred to Batch 3, noted). ✓ (partial by design)
- Hoist `StatsBar` Cell → Task H. ✓
- `content.ts`: `clearPopups`, `isLectorUiTarget`, `requireApiKey`, `SUMMARIZE_SYSTEM_PROMPT`, unified `tryOpenSidePanel` → Tasks I-J. ✓
- `<Tab>` primitive → **explicitly rejected** (YAGNI; documented in the File Structure note). ✓

**2. Placeholder scan:** Tasks G and I have "read the file first" steps because the exact JSX/classnames/conditions must be copied verbatim from the current source (I'm not memorizing them). This is honest, not a placeholder — the step instructs reading specific line ranges. No "TODO"/"TBD".

**3. Type consistency:**
- `downloadBlob(filename, content, mime)` — Task A defines, Task B calls with matching args. ✓
- `readJsonFile<T>(file, parse)` — Task A defines, Task B calls `readJsonFile(file, importGlossary)`. ✓
- `jumpToBlock(blockId): Promise<void>` — Task C defines, Task D calls `void jumpToBlock(blockId)`. ✓
- `formatAnkiResult(template, result)` — Task E defines, Task F calls with `tr('anki.result')` / `tr('side.vocab.ankiResult')`. ✓
- `AnkiResultCounts {added, duplicated, failed}` — matches both anki result types structurally. ✓
- `StatsCell({label, value})` — Task G defines, Task H uses. ✓

No mismatches.
