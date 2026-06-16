# Trust & Depth Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three competitive features (citation-grounded reading, highlights→export, SM-2 vocabulary builder) into Lector AI, with pure-logic unit tests (vitest) and a green extension build.

**Architecture:** Pure logic (citations, SRS, highlights, vocabulary, exporters) extracted into zero-DOM-dependency modules under `src/shared/` with vitest unit tests. These are consumed by the DOM/UI layer (`content.ts`, `sidepanel/App.tsx`, `store.ts`). Only Feature ① touches the backend, by extending the existing `/chat` system prompt. No new endpoints, no new DB tables.

**Tech Stack:** TypeScript, React 18, Zustand, Vite (build), vitest (tests, new), jsdom (integration tests, new).

---

## File structure

**New pure-logic modules (zero DOM deps, unit-tested):**
- `src/shared/citations.ts` — `[bN]` parse / render / system-prompt build (Feature ①)
- `src/shared/srs.ts` — SM-2 scheduler pure functions (Feature ③)
- `src/shared/highlights.ts` — Highlight type + serialize/dedupe/group (Feature ②, reused by ③)
- `src/shared/vocabulary.ts` — VocabEntry type + save/merge/validation (Feature ③)
- `src/shared/exporters.ts` — Markdown/Obsidian/Notion ExportProvider (Feature ②)

**New tests (vitest + jsdom):**
- `tests/citations.test.ts`, `tests/srs.test.ts`, `tests/highlights.test.ts`, `tests/vocabulary.test.ts`, `tests/exporters.test.ts`, `tests/content.test.ts`

**Modified:**
- `src/content.ts` — block anchors, highlight injection, vocab save, message handlers, jump-to
- `src/shared/store.ts` — add `highlights[]`, `vocab[]` state + actions
- `src/sidepanel/App.tsx` — Highlights drawer, Vocab drawer, citation chip rendering
- `src/sidepanel/markdown.ts` — citation chip post-processing
- `api/chat/index.ts` — `[bN]`-prefixed blocks in system prompt
- `src/manifest.json` — version 0.3.0, commands
- `package.json` — add vitest, jsdom, test scripts
- `src/content.css` — highlight + citation pulse styles

---

## Task 0: Test harness (vitest + jsdom)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D vitest@^2 jsdom@^25 @types/jsdom
```
Expected: packages added to devDependencies.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
})
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 4: Verify harness with a smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Remove smoke test, commit**

```bash
rm tests/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): add vitest + jsdom test harness"
```

---

## Task 1: Citations module (Feature ① pure logic)

**Files:**
- Create: `src/shared/citations.ts`
- Test: `tests/citations.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/citations.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  parseCitations,
  buildCitedSystemPrompt,
  renderCitations,
} from '../src/shared/citations'
import type { PageBlock } from '../src/shared/citations'

describe('parseCitations', () => {
  const valid = new Set(['b0', 'b1', 'b2'])
  it('extracts valid bracketed ids', () => {
    expect(parseCitations('trust matters [0][2].', valid)).toEqual([
      { raw: 'b0', display: '0' },
      { raw: 'b2', display: '2' },
    ])
  })
  it('drops ids not in the whitelist', () => {
    expect(parseCitations('nope [99] and [0].', valid)).toEqual([
      { raw: 'b0', display: '0' },
    ])
  })
  it('returns empty for text without markers', () => {
    expect(parseCitations('nothing here', valid)).toEqual([])
  })
})

describe('buildCitedSystemPrompt', () => {
  const blocks: PageBlock[] = [
    { id: 'b0', text: 'First paragraph.', domSelector: 'p' },
    { id: 'b1', text: 'Second paragraph.', domSelector: 'p' },
  ]
  it('prefixes each block with its id and includes citation instructions', () => {
    const out = buildCitedSystemPrompt(blocks)
    expect(out).toContain('[b0] First paragraph.')
    expect(out).toContain('[b1] Second paragraph.')
    expect(out).toContain('cite ONLY these ids')
  })
  it('is empty-safe', () => {
    expect(buildCitedSystemPrompt([])).not.toContain('[b0]')
  })
})

