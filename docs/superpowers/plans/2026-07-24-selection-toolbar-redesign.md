# Selection Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heavy brown labeled selection toolbar with a compact icon-only frosted-glass pill, fix its positioning bugs, and remove emoji in favor of crisp inline SVGs.

**Architecture:** All changes live in the existing MV3 content script (`src/content.ts`) plus a tiny edit to i18n strings (`src/shared/i18n.ts`). The toolbar is still built imperatively in `createToolbar()` — we rewrite its markup, its injected `<style>` block, its icon source, and its positioning math. No new files, no new dependencies.

**Tech Stack:** TypeScript, Chrome Extension MV3, injected CSS string literals, inline SVG.

## Global Constraints

- No new npm dependencies.
- No changes to action handlers (`handleAction`, `handleHighlight`, `handleSaveWord`, `handleExplainSentence`, `runByokAction`) — only the toolbar UI and positioning.
- No changes to the loading/result popups (`showLoading`, `showResult`) or the FAB.
- No changes to `src/manifest.json`.
- Existing auto-dismiss handlers (Escape at `content.ts:705-710`, outside-mousedown at `content.ts:712-723`) already remove the toolbar — do not weaken them.
- i18n key *names* stay identical (`toolbar.translate`, etc.); only their *values* change (emoji prefix stripped).
- `npm run typecheck` (a.k.a. `tsc --noEmit`) must pass at the end of every task that touches `.ts` files.
- The seven actions and their order are fixed: translate · explain · summarize · ask | highlight · saveWord · explainSentence (the `|` is a visual divider between groups).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/shared/i18n.ts` | i18n string table | Strip emoji prefix from 7 `toolbar.*` values |
| `src/content.ts` | Content script (toolbar, FAB, extraction, bilingual) | Rewrite toolbar markup, styles, icons, positioning |

Both files already exist and are large/focused on the content script's concerns; per the "follow existing patterns" rule we do not split them. All new toolbar code is colocated in the existing "Selection toolbar" section (currently `content.ts:183-243`).

---

## Task 1: Strip emoji from toolbar i18n labels

**Files:**
- Modify: `src/shared/i18n.ts:119-125`

**Interfaces:**
- Produces: bare-text `toolbar.*` values (`'Translate'`, `'翻译'`, …) consumable as tooltip text by Task 4.

- [ ] **Step 1: Edit the seven toolbar i18n values**

In `src/shared/i18n.ts`, replace lines 119–125 so each value drops its leading `EMOJI + space`:

```ts
  // --- content script: toolbar ---
  'toolbar.translate': { en: 'Translate', zh: '翻译' },
  'toolbar.explain': { en: 'Explain', zh: '解释' },
  'toolbar.summarize': { en: 'Summarize', zh: '摘要' },
  'toolbar.ask': { en: 'Ask', zh: '提问' },
  'toolbar.highlight': { en: 'Highlight', zh: '高亮' },
  'toolbar.saveWord': { en: 'Save word', zh: '存词' },
  'toolbar.explainSentence': { en: 'Explain sentence', zh: '讲解句子' },
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no output. (If the repo has a `typecheck` script in `package.json`, prefer `npm run typecheck`.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/i18n.ts
git commit -m "refactor(i18n): strip emoji prefixes from toolbar labels for tooltip reuse"
```

---

## Task 2: Add the SVG icon set

**Files:**
- Modify: `src/content.ts` — insert a new `TOOLBAR_ICONS` map immediately above `createToolbar()` (currently at line 186).

**Interfaces:**
- Produces: `const TOOLBAR_ICONS: Record<string, string>` mapping action id → inline SVG string. Keys: `'translate' | 'explain' | 'summarize' | 'ask' | 'highlight' | 'saveWord' | 'explainSentence'`. Each SVG is a single `<svg viewBox="0 0 24 24" ...>...</svg>` string with `stroke="currentColor"`, `stroke-width="1.7"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`.
- Consumes: nothing.

- [ ] **Step 1: Insert the icon map**

Insert this block directly above the line `function createToolbar(x: number, y: number, text: string) {` (currently `content.ts:186`):

```ts
// Inline SVG icons for the selection toolbar. stroke=currentColor so the
// icon inherits the button's text color; 16px rendered (set on the <svg> in markup).
const TOOLBAR_ICONS: Record<string, string> = {
  translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.2 7.3L4 20l1-4.5A8 8 0 1 1 21 12Z"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z"/><path d="M19 14l.7 2 .3.7 2 .3-2 .3-.3.7-.7 2-.7-2-.3-.7-2-.3 2-.3.3-.7z"/></svg>',
  highlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-4 4v3h3l4-4"/><path d="M12 8l4 4"/><path d="M16.5 3.5l4 4L13 15l-4-4z"/></svg>',
  saveWord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
  explainSentence: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2"/><path d="M18 7h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2"/></svg>',
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0. (The map is a plain `Record<string, string>` with no external refs, so typecheck is the only automated gate.)

- [ ] **Step 3: Commit**

```bash
git add src/content.ts
git commit -m "feat(toolbar): add inline SVG icon set for selection toolbar"
```

---

## Task 3: Rewrite the toolbar styles for a frosted-glass pill

**Files:**
- Modify: `src/content.ts:31-38` — the `#lector-ai-toolbar*` rules inside `injectStyles()`.

**Interfaces:**
- Produces: CSS classes consumed by Task 4's markup:
  - `#lector-ai-toolbar` — the pill container (light glass).
  - `#lector-ai-toolbar.is-dark` — dark-glass override applied when the host page is dark.
  - `#lector-ai-toolbar .t-divider` — the vertical group separator.
  - `#lector-ai-toolbar .t-btn` — a 28×28 icon button with hover chip.
  - `#lector-ai-toolbar .t-btn svg` — 16px icon, inheriting `currentColor`.
- Consumes: the existing `lectorFadeIn` keyframe (defined at `content.ts:26`).

- [ ] **Step 1: Replace the toolbar CSS block**

In `src/content.ts`, inside `injectStyles()`'s template literal, replace these 8 lines (currently lines 31–38):

```ts
    #lector-ai-toolbar button { padding: 6px 12px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background-color .15s ease, transform .1s ease; display: flex; align-items: center; gap: 4px; }
    #lector-ai-toolbar button:active { transform: translateY(1px); }
    #lector-ai-toolbar .t-btn { background: #fff; color: #9C6B3C; }
    #lector-ai-toolbar .t-btn:hover { background: #F5EFE3; }
    #lector-ai-toolbar .summary-btn { background: rgba(255,255,255,.2); color: #fff; }
    #lector-ai-toolbar .summary-btn:hover { background: rgba(255,255,255,.3); }
    #lector-ai-toolbar .close-btn { background: rgba(255,255,255,.1); color: #fff; padding: 6px 8px; }
    #lector-ai-toolbar .close-btn:hover { background: rgba(255,255,255,.25); }
```

with this block:

```ts
    #lector-ai-toolbar { display: flex; align-items: center; gap: 2px; padding: 5px 8px; border-radius: 999px; }
    #lector-ai-toolbar.is-dark { }
    #lector-ai-toolbar .t-btn { width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; background: transparent; color: #6B6155; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background-color .15s ease, color .15s ease, transform .1s ease; }
    #lector-ai-toolbar .t-btn svg { width: 16px; height: 16px; display: block; }
    #lector-ai-toolbar .t-btn:hover { background: rgba(156,107,60,.12); color: #9C6B3C; }
    #lector-ai-toolbar .t-btn:active { transform: translateY(1px); }
    #lector-ai-toolbar .t-divider { width: 1px; height: 18px; margin: 0 3px; background: currentColor; opacity: .15; flex: none; }
    #lector-ai-toolbar.is-dark .t-btn { color: rgba(255,255,255,.8); }
    #lector-ai-toolbar.is-dark .t-btn:hover { background: rgba(255,255,255,.12); color: #FFF8EE; }
```

Notes for the implementer:
- The `summary-btn` and `close-btn` rules are intentionally **removed** — Task 4 drops those classes entirely (icon buttons all use `.t-btn`; the close button is removed).
- The container's `background` / `box-shadow` / `border` / `backdrop-filter` are **not** set here — they stay as inline `cssText` on the element (set in Task 4) because two of them differ between light and dark variants and the inline approach matches the existing code style. This CSS block only handles the static, variant-independent rules.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0. (CSS lives inside a template literal; typecheck won't catch CSS errors, but it confirms the TS surrounding it still parses.)

- [ ] **Step 3: Commit**

```bash
git add src/content.ts
git commit -m "style(toolbar): frosted-glass pill styles for icon buttons"
```

---

## Task 4: Rewrite `createToolbar()` markup + dark-page detection

**Files:**
- Modify: `src/content.ts:186-236` — rewrite `createToolbar()`.

**Interfaces:**
- Consumes: `TOOLBAR_ICONS` (Task 2), the new `.t-btn` / `.t-divider` classes (Task 3), `tr()` (existing, `content.ts:406`), `handleAction` / `handleHighlight` / `handleSaveWord` / `handleExplainSentence` (existing handlers — unchanged).
- Produces: a `#lector-ai-toolbar` pill element with class `is-dark` when the host page is dark; icon-only `.t-btn` buttons each carrying a `title` tooltip; auto-dismiss only (no close button). Layout/positioning of this element is finalized in Task 5; this task only builds the DOM and reads its `text` arg.

- [ ] **Step 1: Add a dark-page detection helper**

Insert this function immediately above `createToolbar()` (and above the `TOOLBAR_ICONS` map added in Task 2 is fine — order between the two doesn't matter):

```ts
// Rough luminance check of the block under the selection, to decide whether
// to render the light or dark glass variant. Defaults to light on any failure.
const BLOCK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P', 'LI', 'BLOCKQUOTE', 'TD', 'BODY'])
function isDarkPage(node: Node): boolean {
  try {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement
    while (el) {
      const bg = getComputedStyle(el).backgroundColor // e.g. "rgb(20, 22, 28)"
      const m = bg.match(/rgba?\(([^)]+)\)/)
      if (m) {
        const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()))
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          // alpha 0 → transparent → keep walking; otherwise threshold on luminance.
          const a = m[1].split(',')[3] ? parseFloat(m[1].split(',')[3]) : 1
          if (a > 0 && (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35) return true
          if (a > 0) return false
        }
      }
      el = el.parentElement
    }
  } catch {
    /* fall through to default */
  }
  return false
}
```

- [ ] **Step 2: Rewrite `createToolbar()`**

Replace the entire current `createToolbar()` body (currently lines 186–236) with:

```ts
function createToolbar(x: number, y: number, text: string) {
  removeToolbar()

  const selection = window.getSelection()
  const anchorNode = selection?.getRangeAt(0).startContainer
  const dark = anchorNode ? isDarkPage(anchorNode) : false

  selectionToolbar = document.createElement('div')
  selectionToolbar.id = 'lector-ai-toolbar'
  if (dark) selectionToolbar.classList.add('is-dark')
  selectionToolbar.style.cssText = dark
    ? `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: rgba(28,28,30,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.18); color: #fff; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`
    : `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: rgba(255,255,255,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.6); border-radius: 999px; box-shadow: 0 4px 16px rgba(43,38,32,.14), 0 1px 2px rgba(43,38,32,.06); color: #2B2620; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`

  const mk = (actionId: string, label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.className = 't-btn'
    b.type = 'button'
    b.title = label
    b.setAttribute('aria-label', label)
    b.innerHTML = TOOLBAR_ICONS[actionId]
    b.onclick = (e) => {
      e.stopPropagation()
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        alert(tr('err.extensionNotLoaded'))
        return
      }
      fn()
    }
    return b
  }

  const mkDivider = () => {
    const d = document.createElement('span')
    d.className = 't-divider'
    d.setAttribute('aria-hidden', 'true')
    return d
  }

  // Group 1: AI actions
  selectionToolbar.appendChild(mk('translate', tr('toolbar.translate'), () => handleAction('translate', text)))
  selectionToolbar.appendChild(mk('explain', tr('toolbar.explain'), () => handleAction('explain', text)))
  selectionToolbar.appendChild(mk('summarize', tr('toolbar.summarize'), () => handleAction('summarize', text)))
  selectionToolbar.appendChild(mk('ask', tr('toolbar.ask'), () => handleAction('ask', text)))
  selectionToolbar.appendChild(mkDivider())
  // Group 2: annotation
  selectionToolbar.appendChild(mk('highlight', tr('toolbar.highlight'), () => handleHighlight(text)))
  selectionToolbar.appendChild(mk('saveWord', tr('toolbar.saveWord'), () => handleSaveWord(text)))
  selectionToolbar.appendChild(mk('explainSentence', tr('toolbar.explainSentence'), () => handleExplainSentence(text)))

  document.body.appendChild(selectionToolbar)
}
```

Notes:
- `x` / `y` are now treated as **final viewport coordinates** (Task 5 computes them correctly). The old `top: ${y + 20}px` offset is gone — the caller supplies the exact target.
- The close button is removed entirely; the existing Escape/outside-click/selection-cleared handlers (`content.ts:705-723`) dismiss the pill.
- `tr(...)` already returns the bare label string after Task 1 — perfect for `title`/`aria-label`.
- All seven handlers are reused unchanged.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0. Watch for: `isDarkPage` arg type (takes `Node`), unused imports, or a dangling reference to the removed `summary-btn`/`close-btn` classes (there should be none left after Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/content.ts
git commit -m "feat(toolbar): icon-only frosted-glass pill with dark-page detection"
```

---

## Task 5: Fix the `mouseup` positioning math

**Files:**
- Modify: `src/content.ts:678-703` — the `mouseup` listener that computes `x`/`y` and calls `createToolbar`.

**Interfaces:**
- Consumes: `createToolbar(x, y, text)` from Task 4, which now expects final viewport coordinates (no internal `+20` offset, no scroll added).
- Produces: correct on-screen placement with right-edge clamp + bottom-edge flip-above.

- [ ] **Step 1: Rewrite the positioning block**

In the `mouseup` listener, replace these lines (currently 697–701):

```ts
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const x = Math.max(10, Math.min(rect.left, window.innerWidth - 280))
    const y = rect.bottom + window.scrollY
    loadPref().then(() => createToolbar(x, y, text))
```

with:

```ts
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const GAP = 8
    // Initial placement: left-aligned to selection, just below it.
    // Final clamping happens after the pill is in the DOM and measured.
    const initialX = rect.left
    const initialY = rect.bottom + GAP
    loadPref().then(() => {
      createToolbar(initialX, initialY, text)
      if (!selectionToolbar) return
      const pw = selectionToolbar.offsetWidth
      const ph = selectionToolbar.offsetHeight
      // Clamp horizontally so the pill never overflows the right edge (8px margin).
      let x = Math.min(initialX, window.innerWidth - pw - 8)
      x = Math.max(8, x)
      // If it would overflow the bottom, flip above the selection.
      let y = initialY
      if (y + ph > window.innerHeight - 8) {
        y = Math.max(8, rect.top - ph - GAP)
      }
      selectionToolbar.style.left = `${x}px`
      selectionToolbar.style.top = `${y}px`
    })
```

Notes:
- `+ window.scrollY` is **removed** — the pill is `position: fixed`, so viewport coords are correct.
- The hardcoded `280` is replaced by the measured `selectionToolbar.offsetWidth`.
- The re-clamp reads `offsetWidth`/`offsetHeight` synchronously right after `appendChild` inside `createToolbar`; this is a valid forced reflow and fine for a user-initiated mouseup.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Manual smoke test (the only meaningful test for this UI)**

Build and load the unpacked extension, then on a single page select text in four spots and confirm:
1. Mid-page, light site → pill renders as light glass, icons crisp, tooltips show on hover, all 7 buttons fire.
2. On a dark-background site (e.g. any dark-themed docs page) → pill renders dark glass with light icons.
3. Selection ending near the right edge → pill clamps inside the viewport (no horizontal scrollbar).
4. Selection near the bottom of the viewport → pill flips above the selection instead of being cut off.
5. Press Escape, click empty space, or clear the selection → pill disappears.

Build command (check `package.json` for the exact script name first; it is typically one of):
`npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/content.ts
git commit -m "fix(toolbar): viewport-relative positioning with right clamp + bottom flip"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Pill shape & surface (light/dark glass) → Tasks 3 + 4. Layout & grouping (two groups + divider) → Task 4. SVG icon set → Task 2. Emoji removal + tooltip reuse → Task 1 + Task 4 (`title`/`aria-label`). Interaction states (hover chip, active translate, no close btn) → Tasks 3 + 4. Positioning fix (drop scrollY, measured clamp, flip-above) → Task 5. ✓
- **Placeholder scan:** No TBD/TODO. Every step contains the exact code or command. ✓
- **Type consistency:** `TOOLBAR_ICONS` keys (`translate`…`explainSentence`) match the actionId strings passed to `mk()` in Task 4. `isDarkPage(node: Node)` is called with `range.startContainer` (a `Node`). `createToolbar(x, y, text)` signature unchanged. `.t-btn` / `.t-divider` / `.is-dark` class names identical between Task 3 CSS and Task 4 markup. ✓
