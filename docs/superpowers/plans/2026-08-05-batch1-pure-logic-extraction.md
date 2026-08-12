# Batch 1: Pure-Logic Extraction from `content.ts` → `src/shared/*`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure logic trapped in `src/content.ts` into unit-testable `src/shared/*` modules, dedupe a `detectLang` copy, fix the `INPUT_BLACKLIST` substring host-match bug, and leave observable behavior identical.

**Architecture:** Behavior-preserving extractions. New modules (`src/shared/radialMenu.ts`, `src/shared/color.ts`, `src/shared/readability.ts`) are zero-DOM/zero-chrome and unit-tested in jsdom. `INPUT_BLACKLIST`/`inputBoxDisabledForHost` move into the existing `siteRules.ts` (which already owns host-matching) and reuse `matchHost`. `detectLang` is a duplicate of `translation.ts::detectSourceLang` — delete it and switch the one caller.

**Tech Stack:** TypeScript, vitest + jsdom, Chrome MV3 content-script bundle (single IIFE via `vite.content.config.ts`).

## Global Constraints

- **All commands run with `NODE_ENV=development` prefix** (the host shell is otherwise `production` and skips devDeps).
- **The 436-test suite must stay green** after every task. A behavior change that flips an existing test's expectation: update the test (TDD), never delete it.
- **`src/shared/*.ts` stays zero-DOM, zero-chrome.** No `document`, `window`, `getComputedStyle`, `chrome.*`, `location`. This is what makes them jsdom-testable.
- **`src/content.ts` must remain a single self-contained IIFE bundle.** New imports from `./shared/*` are fine — `vite.content.config.ts` already inlines them via `inlineDynamicImports`. Verify with `npm run build:extension` after each task that touches `content.ts`.
- **No `as any` in new code.** The codebase currently has effectively zero `any` in `src/shared/`.
- **Run typecheck after every task:** `NODE_ENV=development node_modules/.bin/tsc --noEmit`.
- **One commit per task**, conventional-commits style (`refactor:`, `fix:`, `test:`).

## File Structure (this batch)

| File | Action | Responsibility |
|---|---|---|
| `src/shared/radialMenu.ts` | CREATE | Pure trig: `fanOutPositions(n, radius, startDeg, endDeg): {dx,dy}[]`. |
| `src/shared/color.ts` | CREATE | Pure color math: `parseCssRgb(str)`, `relativeLuminance(rgb)`. |
| `src/shared/readability.ts` | CREATE | Pure extraction scoring: `NOISE_SELECTORS` (data), `scoreNodeFromStats(input)`. |
| `src/shared/siteRules.ts` | MODIFY | Add `INPUT_BLACKLIST` (data) + `inputBoxDisabledForHost(host)` reusing `matchHost`. Fix substring bug + drop dead `notion.so/` entry. |
| `src/content.ts` | MODIFY | Import the new modules, delete `detectLang`, delete inlined copies, call shared versions. |
| `tests/radialMenu.test.ts` | CREATE | Unit tests for `fanOutPositions`. |
| `tests/color.test.ts` | CREATE | Unit tests for `parseCssRgb` + `relativeLuminance`. |
| `tests/readability.test.ts` | CREATE | Unit tests for `scoreNodeFromStats`. |
| `tests/siteRules.test.ts` | MODIFY | Add tests for `inputBoxDisabledForHost` incl. the bug regression. |

---

### Task 1: `fanOutPositions` — pure radial-menu geometry

**Files:**
- Create: `src/shared/radialMenu.ts`
- Test: `tests/radialMenu.test.ts`

**Interfaces:**
- Produces: `fanOutPositions(n: number, radius: number, startDeg: number, endDeg: number): Array<{ dx: number; dy: number }>`. For `n === 1`, returns a single point at `startDeg` (avoids divide-by-zero). Angles in degrees, screen coords (y grows downward). Reproduces the existing `angleDeg = 200 + (i*(340-200))/max(1,n-1)` formula in `content.ts:392`.