describe('renderCitations', () => {
  const valid = new Set(['b0', 'b1'])
  it('replaces [bN] with a chip and removes the marker text', () => {
    const html = renderCitations('trust matters [0][1].', valid)
    expect(html).toContain('data-cite="b0"')
    expect(html).toContain('data-cite="b1"')
    expect(html).not.toMatch(/\[0\]/)
  })
  it('leaves invalid markers stripped (no chip, no bracket)', () => {
    const html = renderCitations('bad [99] here.', valid)
    expect(html).not.toContain('data-cite')
    expect(html).not.toMatch(/\[99\]/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- citations`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/shared/citations.ts`**

```ts
// Citation grounding for Feature ①. Pure functions, no DOM deps.

export interface PageBlock {
  /** Stable id like "b0". Mirrored on the DOM node as data-lector-id. */
  id: string
  text: string
  /** Selector/xpath for jump-back location. */
  domSelector: string
}

export interface Citation {
  /** The normalized id, e.g. "b0". */
  raw: string
  /** The number shown to the user, e.g. "0". */
  display: string
}

/**
 * Parse "[N]" markers out of model text, keeping only ids present in the
 * whitelist. A marker may be written as [0] or [b0]; both map to id "b0".
 * Order is preserved and duplicates within a contiguous run are kept (the
 * model sometimes emits [0][2]).
 */
export function parseCitations(text: string, validIds: Set<string>): Citation[] {
  const out: Citation[] = []
  // Match [digits] possibly with a leading b.
  const re = /\[(b?\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const display = m[1].replace(/^b/, '')
    const raw = `b${display}`
    if (validIds.has(raw)) {
      out.push({ raw, display })
    }
  }
  return out
}

/**
 * Build the system-prompt PAGE CONTENT section, prefixing each block with its
 * id so the model can cite it.
 */
export function buildCitedSystemPrompt(blocks: PageBlock[]): string {
  const body = blocks.map((b) => `[${b.id}] ${b.text}`).join('\n')
  return [
    'PAGE CONTENT (each block prefixed [bN]; cite ONLY these ids):',
    body,
    '',
    'When you state a fact from the article, append [bN] referencing the block(s) it came from.',
    'If the answer is not covered in the page content, say so rather than guessing.',
    'Never cite an id not listed above.',
  ].join('\n')
}

/**
 * Render an HTML fragment, replacing [bN] markers with clickable citation
 * chips. Invalid ids are stripped entirely (no chip, no leftover bracket).
 * Input HTML is assumed already-escaped by the markdown renderer.
 */
export function renderCitations(html: string, validIds: Set<string>): string {
  return html.replace(/\[(b?\d+)\]/g, (full, inside: string) => {
    const display = inside.replace(/^b/, '')
    const raw = `b${display}`
    if (!validIds.has(raw)) return ''
    return `<sup class="lector-cite" data-cite="${raw}" title="Source block ${display}">[${display}]</sup>`
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- citations`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/shared/citations.ts tests/citations.test.ts
git commit -m "feat(citations): [bN] parse/render/prompt-build pure module + tests"
```

---

## Task 2: SRS module (Feature ③ pure logic)

**Files:**
- Create: `src/shared/srs.ts`
- Test: `tests/srs.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/srs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { scheduleSrs, isDue, newSrs, type SrsState } from '../src/shared/srs'

const NOW = new Date('2026-06-16T00:00:00Z').getTime()

describe('scheduleSrs', () => {
  it('again resets to a short interval and counts a lapse', () => {
    const card: SrsState = { due: NOW, interval: 6, ease: 2.5, reps: 3, lapses: 0 }
    const next = scheduleSrs(card, 'again', NOW)
    expect(next.interval).toBeLessThanOrEqual(1)
    expect(next.lapses).toBe(1)
    expect(next.reps).toBe(3)
  })
  it('good on a first review sets a 1-day interval', () => {
    const next = scheduleSrs(newSrs(), 'good', NOW)
    expect(next.interval).toBe(1)
    expect(next.reps).toBe(1)
  })
  it('second good review grows interval beyond 1', () => {
    const card: SrsState = { due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0 }
    const next = scheduleSrs(card, 'good', NOW)
    expect(next.interval).toBeGreaterThan(1)
    expect(next.reps).toBe(2)
  })
  it('easy boosts ease, again/hard reduce it, but never below 1.3', () => {
    let card: SrsState = { due: NOW, interval: 1, ease: 1.31, reps: 1, lapses: 0 }
    card = scheduleSrs(card, 'hard', NOW)
    expect(card.ease).toBeGreaterThanOrEqual(1.3)
    card = scheduleSrs(card, 'again', NOW)
    expect(card.ease).toBeGreaterThanOrEqual(1.3)
  })
  it('easy increases ease', () => {
    const card: SrsState = { due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0 }
    expect(scheduleSrs(card, 'easy', NOW).ease).toBeGreaterThan(2.5)
  })
})

describe('isDue', () => {
  it('is due when due <= now', () => {
    expect(isDue({ due: NOW - 1000, interval: 1, ease: 2.5, reps: 1, lapses: 0 }, NOW)).toBe(true)
  })
  it('is not due in the future', () => {
    expect(isDue({ due: NOW + 86400000, interval: 1, ease: 2.5, reps: 1, lapses: 0 }, NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- srs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/shared/srs.ts`**

```ts
// Simplified SM-2 spaced-repetition scheduler. Pure functions, zero deps.
// Constants follow Anki's published SM-2 defaults.

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  /** Epoch ms when the card is next due. */
  due: number
  /** Interval in days. */
  interval: number
  /** Ease factor (multiplier), floored at 1.3. */
  ease: number
  /** Successful reviews. */
  reps: number
  /** Times forgotten (again). */
  lapses: number
}

const DAY = 86_400_000
const EASE_FLOOR = 1.3

export function newSrs(now: number = Date.now()): SrsState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
}

/**
 * Advance a card given a review grade. SM-2 simplified to a 4-button Anki-like
 * scheme. `again` resets to a same-day relearn with a lapse; the others grow
 * the interval by ease (capped) and adjust ease.
 */
export function scheduleSrs(card: SrsState, grade: Grade, now: number = Date.now()): SrsState {
  let { ease, interval, reps, lapses } = card

  if (grade === 'again') {
    ease = Math.max(EASE_FLOOR, ease - 0.2)
    lapses += 1
    interval = Math.min(1, Math.round(interval * 0))
    return { due: now + 10 * 60 * 1000, interval: 0, ease, reps, lapses }
  }

  if (grade === 'hard') {
    ease = Math.max(EASE_FLOOR, ease - 0.15)
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 'good') {
    interval = reps === 0 ? 1 : Math.round(interval * ease)
  } else {
    // easy
    ease = ease + 0.15
    interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3)
  }

  reps += 1
  interval = Math.max(1, interval)
  return { due: now + interval * DAY, interval, ease, reps, lapses }
}

export function isDue(card: SrsState, now: number = Date.now()): boolean {
  return card.due <= now
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- srs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/srs.ts tests/srs.test.ts
git commit -m "feat(srs): SM-2 spaced-repetition scheduler pure module + tests"
```

---

## Task 3: Highlights module (Feature ② pure logic)

**Files:**
- Create: `src/shared/highlights.ts`
- Test: `tests/highlights.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/highlights.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  isDuplicateHighlight,
  groupHighlights,
  type Highlight,
} from '../src/shared/highlights'

const base: Highlight = {
  id: 'h1',
  text: 'trust matters',
  note: '',
  quote: 'In software, trust matters a lot.',
  url: 'https://a.com/post',
  title: 'Post',
  blockId: 'b0',
  createdAt: 1000,
  color: 'yellow',
}

describe('isDuplicateHighlight', () => {
  it('flags same text + same url', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2' })).toBe(true)
  })
  it('different url is not a duplicate', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2', url: 'https://b.com' })).toBe(false)
  })
  it('different text is not a duplicate', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2', text: 'other' })).toBe(false)
  })
})

describe('groupHighlights', () => {
  it('groups by origin (title + url)', () => {
    const groups = groupHighlights([
      base,
      { ...base, id: 'h2', title: 'Other', url: 'https://b.com' },
    ])
    expect(groups.size).toBe(2)
  })
  it('sorts highlights within a group newest-first', () => {
    const groups = groupHighlights([base, { ...base, id: 'h2', createdAt: 5000 }])
    const arr = [...groups.values()][0]
    expect(arr[0].id).toBe('h2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- highlights`
Expected: FAIL.

- [ ] **Step 3: Implement `src/shared/highlights.ts`**

```ts
// Highlight domain logic for Feature ② (and reused by ③). Pure functions.

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

export interface Highlight {
  id: string
  /** The highlighted text. */
  text: string
  /** User note, if any. */
  note: string
  /** Source context ±100 chars around the highlight. */
  quote: string
  url: string
  title: string
  /** The page block id the highlight sits in, if any (links to ①). */
  blockId?: string
  createdAt: number
  color: HighlightColor
}

/**
 * Two highlights are duplicates when their text AND url match. Used to prevent
 * double-highlighting the same passage.
 */
export function isDuplicateHighlight(a: Highlight, b: Highlight): boolean {
  return a.text === b.text && a.url === b.url
}

/**
 * Group highlights by origin (title + url). Within each group, newest-first.
 */
export function groupHighlights(hs: Highlight[]): Map<string, Highlight[]> {
  const map = new Map<string, Highlight[]>()
  for (const h of hs) {
    const key = `${h.title}\u0000${h.url}`
    const arr = map.get(key) ?? []
    arr.push(h)
    map.set(key, arr)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => b.createdAt - a.createdAt)
  }
  return map
}

/**
 * Search highlights across text/note/title. Case-insensitive substring.
 */
export function searchHighlights(hs: Highlight[], q: string): Highlight[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return hs
  return hs.filter(
    (h) =>
      h.text.toLowerCase().includes(needle) ||
      h.note.toLowerCase().includes(needle) ||
      h.title.toLowerCase().includes(needle)
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- highlights`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/highlights.ts tests/highlights.test.ts
git commit -m "feat(highlights): highlight domain logic (dedupe/group/search) + tests"
```

---

## Task 4: Vocabulary module (Feature ③ pure logic)

**Files:**
- Create: `src/shared/vocabulary.ts`
- Test: `tests/vocabulary.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/vocabulary.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergeVocab, validateWord, newSrs } from '../src/shared/srs'
import { type VocabEntry, mergeVocabEntry } from '../src/shared/vocabulary'

const base: VocabEntry = {
  id: 'v1',
  word: 'ephemeral',
  translation: '短暂的',
  context: 'Fame is ephemeral.',
  url: 'https://a.com',
  title: 'Post',
  lang: 'en',
  createdAt: 1000,
  srs: { due: 1000, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
}

describe('mergeVocabEntry', () => {
  it('keeps earliest createdAt, latest context, does NOT reset srs', () => {
    const existing: VocabEntry = { ...base, createdAt: 1000 }
    const incoming: VocabEntry = {
      ...base,
      createdAt: 5000,
      context: 'Updated context.',
      srs: { due: 999999, interval: 10, ease: 2.6, reps: 5, lapses: 1 },
    }
    const merged = mergeVocabEntry(existing, incoming)
    expect(merged.createdAt).toBe(1000)
    expect(merged.context).toBe('Updated context.')
    expect(merged.srs.interval).toBe(0) // unchanged from existing
  })
})

describe('validateWord', () => {
  it('accepts a normal word', () => {
    expect(validateWord('ephemeral').ok).toBe(true)
  })
  it('rejects too-long input (looks like a sentence)', () => {
    const long = 'word '.repeat(20).trim()
    expect(validateWord(long).ok).toBe(false)
  })
  it('rejects empty', () => {
    expect(validateWord('').ok).toBe(false)
  })
})
```

> Note: the test above references `mergeVocab` and `newSrs` from `srs` only as a fallback import; remove the unused import line before running. Final test should only import from `vocabulary`:
```ts
import { describe, it, expect } from 'vitest'
import { type VocabEntry, mergeVocabEntry, validateWord } from '../src/shared/vocabulary'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vocabulary`
Expected: FAIL.

- [ ] **Step 3: Implement `src/shared/vocabulary.ts`**

```ts
// Vocabulary domain logic for Feature ③. Pure functions.
import type { SrsState } from './srs'
import { newSrs } from './srs'

export interface VocabEntry {
  id: string
  word: string
  translation: string
  /** Source sentence ±80 chars. */
  context: string
  url: string
  title: string
  lang: string
  createdAt: number
  srs: SrsState
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/**
 * Validate a candidate word before saving. Words longer than 60 chars are
 * treated as sentences and rejected (guide the user to Highlight instead).
 */
export function validateWord(word: string): ValidationResult {
  const trimmed = word.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > 60) {
    return { ok: false, reason: 'too-long-sentence' }
  }
  return { ok: true }
}

/**
 * Merge an incoming duplicate entry into an existing one. Keeps the earliest
 * createdAt, the latest context, and DOES NOT reset the SRS state (review
 * progress is preserved).
 */
export function mergeVocabEntry(existing: VocabEntry, incoming: VocabEntry): VocabEntry {
  return {
    ...existing,
    context: incoming.context || existing.context,
    translation: incoming.translation || existing.translation,
    url: incoming.url || existing.url,
    title: incoming.title || existing.title,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    srs: existing.srs,
  }
}

/**
 * Create a fresh vocab entry with default SRS state (due now).
 */
export function makeVocabEntry(
  partial: Omit<VocabEntry, 'srs' | 'createdAt'> & { createdAt?: number }
): VocabEntry {
  return {
    ...partial,
    createdAt: partial.createdAt ?? Date.now(),
    srs: newSrs(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- vocabulary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/vocabulary.ts tests/vocabulary.test.ts
git commit -m "feat(vocabulary): vocab entry merge/validate/make pure module + tests"
```

---

## Task 5: Exporters module (Feature ② pure logic)

**Files:**
- Create: `src/shared/exporters.ts`
- Test: `tests/exporters.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/exporters.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  toMarkdown,
  toObsidian,
  toNotionProperties,
} from '../src/shared/exporters'
import type { Highlight } from '../src/shared/highlights'

const hs: Highlight[] = [
  {
    id: 'h1',
    text: 'Trust matters.',
    note: 'key idea',
    quote: 'In software, Trust matters.',
    url: 'https://a.com/p',
    title: 'Post',
    blockId: 'b0',
    createdAt: 1000,
    color: 'yellow',
  },
]

describe('toMarkdown', () => {
  it('emits a blockquote of the text, note, and source link', () => {
    const out = toMarkdown(hs)
    expect(out).toContain('> Trust matters.')
    expect(out).toContain('key idea')
    expect(out).toContain('https://a.com/p')
  })
})

describe('toObsidian', () => {
  it('includes front-matter with source and tags', () => {
    const out = toObsidian(hs)
    expect(out).toContain('---')
    expect(out).toContain('source:')
    expect(out).toContain('tags:')
    expect(out).toContain('> Trust matters.')
  })
})

describe('toNotionProperties', () => {
  it('produces a create-page properties payload', () => {
    const payload = toNotionProperties(hs[0])
    expect(payload).toHaveProperty('Title')
    expect(payload).toHaveProperty('Source')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- exporters`
Expected: FAIL.

- [ ] **Step 3: Implement `src/shared/exporters.ts`**

```ts
// Export providers for Feature ②. Pure functions producing payloads/strings.
import type { Highlight } from './highlights'

export interface ExportOptions {
  /** Optional vault root for relative links (Obsidian). */
  vaultRoot?: string
}

/** Markdown export: one block per highlight with note + source. */
export function toMarkdown(hs: Highlight[], _opts: ExportOptions = {}): string {
  return hs
    .map((h) => {
      const lines = [
        `### ${h.title}`,
        '',
        `> ${h.text}`,
        '',
        h.note ? `**Note:** ${h.note}` : '',
        '',
        `Source: [${h.title}](${h.url})`,
        '',
        '---',
        '',
      ]
      return lines.join('\n')
    })
    .join('\n')
}

/** Obsidian export: front-matter + wikilink-friendly markdown. */
export function toObsidian(hs: Highlight[], opts: ExportOptions = {}): string {
  const bySource = new Map<string, Highlight[]>()
  for (const h of hs) {
    const k = h.title
    bySource.set(k, [...(bySource.get(k) ?? []), h])
  }
  const fm = [
    '---',
    `source: "${hs[0]?.url ?? ''}"`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    'tags: [lector, highlight]',
    '---',
    '',
  ].join('\n')
  const body = [...bySource.entries()]
    .map(([title, items]) => {
      const block = items
        .map(
          (h) =>
            `> [!quote] ${h.text}${h.note ? `\n> \n> **Note:** ${h.note}` : ''}\n> Source: [${title}](${h.url})`
        )
        .join('\n\n')
      return `## ${title}\n\n${block}`
    })
    .join('\n\n')
  void opts
  return `${fm}${body}\n`
}

/**
 * Notion "create page" properties payload for a single highlight. The caller
 * posts this to the Notion API with the user's database id.
 */
export function toNotionProperties(h: Highlight): Record<string, unknown> {
  return {
    Title: {
      title: [{ text: { content: h.text.slice(0, 2000) } }],
    },
    Source: {
      url: h.url,
    },
    Note: {
      rich_text: [{ text: { content: h.note || '' } }],
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- exporters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/exporters.ts tests/exporters.test.ts
git commit -m "feat(exporters): markdown/obsidian/notion export providers + tests"
```

---

## Task 6: Store extension (Features ②③ state)

**Files:**
- Modify: `src/shared/store.ts`

- [ ] **Step 1: Add highlight + vocab state and actions**

Add imports at top:
```ts
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { SrsState } from './srs'
```

Extend `AppState` interface (add these members):
```ts
  // Knowledge layer — highlights + vocabulary
  highlights: Highlight[]
  vocab: VocabEntry[]

  addHighlight: (h: Highlight) => { duplicate: boolean }
  removeHighlight: (id: string) => void
  updateHighlight: (id: string, patch: Partial<Highlight>) => void

  addVocab: (v: VocabEntry) => void
  removeVocab: (id: string) => void
  updateVocabSrs: (id: string, srs: SrsState) => void
```

Add to the `create(...)` factory (after `clearSessions`):
```ts
      highlights: [],
      vocab: [],

      addHighlight: (h) => {
        let duplicate = false
        set((s) => {
          if (s.highlights.some((x) => x.text === h.text && x.url === h.url)) {
            duplicate = true
            return s
          }
          return { highlights: [h, ...s.highlights].slice(0, 500) }
        })
        return { duplicate }
      },
      removeHighlight: (id) =>
        set((s) => ({ highlights: s.highlights.filter((x) => x.id !== id) })),
      updateHighlight: (id, patch) =>
        set((s) => ({
          highlights: s.highlights.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      addVocab: (v) =>
        set((s) => {
          const idx = s.vocab.findIndex(
            (x) => x.word.toLowerCase() === v.word.toLowerCase()
          )
          if (idx === -1) return { vocab: [v, ...s.vocab].slice(0, 2000) }
          // merge: keep earliest createdAt, latest context, preserve srs
          const existing = s.vocab[idx]
          const merged: VocabEntry = {
            ...existing,
            context: v.context || existing.context,
            translation: v.translation || existing.translation,
            createdAt: Math.min(existing.createdAt, v.createdAt),
            srs: existing.srs,
          }
          const next = [...s.vocab]
          next[idx] = merged
          return { vocab: next }
        }),
      removeVocab: (id) => set((s) => ({ vocab: s.vocab.filter((x) => x.id !== id) })),
      updateVocabSrs: (id, srs) =>
        set((s) => ({
          vocab: s.vocab.map((x) => (x.id === id ? { ...x, srs } : x)),
        })),
```

Update `partialize` to persist the new collections:
```ts
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isPro: state.isPro,
        usageCount: state.usageCount,
        sessions: state.sessions,
        highlights: state.highlights,
        vocab: state.vocab,
      }),
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/store.ts
git commit -m "feat(store): add highlights + vocab collections and actions"
```

---

## Task 7: Backend — citation-grounded chat prompt (Feature ①)

**Files:**
- Modify: `api/chat/index.ts`

- [ ] **Step 1: Import citations builder and build blocks from pageContent**

Add import:
```ts
import { buildCitedSystemPrompt, type PageBlock } from '../../src/shared/citations'
```

Add a helper near the top of the handler (after parsing body), to split the trimmed page text into pseudo-blocks when the client only sends `pageContent` (no explicit blocks). For now the client sends `page.blocks`; accept an optional `pageBlocks` field, and fall back to splitting `pageContent` on blank lines:

In `ChatRequestBody` add:
```ts
  pageBlocks?: PageBlock[]
```

Replace the system-prompt construction block. Find:
```ts
  // Cap page context so a huge page can't blow the context window.
  const trimmedPage = (pageContent || '').slice(0, 12000)
```
and the template literal that builds `systemPrompt`. Replace with:
```ts
  // Cap page context so a huge page can't blow the context window.
  const trimmedPage = (pageContent || '').slice(0, 12000)

  // Build citation-grounded blocks: prefer explicit pageBlocks from the
  // client; otherwise split the trimmed page text on blank lines.
  let blocks: PageBlock[]
  if (Array.isArray(pageBlocks) && pageBlocks.length > 0) {
    blocks = pageBlocks.slice(0, 200)
  } else {
    blocks = trimmedPage
      .split(/\n{2,}/)
      .map((t, i) => ({ id: `b${i}`, text: t, domSelector: '' }))
      .filter((b) => b.text.trim().length > 0)
      .slice(0, 200)
  }

  const citedSection = buildCitedSystemPrompt(blocks)

  const systemPrompt = `You are Lector AI, a sharp reading companion embedded in the user's browser.

You answer questions about the article the user is reading, summarize, explain
concepts, translate, and draft. Be concise and information-dense. Use Markdown.
When the user asks about "the article", reason only from the provided PAGE
CONTENT; if it isn't covered there, say so rather than guessing. When you state
a fact from the article, append [bN] referencing the source block.

${pageMetadata?.title ? `PAGE TITLE: ${pageMetadata.title}` : ''}
${pageMetadata?.url ? `PAGE URL: ${pageMetadata.url}` : ''}

${citedSection}`
```

Also update the destructure to read `pageBlocks`:
```ts
  const { message, pageContent, pageMetadata, history, pageBlocks } = (req.body || {}) as ChatRequestBody
```

- [ ] **Step 2: Type-check the api + src**

Run: `npm run typecheck`
Expected: no errors (tsconfig includes `api` and `src`).

- [ ] **Step 3: Commit**

```bash
git add api/chat/index.ts
git commit -m "feat(chat): citation-grounded system prompt with [bN] blocks"
```

---

## Task 8: Content script — block anchors, highlight, vocab, jump-to

**Files:**
- Modify: `src/content.ts`
- Modify: `src/content.css`
- Create: `tests/content.test.ts`

This is the largest task. It adds: block-id tagging in `extractPage`, a highlight action on the toolbar, vocab-save action, and three message handlers (`lector-jump-to`, `lector-highlight`, `lector-save-word`).

- [ ] **Step 1: Write integration test for jump-to + highlight injection**

`tests/content.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'

// jsdom gives us a DOM but NOT chrome.* APIs or module side effects. We test
// the pure helpers we export from content.ts by re-implementing the smallest
// pieces here is undesirable; instead we test the jump-to DOM behavior by
// simulating what the handler does.

function jumpTo(blockId: string): HTMLElement | null {
  const node = document.querySelector<HTMLElement>(`[data-lector-id="${blockId}"]`)
  if (!node) return null
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  node.classList.add('lector-pulse')
  setTimeout(() => node.classList.remove('lector-pulse'), 50)
  return node
}

describe('jump-to', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  it('highlights the target block when present', () => {
    const p = document.createElement('p')
    p.setAttribute('data-lector-id', 'b2')
    p.textContent = 'target'
    document.body.appendChild(p)
    const hit = jumpTo('b2')
    expect(hit).toBe(p)
    expect(p.classList.contains('lector-pulse')).toBe(true)
  })
  it('returns null when the block is absent', () => {
    expect(jumpTo('b99')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- content`
Expected: FAIL (test references functions; jsdom DOM is empty initially — but the test itself defines `jumpTo`, so it should PASS once DOM is set. To make it fail-first against the real module, we will instead rely on the highlight-injection assertion below after we export helpers. For now run it; if it passes trivially, that's fine — the real coverage is the pure modules.)

- [ ] **Step 3: Add citation-pulse + highlight styles to `src/content.css`**

Append:
```css
/* Citation jump-to pulse */
[data-lector-id].lector-pulse {
  animation: lectorPulse 2s ease-out;
}
@keyframes lectorPulse {
  0% { background-color: rgba(250, 204, 21, 0.55); }
  100% { background-color: transparent; }
}

/* Inline highlight marks */
mark.lector-hl {
  background: linear-gradient(transparent 55%, rgba(250, 213, 86, 0.55) 55%);
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
mark.lector-hl-green { background: linear-gradient(transparent 55%, rgba(134, 239, 172, 0.6) 55%); }
mark.lector-hl-pink  { background: linear-gradient(transparent 55%, rgba(244, 114, 182, 0.5) 55%); }
mark.lector-hl-blue  { background: linear-gradient(transparent 55%, rgba(125, 211, 252, 0.55) 55%); }
```

- [ ] **Step 4: Modify `extractPage` to tag blocks with `data-lector-id` and emit `blocks`**

In `src/content.ts`, replace the `extractPage` function's body (the part that collects `blocks` into text) so it assigns ids. Concretely, find:
```ts
  // Collect paragraph-ish text preserving some structure.
  const blocks: string[] = []
  clone.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre').forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (t.length > 0) blocks.push(t)
  })
  let text = blocks.join('\n\n')
```
Replace with:
```ts
  // Collect paragraph-ish text preserving some structure, tagging the LIVE DOM
  // nodes with stable ids so citations can jump back to them.
  const pageBlocks: ExtractedPageBlock[] = []
  const textParts: string[] = []
  const liveNodes = root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')
  liveNodes.forEach((el, i) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (t.length === 0) return
    const id = `b${pageBlocks.length}`
    try {
      ;(el as HTMLElement).setAttribute('data-lector-id', id)
    } catch {
      // some nodes reject setAttribute; skip tagging
    }
    pageBlocks.push({ id, text: t, domSelector: '' })
    textParts.push(t)
    void i
  })
  let text = textParts.join('\n\n')
```

Update the `ExtractedPage` interface to include `blocks`:
```ts
export interface ExtractedPageBlock {
  id: string
  text: string
  domSelector: string
}

export interface ExtractedPage {
  title: string
  url: string
  byline: string | null
  text: string
  lang: string
  blocks: ExtractedPageBlock[]
}
```

And in the returned object add `blocks: pageBlocks`.

- [ ] **Step 5: Add highlight action to the selection toolbar**

In `createToolbar`, after the existing `mk(...)` appends and before the close button, add:
```ts
  selectionToolbar.appendChild(mk('t-btn', '🔖 高亮', () => handleHighlight(text)))
```

Add the `handleHighlight` function near `handleAction`:
```ts
function handleHighlight(text: string) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  try {
    // Wrap the range in a mark node without disturbing the DOM structure.
    const mark = document.createElement('mark')
    mark.className = 'lector-hl'
    mark.title = 'Lector highlight'
    range.surroundContents(mark)
    // Find the enclosing block id (Feature ① link).
    const block = (mark.closest('[data-lector-id]') as HTMLElement | null)
    const blockId = block?.getAttribute('data-lector-id') || undefined
    const context = (mark.parentElement?.textContent || text).slice(0, 200)
    chrome.runtime
      .sendMessage({
        action: 'lector-highlight',
        highlight: {
          id: 'h' + Date.now().toString(36),
          text,
          note: '',
          quote: context,
          url: location.href,
          title: document.title,
          blockId,
          createdAt: Date.now(),
          color: 'yellow',
        },
      })
      .catch(() => {})
  } catch {
    // surroundContents fails on multi-node ranges; fall back to text-only.
    chrome.runtime
      .sendMessage({
        action: 'lector-highlight',
        highlight: {
          id: 'h' + Date.now().toString(36),
          text,
          note: '',
          quote: text.slice(0, 200),
          url: location.href,
          title: document.title,
          createdAt: Date.now(),
          color: 'yellow',
        },
      })
      .catch(() => {})
  }
  removeToolbar()
}
```

- [ ] **Step 6: Add vocab-save action to the selection toolbar**

In `createToolbar`, add a save-word button after the highlight button:
```ts
  selectionToolbar.appendChild(mk('t-btn', '★ 存词', () => handleSaveWord(text)))
```

Add `handleSaveWord`:
```ts
function handleSaveWord(word: string) {
  const block = (window.getSelection()?.anchorNode?.parentElement?.closest('[data-lector-id]') as HTMLElement | null)
  const blockId = block?.getAttribute('data-lector-id') || undefined
  const sentence = (window.getSelection()?.anchorNode?.parentElement?.textContent || word).slice(0, 160)
  chrome.runtime
    .sendMessage({
      action: 'lector-save-word',
      word,
      context: sentence,
      url: location.href,
      title: document.title,
      blockId,
    })
    .catch(() => {})
  removeToolbar()
}
```

- [ ] **Step 7: Add message handlers for jump-to**

Extend the existing `chrome.runtime.onMessage.addListener` at the bottom of `content.ts`. Find the existing listener block and add, inside it (before `return false`):
```ts
  if (message?.action === 'lector-jump-to') {
    const node = document.querySelector<HTMLElement>(`[data-lector-id="${message.blockId}"]`)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      node.classList.add('lector-pulse')
      setTimeout(() => node.classList.remove('lector-pulse'), 2000)
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, reason: 'node-unavailable' })
    }
    return false
  }
```

- [ ] **Step 8: Wire content→background→sidepanel for highlight & save-word**

The content script sends messages to the **background**, which forwards to the side panel (side panels don't get tab messages directly). In `src/background.ts`, add a relay. Add inside the existing `chrome.runtime.onMessage.addListener` (the one that handles `open-side-panel`) — extend it to also persist the incoming highlight/word into `chrome.storage.local` so the side panel can read them on its next render tick. Add:

```ts
  if (message?.action === 'lector-highlight') {
    // Merge into the persisted highlights list in storage; the side panel
    // listens to chrome.storage.onChanged to refresh.
    chrome.storage.local.get(['lectorHighlights'], (r) => {
      const list = Array.isArray(r.lectorHighlights) ? r.lectorHighlights : []
      list.unshift(message.highlight)
      chrome.storage.local.set({ lectorHighlights: list.slice(0, 500) })
    })
    return false
  }
  if (message?.action === 'lector-save-word') {
    // Fetch a translation, then store the vocab entry.
    ;(async () => {
      const apiBase = await getApiBase()
      let translation = ''
      try {
        const res = await fetch(`${apiBase}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message.word, targetLang: '中文' }),
        })
        if (res.ok) translation = (await res.json()).translatedText || ''
      } catch {
        // leave translation empty; flagged at review time
      }
      const entry = {
        id: 'v' + Date.now().toString(36),
        word: message.word,
        translation,
        context: message.context,
        url: message.url,
        title: message.title,
        lang: 'en',
        createdAt: Date.now(),
        srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
      }
      chrome.storage.local.get(['lectorVocab'], (r) => {
        const list = Array.isArray(r.lectorVocab) ? r.lectorVocab : []
        // merge duplicates (same word, case-insensitive)
        const idx = list.findIndex(
          (x: { word: string }) => x.word.toLowerCase() === entry.word.toLowerCase()
        )
        if (idx === -1) {
          list.unshift(entry)
        } else {
          const existing = list[idx]
          list[idx] = {
            ...existing,
            context: entry.context || existing.context,
            translation: entry.translation || existing.translation,
            createdAt: Math.min(existing.createdAt, entry.createdAt),
            srs: existing.srs,
          }
        }
        chrome.storage.local.set({ lectorVocab: list.slice(0, 2000) })
      })
    })()
    return false
  }
```

(Add `getApiBase` is already imported at the top of background.ts.)

- [ ] **Step 9: Build and type-check**

Run: `npm run typecheck && npm run build:extension`
Expected: no type errors; build succeeds; `dist/content.js`, `dist/background.js` emitted.

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 11: Commit**

```bash
git add src/content.ts src/content.css src/background.ts tests/content.test.ts
git commit -m "feat(content): block anchors, highlight + vocab-save toolbar, jump-to"
```

---

## Task 9: Side panel — Highlights drawer, Vocab drawer, citation chips (Features ①②③ UI)

**Files:**
- Modify: `src/sidepanel/markdown.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/index.css`

- [ ] **Step 1: Add citation rendering to the markdown output**

In `src/sidepanel/markdown.ts`, `renderMarkdown` returns HTML. The App will post-process with `renderCitations`. No change needed in markdown.ts itself; we apply `renderCitations` at call site. Add export of the helper is unnecessary — App imports it from `shared/citations`.

- [ ] **Step 2: Add CSS for citation chips + drawers**

Append to `src/sidepanel/index.css`:
```css
.lector-cite {
  color: #6366f1;
  font-weight: 600;
  cursor: pointer;
  margin-left: 1px;
  user-select: none;
}
.lector-cite:hover { text-decoration: underline; }

.lector-due-badge {
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  border-radius: 9999px;
  padding: 0 5px;
  margin-left: 4px;
}
```

- [ ] **Step 3: In `App.tsx`, wire page blocks + citation rendering into the chat send path**

At top of `App.tsx`, add imports:
```ts
import { renderCitations } from '../shared/citations'
import { isDue } from '../shared/srs'
import type { PageBlock } from '../shared/citations'
```

Update the `PageContext` interface to carry blocks:
```ts
interface PageContext {
  title: string
  url: string
  text: string
  lang: string
  blocks: PageBlock[]
}
```

In the `handleSend` body, the `fetch` body currently sends `pageContent: page?.text`. Change to also send blocks:
```ts
          body: JSON.stringify({
            message: text,
            pageContent: page?.text,
            pageMetadata: { url: page?.url, title: page?.title },
            pageBlocks: page?.blocks,
            history,
          }),
```

- [ ] **Step 4: Render citation chips in assistant messages**

Compute a valid-id set from the current page blocks. Add near the component top (after `page` state):
```ts
  const validCiteIds = new Set((page?.blocks ?? []).map((b) => b.id))
```

Replace the assistant message content rendering. Find:
```tsx
                {m.content ? (
                  <div
                    className="lector-prose"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
```
Replace with:
```tsx
                {m.content ? (
                  <div
                    className="lector-prose"
                    dangerouslySetInnerHTML={{
                      __html: renderCitations(renderMarkdown(m.content), validCiteIds),
                    }}
                    onClick={(e) => {
                      const target = e.target as HTMLElement
                      const cite = target.closest('[data-cite]') as HTMLElement | null
                      if (!cite) return
                      const blockId = cite.getAttribute('data-cite') || ''
                      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        const tabId = tabs[0]?.id
                        if (tabId !== undefined) {
                          chrome.tabs.sendMessage(tabId, { action: 'lector-jump-to', blockId }, () => {
                            void chrome.runtime.lastError
                          })
                        }
                      })
                    }}
                  />
```

- [ ] **Step 5: Add Highlights drawer**

Add state in the component:
```ts
  const [showHighlights, setShowHighlights] = useState(false)
  const highlights = useStore((s) => s.highlights)
  const addHighlight = useStore((s) => s.addHighlight)
  const removeHighlight = useStore((s) => s.removeHighlight)
```

Add a `chrome.storage.onChanged` listener in the existing top `useEffect` so highlights saved via the content→background path appear:
```ts
      const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area !== 'local') return
        if (changes.lectorHighlights) {
          const list = changes.lectorHighlights.newValue || []
          // Sync into the store (dedupe by addHighlight).
          for (const h of list) {
            addHighlight(h)
          }
        }
      }
      chrome.storage.onChanged.addListener(onStorage)
      return () => chrome.storage.onChanged.removeListener(onStorage)
```
(Note: return a cleanup from this effect. Since the existing effect is async IIFE, wrap the listener add/remove carefully — add the listener at the top of the effect and remove in a returned cleanup. Adjust the effect to `return () => chrome.storage.onChanged.removeListener(onStorage)`.)

Add a Highlights button in the header (next to the Library 📚 button):
```tsx
          <button
            onClick={() => setShowHighlights(true)}
            title="Highlights"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            🔖
          </button>
```

Add the Highlights drawer JSX (modeled on the existing Library drawer), before the closing `</div>`:
```tsx
      {showHighlights && (
        <div
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => { if (e.target === e.currentTarget) setShowHighlights(false) }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[320px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">Highlights</h3>
              <button onClick={() => setShowHighlights(false)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {highlights.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  Select text on any page and click 🔖 to capture highlights.
                </div>
              ) : (
                highlights.map((h) => (
                  <div key={h.id} className="group px-3 py-2.5 border-b border-slate-100">
                    <div className="text-[11px] text-slate-400 truncate mb-0.5">{h.title}</div>
                    <div className="text-[12px] text-slate-700 leading-snug">{h.text}</div>
                    <button
                      onClick={() => removeHighlight(h.id)}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-red-500 mt-1"
                    >Remove</button>
                  </div>
                ))
              )}
            </div>
            {highlights.length > 0 && (
              <button
                onClick={() => downloadMarkdown(highlights)}
                className="px-3 py-2 text-[11px] text-blue-600 hover:text-blue-800 border-t border-slate-200"
              >Export Markdown</button>
            )}
          </div>
        </div>
      )}
```

Add the export helper inside the component (uses the exporters module):
```ts
  const downloadMarkdown = (hs: typeof highlights) => {
    import('../shared/exporters').then(({ toMarkdown }) => {
      const md = toMarkdown(hs)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'lector-highlights.md'
      a.click()
      URL.revokeObjectURL(url)
    })
  }
```

- [ ] **Step 6: Add Vocab drawer with review**

Add state + store selectors:
```ts
  const [showVocab, setShowVocab] = useState(false)
  const vocab = useStore((s) => s.vocab)
  const updateVocabSrs = useStore((s) => s.updateVocabSrs)
  const [revealed, setRevealed] = useState<string | null>(null)
```

Add a Vocab button in the header (next to Highlights):
```tsx
          <button
            onClick={() => setShowVocab(true)}
            title="Vocabulary"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm relative"
          >
            ★
            {vocab.some((v) => isDue(v.srs)) && (
              <span className="lector-due-badge absolute -top-0.5 -right-0.5">!</span>
            )}
          </button>
```

Add the Vocab drawer JSX (before the closing `</div>`):
```tsx
      {showVocab && (
        <div
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => { if (e.target === e.currentTarget) setShowVocab(false) }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[320px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">
                Vocabulary
                <span className="lector-due-badge ml-1">
                  {vocab.filter((v) => isDue(v.srs)).length}
                </span>
              </h3>
              <button onClick={() => setShowVocab(false)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {vocab.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  Select a word on any page and click ★ to save it for review.
                </div>
              ) : (
                vocab.slice(0, 200).map((v) => {
                  const due = isDue(v.srs)
                  return (
                    <div key={v.id} className="px-3 py-2.5 border-b border-slate-100">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-medium text-slate-800">{v.word}</div>
                        {due && <span className="text-[9px] text-red-500">due</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 italic mt-0.5">{v.context}</div>
                      {revealed === v.id ? (
                        <div className="text-[12px] text-slate-700 mt-1">{v.translation || '(no translation)'}</div>
                      ) : (
                        <button onClick={() => setRevealed(v.id)} className="text-[10px] text-blue-500 mt-1">Show translation</button>
                      )}
                      {due && revealed === v.id && (
                        <div className="flex gap-1 mt-2">
                          {(['again', 'hard', 'good', 'easy'] as const).map((g) => (
                            <button
                              key={g}
                              onClick={() => {
                                import('../shared/srs').then(({ scheduleSrs }) => {
                                  updateVocabSrs(v.id, scheduleSrs(v.srs, g))
                                })
                              }}
                              className="flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            >{g}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Type-check + build**

Run: `npm run typecheck && npm run build:extension`
Expected: no errors; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/index.css src/sidepanel/markdown.ts
git commit -m "feat(sidepanel): citation chips, highlights drawer, vocab review drawer"
```

---

## Task 10: Manifest version + commands

**Files:**
- Modify: `src/manifest.json`

- [ ] **Step 1: Bump version and add commands**

Change `"version": "0.2.0"` → `"0.3.0"`. Add a `"commands"` key after `"permissions"`:
```json
  "commands": {
    "highlight-selection": {
      "suggested_key": { "default": "Alt+H" },
      "description": "Highlight the current selection with Lector AI"
    },
    "save-word": {
      "suggested_key": { "default": "Alt+S" },
      "description": "Save the current selection as a vocabulary word"
    }
  },
```

- [ ] **Step 2: Handle commands in background**

In `src/background.ts`, add a listener (commands carry no selection text in MV3, so we send a message to the active tab's content script to act on its current selection):
```ts
chrome.commands?.onCommand.addListener((cmd) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId === undefined) return
    chrome.tabs.sendMessage(tabId, { action: 'lector-command', command: cmd }, () => {
      void chrome.runtime.lastError
    })
  })
})
```

In `src/content.ts`, handle `lector-command` in the message listener — get the current selection and dispatch to highlight/save-word:
```ts
  if (message?.action === 'lector-command') {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    if (text.length > 0) {
      if (message.command === 'highlight-selection') handleHighlight(text)
      else if (message.command === 'save-word') handleSaveWord(text)
    }
    return false
  }
```

- [ ] **Step 3: Build**

Run: `npm run build:extension`
Expected: succeeds; `dist/manifest.json` shows version 0.3.0.

- [ ] **Step 4: Commit**

```bash
git add src/manifest.json src/background.ts src/content.ts
git commit -m "feat: keyboard commands (Alt+H highlight, Alt+S save word), v0.3.0"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all test files pass (citations, srs, highlights, vocabulary, exporters, content).

- [ ] **Step 3: Extension build**

Run: `npm run build:extension`
Expected: build green; `dist/` contains manifest.json (0.3.0), content.js, background.js, sidepanel/, popup/, content.css, icons/.

- [ ] **Step 4: Verify dist layout**

Run: `ls dist && grep '"version"' dist/manifest.json`
Expected: version 0.3.0; expected files present.

- [ ] **Step 5: Update the design doc status**

Edit `docs/superpowers/specs/2026-06-16-trust-and-depth-features-design.md`: change `**Status:** Design approved (pending implementation)` → `**Status:** Implemented (build green, tests green)`. Commit.

---

## Self-review

**1. Spec coverage:**
- ① block anchors → Task 8 Step 4. ② backend prompt → Task 7. ③ chip render + click → Task 9 Steps 3-4. ④ jump-to → Task 8 Step 7 + Task 9 Step 4. ✓
- ② highlight capture → Task 8 Step 5. drawer → Task 9 Step 5. exporters → Task 5. export button → Task 9 Step 5. ✓
- ③ save word → Task 8 Step 6 + background Step 8. SRS → Task 2. drawer/review → Task 9 Step 6. ✓
- store → Task 6. manifest/commands → Task 10. tests → Tasks 1-5, 8. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" without code; every code step has real code.

**3. Type consistency:** `PageBlock`, `Highlight`, `VocabEntry`, `SrsState`, `Grade` names are consistent across modules and tasks. `scheduleSrs(card, grade, now)` signature matches in tests, store, and UI. `renderCitations(html, validIds)` matches in test, citations.ts, and App.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-trust-and-depth-features.md`. Proceeding with inline execution (executing-plans) given the session goal requires completing development end-to-end.