- [ ] **Step 1: Write the failing test**

Create `tests/radialMenu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fanOutPositions } from '../src/shared/radialMenu'

describe('fanOutPositions', () => {
  it('returns one point at startDeg when n === 1 (no divide-by-zero)', () => {
    const [p] = fanOutPositions(1, 76, 200, 340)
    // cos(200°)*76, sin(200°)*76
    expect(p.dx).toBeCloseTo(Math.cos((200 * Math.PI) / 180) * 76, 5)
    expect(p.dy).toBeCloseTo(Math.sin((200 * Math.PI) / 180) * 76, 5)
  })

  it('returns n points for n >= 2, evenly fanned between startDeg and endDeg', () => {
    const pts = fanOutPositions(3, 76, 200, 340)
    expect(pts).toHaveLength(3)
    // First at startDeg, last at endDeg.
    expect(pts[0].dx).toBeCloseTo(Math.cos((200 * Math.PI) / 180) * 76, 5)
    expect(pts[2].dx).toBeCloseTo(Math.cos((340 * Math.PI) / 180) * 76, 5)
    // Middle at the midpoint angle (270°).
    expect(pts[1].dx).toBeCloseTo(Math.cos((270 * Math.PI) / 180) * 76, 5)
    expect(pts[1].dy).toBeCloseTo(Math.sin((270 * Math.PI) / 180) * 76, 5)
  })

  it('returns [] for n === 0', () => {
    expect(fanOutPositions(0, 76, 200, 340)).toEqual([])
  })

  it('handles negative angles and radius 0', () => {
    const [p] = fanOutPositions(1, 0, -90, 90)
    expect(p).toEqual({ dx: 0, dy: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/radialMenu.test.ts`
Expected: FAIL — "Cannot find module '../src/shared/radialMenu'".

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/radialMenu.ts`:

```ts
// Pure trig for the FAB radial menu. No DOM, no chrome.

/**
 * Compute n fan-out positions along a circular arc, in screen coordinates
 * (y grows downward). Reproduces the formula used by the FAB menu in
 * content.ts: angleDeg = startDeg + (i * (endDeg - startDeg)) / max(1, n - 1).
 *
 * For n === 1 the single point sits at startDeg (avoids divide-by-zero and
 * matches the existing Math.max(1, n - 1) guard).
 */
export function fanOutPositions(
  n: number,
  radius: number,
  startDeg: number,
  endDeg: number
): Array<{ dx: number; dy: number }> {
  if (n <= 0) return []
  const span = endDeg - startDeg
  const out: Array<{ dx: number; dy: number }> = []
  for (let i = 0; i < n; i++) {
    const angleDeg = startDeg + (i * span) / Math.max(1, n - 1)
    const rad = (angleDeg * Math.PI) / 180
    out.push({ dx: Math.cos(rad) * radius, dy: Math.sin(rad) * radius })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/radialMenu.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/radialMenu.ts tests/radialMenu.test.ts
git commit -m "refactor(content): extract fanOutPositions to src/shared/radialMenu.ts"
```

---

### Task 2: Wire `fanOutPositions` into `content.ts::toggleFabMenu`

**Files:**
- Modify: `src/content.ts` (the `actions.forEach` block, lines ~388-395)
- Test: existing `tests/content.test.ts` (no new test — wiring is covered by build + the integration smoke)

**Interfaces:**
- Consumes: `fanOutPositions` from Task 1.

- [ ] **Step 1: Add the import**

At the top of `src/content.ts`, alongside the existing `./shared/translation` import, add `fanOutPositions`. Find the existing import block (it imports many names from `./shared/translation`, `./shared/byok`, etc.). Add:

```ts
import { fanOutPositions } from './shared/radialMenu'
```

- [ ] **Step 2: Replace the inline angle math**

In `toggleFabMenu()` (around line 388), replace:

```ts
  const R = 76 // arc radius (px) from FAB center to each item center
  const n = actions.length
  actions.forEach((a, i) => {
    // Spread across the upper semicircle: from 200° (left-up) to 340° (right-up)
    // so items sit above the FAB and don't overlap the edge.
    const angleDeg = 200 + (i * (340 - 200)) / Math.max(1, n - 1)
    const rad = (angleDeg * Math.PI) / 180
    const dx = Math.cos(rad) * R
    const dy = Math.sin(rad) * R // negative = upward (screen y grows downward)
    const item = document.createElement('button')
```

with:

```ts
  const R = 76 // arc radius (px) from FAB center to each item center
  // Spread across the upper semicircle: from 200° (left-up) to 340° (right-up)
  // so items sit above the FAB and don't overlap the edge. Geometry lives in
  // src/shared/radialMenu.ts so it can be unit-tested.
  const positions = fanOutPositions(actions.length, R, 200, 340)
  actions.forEach((a, i) => {
    const { dx, dy } = positions[i] // negative dy = upward (screen y grows downward)
    const item = document.createElement('button')
```

Leave the rest of the loop body (item.className, --lector-rest, animation) untouched.

- [ ] **Step 3: Typecheck + full test suite + build**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; 436 tests pass (24 files); build writes `dist/content.js`.

- [ ] **Step 4: Commit**

```bash
git add src/content.ts
git commit -m "refactor(content): use fanOutPositions in toggleFabMenu"
```

---

### Task 3: `parseCssRgb` + `relativeLuminance` — pure color math

**Files:**
- Create: `src/shared/color.ts`
- Test: `tests/color.test.ts`

**Interfaces:**
- Produces:
  - `interface Rgb { r: number; g: number; b: number; a?: number }`
  - `parseCssRgb(str: string): Rgb | null` — parses `"rgb(r, g, b)"` and `"rgba(r, g, b, a)"` (whitespace-tolerant). Returns `null` if it doesn't match. Reproduces the regex `/rgba?\(([^)]+)\)/` + comma-split logic from `content.ts::isDarkPage` (lines 489-494).
  - `relativeLuminance({r,g,b}): number` — `(0.2126*r + 0.7152*g + 0.0722*b) / 255`, normalized to 0..1 (the formula in `content.ts:495`).

- [ ] **Step 1: Write the failing test**

Create `tests/color.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseCssRgb, relativeLuminance } from '../src/shared/color'

describe('parseCssRgb', () => {
  it('parses rgb() with spaces', () => {
    expect(parseCssRgb('rgb(20, 22, 28)')).toEqual({ r: 20, g: 22, b: 28 })
  })
  it('parses rgba() with alpha', () => {
    expect(parseCssRgb('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })
  it('returns null for non-matching strings', () => {
    expect(parseCssRgb('transparent')).toBeNull()
    expect(parseCssRgb('')).toBeNull()
    expect(parseCssRgb('#fff')).toBeNull()
  })
  it('returns null when components are NaN', () => {
    expect(parseCssRgb('rgb(foo, bar, baz)')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('returns 1 for pure white', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })
  it('returns 0 for pure black', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })
  it('matches the dark-threshold formula from content.ts', () => {
    // content.ts:495 used (0.2126*r + 0.7152*g + 0.0722*b) / 255 < 0.35
    const dark = relativeLuminance({ r: 20, g: 22, b: 28 })
    expect(dark).toBeLessThan(0.35)
    const light = relativeLuminance({ r: 240, g: 240, b: 240 })
    expect(light).toBeGreaterThan(0.35)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/color.ts`:

```ts
// Pure CSS-color math for the dark/light glass decision in content.ts.
// No DOM, no chrome.

export interface Rgb {
  r: number
  g: number
  b: number
  a?: number
}

/**
 * Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" into components.
 * Returns null if the string doesn't match or any component is NaN.
 * Whitespace-tolerant. Reproduces the parsing logic that used to live inline
 * in content.ts::isDarkPage.
 */
export function parseCssRgb(str: string): Rgb | null {
  const m = str.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  const [r, g, b] = parts
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  const a = parts[3]
  const out: Rgb = { r, g, b }
  if (!Number.isNaN(a)) out.a = a
  return out
}

/**
 * WCAG-style relative luminance normalized to 0..1.
 * `(0.2126*r + 0.7152*g + 0.0722*b) / 255`. Linear with sRGB bytes (good enough
 * for the binary dark/light threshold used by content.ts).
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/color.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/color.ts tests/color.test.ts
git commit -m "refactor(content): extract parseCssRgb + relativeLuminance to src/shared/color.ts"
```

---

### Task 4: Wire `parseCssRgb`/`relativeLuminance` into `content.ts::isDarkPage`

**Files:**
- Modify: `src/content.ts::isDarkPage` (lines ~483-505)

**Interfaces:**
- Consumes: `parseCssRgb`, `relativeLuminance` from Task 3.

- [ ] **Step 1: Add the import**

In the import block at the top of `src/content.ts`:

```ts
import { parseCssRgb, relativeLuminance } from './shared/color'
```

- [ ] **Step 2: Replace the inline color math**

Replace the body of `isDarkPage` (the `while (el)` loop that does the regex match + luminance arithmetic). The current body is:

```ts
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

Replace with:

```ts
function isDarkPage(node: Node): boolean {
  try {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement
    while (el) {
      const rgb = parseCssRgb(getComputedStyle(el).backgroundColor)
      if (rgb) {
        // alpha 0 → transparent → keep walking; otherwise threshold on luminance.
        const a = typeof rgb.a === 'number' ? rgb.a : 1
        if (a > 0) return relativeLuminance(rgb) < 0.35
      }
      el = el.parentElement
    }
  } catch {
    /* fall through to default */
  }
  return false
}
```

Note: this is behavior-identical. The previous code did two `parseFloat` of the alpha string; `parseCssRgb` parses it once. The `if (a > 0)` short-circuit means `a === 0` falls through to keep walking — same as before.

- [ ] **Step 3: Typecheck + full test suite + build**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; 436 tests pass; build writes `dist/content.js`.

- [ ] **Step 4: Commit**

```bash
git add src/content.ts
git commit -m "refactor(content): use parseCssRgb/relativeLuminance in isDarkPage"
```

---

### Task 5: `scoreNodeFromStats` — pure extraction scoring

**Files:**
- Create: `src/shared/readability.ts`
- Test: `tests/readability.test.ts`

**Interfaces:**
- Produces:
  - `const NOISE_SELECTORS: readonly string[]` — moved verbatim from `content.ts:85-90`.
  - `interface NodeStats { text: string; linkCount: number; wordCount: number }`
  - `scoreNodeFromStats({ text, linkCount, wordCount }: NodeStats): number` — pure port of the body of `content.ts::scoreNode` (lines 92-100). Empty text → 0; otherwise `text.length + commas*8 - (linkCount/max(1,wordCount))*200`.

- [ ] **Step 1: Write the failing test**

Create `tests/readability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreNodeFromStats, NOISE_SELECTORS } from '../src/shared/readability'

describe('NOISE_SELECTORS', () => {
  it('includes the standard set used by extractPage', () => {
    expect(NOISE_SELECTORS).toContain('header')
    expect(NOISE_SELECTORS).toContain('footer')
    expect(NOISE_SELECTORS).toContain('[role="navigation"]')
    expect(NOISE_SELECTORS.length).toBeGreaterThanOrEqual(15)
  })
})

describe('scoreNodeFromStats', () => {
  it('returns 0 for empty/whitespace text', () => {
    expect(scoreNodeFromStats({ text: '', linkCount: 0, wordCount: 0 })).toBe(0)
    expect(scoreNodeFromStats({ text: '   ', linkCount: 0, wordCount: 0 })).toBe(0)
  })
  it('rewards long comma-rich text', () => {
    const long = 'one, two, three, four, five, six, seven, eight, nine, ten words here ok'
    const score = scoreNodeFromStats({ text: long, linkCount: 0, wordCount: 12 })
    expect(score).toBeGreaterThan(0)
    // text.length + commas*8 - 0 = 60 + 9*8 = 132
    expect(score).toBe(long.length + 9 * 8)
  })
  it('penalizes link-heavy (nav-like) nodes', () => {
    const nav = 'a b c d' // 4 words
    const navScore = scoreNodeFromStats({ text: nav, linkCount: 4, wordCount: 4 })
    expect(navScore).toBeLessThan(0) // 7 - (4/4)*200 = 7 - 200 = -193
  })
  it('guards wordCount against divide-by-zero (wordCount 0 → no penalty)', () => {
    const score = scoreNodeFromStats({ text: 'hello', linkCount: 5, wordCount: 0 })
    expect(score).toBe(5) // 5 + 0*8 - (5/1)*0... wait: linkDensity = 5/max(1,0)=5; 5*200=1000
    // Actually linkDensity = 5 / max(1, 0) = 5, so score = 5 - 1000 = -995
    expect(score).toBe(5 - 1000)
  })
})
```

Note in step 1: the `expect(score).toBe(5)` line on the wordCount-0 case is wrong and will fail — that's the TDD prompt to fix the test before implementing. Fix it to the correct value shown in the comment (`5 - 1000`), then keep only that assertion:

```ts
  it('guards wordCount against divide-by-zero (wordCount 0 → density uses max(1,0)=1)', () => {
    const score = scoreNodeFromStats({ text: 'hello', linkCount: 5, wordCount: 0 })
    expect(score).toBe(5 - 1000) // linkDensity = 5/max(1,0) = 5; 5*200 = 1000
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/readability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/readability.ts`:

```ts
// Pure Readability-style scoring for content extraction. No DOM, no chrome.
// The DOM glue that turns an Element into a NodeStats lives in content.ts.

/** Selectors stripped from the cloned extraction root (data only). */
export const NOISE_SELECTORS: readonly string[] = [
  'header', 'footer', 'nav', 'aside', 'form', 'iframe',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.advertisement', '.ads', '.ad', '.share', '.social', '.newsletter',
  '.related', '.comments', '.comment', '.sidebar', '.cookie',
] as const

export interface NodeStats {
  text: string
  linkCount: number
  wordCount: number
}

/**
 * Density score: text length + comma bonus - link-density penalty.
 * Pure port of content.ts::scoreNode. Empty text → 0.
 */
export function scoreNodeFromStats({ text, linkCount, wordCount }: NodeStats): number {
  const t = text.trim()
  if (!t) return 0
  const commas = (t.match(/[,.，。、；:;?!]/g) || []).length
  const linkDensity = linkCount / Math.max(1, wordCount)
  return t.length + commas * 8 - linkDensity * 200
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/readability.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/readability.ts tests/readability.test.ts
git commit -m "refactor(content): extract scoreNodeFromStats + NOISE_SELECTORS to src/shared/readability.ts"
```

---

### Task 6: Wire `scoreNodeFromStats`/`NOISE_SELECTORS` into `content.ts`

**Files:**
- Modify: `src/content.ts` (delete local `NOISE_SELECTORS` lines 85-90 + `scoreNode` 92-100; update `findBestContentRoot` + `extractPage` callers)

**Interfaces:**
- Consumes: `NOISE_SELECTORS`, `scoreNodeFromStats` from Task 5.

- [ ] **Step 1: Add the import**

```ts
import { NOISE_SELECTORS, scoreNodeFromStats } from './shared/readability'
```

- [ ] **Step 2: Delete the local copies**

Delete the `const NOISE_SELECTORS = [...]` block (lines 85-90) and the `function scoreNode(el: Element): number { ... }` block (lines 92-100) from `src/content.ts`.

- [ ] **Step 3: Update `findBestContentRoot` to build NodeStats + call the pure scorer**

In `findBestContentRoot()`, the loop currently does:

```ts
  for (const el of candidates) {
    const score = scoreNode(el)
    if (score > bestScore) {
```

Replace with:

```ts
  for (const el of candidates) {
    const text = (el.textContent || '').trim()
    const linkCount = el.querySelectorAll('a').length
    const wordCount = text ? text.split(/\s+/).length : 0
    const score = scoreNodeFromStats({ text, linkCount, wordCount })
    if (score > bestScore) {
```

(The DOM reads `el.textContent` and `el.querySelectorAll('a')` stay here; only the arithmetic moved.)

- [ ] **Step 4: Verify `extractPage` still uses `NOISE_SELECTORS` correctly**

`extractPage()` references `NOISE_SELECTORS` (the `forEach` at line 172). After the import is added and the local const deleted, this resolves to the imported one. No change needed at the call site. Confirm by reading the function: it iterates `NOISE_SELECTORS.forEach((sel) => clone.querySelectorAll(sel)...)` — works identically on a `readonly string[]`.

- [ ] **Step 5: Typecheck + full test suite + build**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; 436 tests pass; build writes `dist/content.js`.

- [ ] **Step 6: Commit**

```bash
git add src/content.ts
git commit -m "refactor(content): use scoreNodeFromStats + NOISE_SELECTORS from shared/readability"
```

---

### Task 7: Move `INPUT_BLACKLIST` + `inputBoxDisabledForHost` to `siteRules.ts` (and fix the substring bug)

**Files:**
- Modify: `src/shared/siteRules.ts` (add the data + the function)
- Modify: `src/content.ts` (delete the local copies, import the shared ones)
- Modify: `tests/siteRules.test.ts` (add tests including the bug regression)

**Interfaces:**
- Produces:
  - `const INPUT_BLACKLIST: readonly string[]` — `['chrome.google.com', 'notion.so', 'larksuite.com', 'feishu.cn']` (dropped the dead `'notion.so/'` entry — `matchHost` normalizes, so a bare `/` never matches a hostname anyway).
  - `inputBoxDisabledForHost(host: string): boolean` — takes the host as a param (pure; `content.ts` passes `location.hostname`). Returns true iff any blacklist pattern matches the host via `matchHost`.

- [ ] **Step 1: Write the failing test**

Append to `tests/siteRules.test.ts` (after the existing imports, add `inputBoxDisabledForHost` to the import from `'../src/shared/siteRules'`):

```ts
import {
  // ... existing imports ...
  inputBoxDisabledForHost,
} from '../src/shared/siteRules'

describe('inputBoxDisabledForHost', () => {
  it('returns true for exact blacklisted hosts', () => {
    expect(inputBoxDisabledForHost('notion.so')).toBe(true)
    expect(inputBoxDisabledForHost('feishu.cn')).toBe(true)
  })
  it('returns true for subdomains of blacklisted hosts', () => {
    expect(inputBoxDisabledForHost('www.notion.so')).toBe(true)
    expect(inputBoxDisabledForHost('workspace.feishu.cn')).toBe(true)
  })
  it('REGRESSION: does NOT match a host that merely contains the pattern as a substring', () => {
    // The old h.includes(b) impl returned true here — a real bug.
    expect(inputBoxDisabledForHost('notion.so.evil.com')).toBe(false)
    expect(inputBoxDisabledForHost('fakenotion.so')).toBe(false)
  })
  it('returns false for unrelated hosts', () => {
    expect(inputBoxDisabledForHost('example.com')).toBe(false)
    expect(inputBoxDisabledForHost('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/siteRules.test.ts`
Expected: FAIL — `inputBoxDisabledForHost` is not exported.

- [ ] **Step 3: Add the data + function to `siteRules.ts`**

At the end of `src/shared/siteRules.ts`, append:

```ts

/** Known-incompatible site hosts where input-box translation is off by
 *  default (matches Immersive's documented limits). The user can still
 *  force-enable it per-site via an explicit rule, but this avoids flaky
 *  behavior on the listed domains. */
export const INPUT_BLACKLIST: readonly string[] = [
  'chrome.google.com',
  'notion.so',
  'larksuite.com',
  'feishu.cn',
] as const

/**
 * Whether input-box translation is disabled by default for a host. Uses the
 * proper host-suffix matcher (NOT substring) so 'notion.so' no longer matches
 * 'notion.so.evil.com'. The host is passed in (pure); content.ts passes
 * location.hostname.
 */
export function inputBoxDisabledForHost(host: string): boolean {
  return INPUT_BLACKLIST.some((pattern) => matchHost(pattern, host))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/siteRules.test.ts`
Expected: PASS (existing 17 + new 4 = 21 tests).

- [ ] **Step 5: Update `content.ts` to import + use the shared version**

In `src/content.ts`:
1. Add to the existing `./shared/siteRules` import (or add the import if not present): `inputBoxDisabledForHost`. Find the import — `content.ts` imports from `./shared/siteRules` (it uses `findRuleForHost`, `shouldAutoTranslatePage`). Add `inputBoxDisabledForHost` to that import list.
2. Delete the local `const INPUT_BLACKLIST = [...]` (line 2166) and `function inputBoxDisabledForHost(): boolean { ... }` (lines 2168-2171).
3. Update the one caller (line 2229). It currently calls `inputBoxDisabledForHost()` with no args. Change to pass the host:

```ts
  if (!inputCfg.enabled || inputBoxDisabledForHost(location.hostname)) return
```

(Search for any other callers of the local `inputBoxDisabledForHost` — per grep there is only the one at line 2229.)

- [ ] **Step 6: Typecheck + full test suite + build**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; tests pass (now 437 — one new test added); build writes `dist/content.js`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/siteRules.ts src/content.ts tests/siteRules.test.ts
git commit -m "fix(content): use matchHost for INPUT_BLACKLIST (substring host-match bug)

inputBoxDisabledForHost moved to siteRules.ts and now uses matchHost,
fixing 'notion.so' matching 'notion.so.evil.com'. Drops dead 'notion.so/'
entry (matchHost normalizes patterns)."
```

---

### Task 8: Delete duplicate `detectLang`, switch `extractPage` to `detectSourceLang`

**Files:**
- Modify: `src/content.ts` (delete `detectLang` lines 149-165; change line 213; fix the import)
- Test: existing `tests/extract.test.ts` (verify it still passes; no new test — `detectSourceLang` is already tested in `tests/translation.test.ts`)

**Interfaces:**
- Consumes: `detectSourceLang` from `./shared/translation` (already exported; `content.ts` already imports from `./shared/translation`).

- [ ] **Step 1: Verify the two functions are behavior-equivalent for the cases `extractPage` hits**

Read `src/content.ts::detectLang` (149-165) and `src/shared/translation.ts::detectSourceLang` (161-189). `detectLang` handles cjk→ja/ko/zh, cyrillic→ru, arabic→ar, hebrew→he, greek→el, devanagari→hi, thai→th, default→en. `detectSourceLang` is a strict superset (it also covers bengali/gurmukhi/etc.). For every script `detectLang` branches on, `detectSourceLang` returns the same code. So switching is behavior-preserving for existing inputs and strictly better for newly-covered scripts. (This is the audit; record it in the commit message.)

- [ ] **Step 2: Ensure `detectSourceLang` is imported in `content.ts`**

`content.ts` already imports a batch of names from `./shared/translation` (including `detectScript`, `EXCLUDED_ANCESTOR_TAGS`, etc. — see line 924). Add `detectSourceLang` to that import list if it isn't already there.

- [ ] **Step 3: Delete `detectLang` and update its only caller**

1. Delete the entire `function detectLang(text: string): string { ... }` block (lines 149-165).
2. At line 213, change `lang: detectLang(text),` to `lang: detectSourceLang(text),`.

(Grep confirms `detectLang` is only defined + called at lines 149/213 inside `content.ts`.)

- [ ] **Step 4: Typecheck + full test suite + build**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; 437 tests pass; build writes `dist/content.js`.

- [ ] **Step 5: Commit**

```bash
git add src/content.ts
git commit -m "refactor(content): delete duplicate detectLang, use translation.detectSourceLang

content.ts::detectLang was a strict-subset copy of
translation.ts::detectSourceLang (cjk/cyrillic/arabic/hebrew/greek/
devanagari/thai -> same codes; detectSourceLang also covers bengali etc.).
Switching is behavior-preserving for existing scripts and fixes the dup."
```

---

### Task 9: Final Batch 1 verification

**Files:** none (verification only).

- [ ] **Step 1: Full green sweep**

Run:
```bash
NODE_ENV=development node_modules/.bin/tsc --noEmit
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
```
Expected: tsc exit 0; all tests pass; build succeeds.

- [ ] **Step 2: Bundle-size sanity (report, not gate)**

Run: `ls -lh dist/content.js dist/sidepanel.js dist/chunks/*.js`
Expected: `dist/content.js` exists; sizes comparable to baseline (content.js 34K, sidepanel.js 184K, byok chunk 21K). Small delta expected from new shared modules being inlined into content.js.

- [ ] **Step 3: Confirm the new structure is reflected**

Run: `ls src/shared/`
Expected: includes `radialMenu.ts`, `color.ts`, `readability.ts` (in addition to the pre-existing modules).

- [ ] **Step 4: Confirm no `any` regressions in new code**

Run: `grep -n "as any\|: any" src/shared/radialMenu.ts src/shared/color.ts src/shared/readability.ts src/shared/siteRules.ts`
Expected: no matches.

- [ ] **Step 5: Report results** (not a git step)

Summarize to the user: lines removed from content.ts, new test count, bundle delta, the bug fixed. No commit (verification only).

---

## Self-Review

**1. Spec coverage** (against `2026-08-05-comprehensive-optimization-design.md` Batch 1):
- `langDetect.ts` / `detectLang` move → Tasks 8 (decided to delete-and-reuse rather than new module — better; documented inline). ✓
- `readability.ts` with `scoreNode` + `NOISE_SELECTORS` → Tasks 5-6. ✓
- `radialMenu.ts` with `fanOutPositions` → Tasks 1-2. ✓
- `color.ts` with `relativeLuminance` + `parseCssRgb` → Tasks 3-4. ✓
- extend `siteRules.ts` with `INPUT_BLACKLIST` + `inputBoxDisabledForHost` + fix `includes()` bug → Task 7. ✓
- Each new module gets a vitest test → Tasks 1, 3, 5, 7. ✓
- `content.ts` imports the new modules; behavior identical → Tasks 2, 4, 6, 7, 8. ✓
- Tests + typecheck green; `build:extension` succeeds → every task's verification + Task 9. ✓

**2. Placeholder scan:** none. Every step has exact code or exact shell command. The one intentional "TDD prompt to fix the test" in Task 5 step 1 is called out and the corrected assertion is given immediately after.

**3. Type consistency:**
- `fanOutPositions(n, radius, startDeg, endDeg): Array<{dx,dy}>` — defined Task 1, used Task 2. ✓
- `parseCssRgb(str): Rgb | null`, `relativeLuminance(Rgb): number`, `Rgb {r,g,b,a?}` — defined Task 3, used Task 4. ✓
- `scoreNodeFromStats(NodeStats): number`, `NodeStats {text,linkCount,wordCount}`, `NOISE_SELECTORS: readonly string[]` — defined Task 5, used Task 6. ✓
- `inputBoxDisabledForHost(host: string): boolean` — defined Task 7, called with `location.hostname` in Task 7 step 5. ✓
- `detectSourceLang(text): string` — already exists in `translation.ts`; used in Task 8. ✓

No mismatches.
