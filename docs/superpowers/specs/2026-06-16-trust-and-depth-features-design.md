# Lector AI — Trust & Depth Features Design

**Date:** 2026-06-16
**Status:** Design approved (pending implementation)
**Manifest target version:** 0.3.0

## Context

Lector AI's 2026-06-15 "competitive upgrade" closed the launch gaps vs
Monica / Sider / Glasp / Immersive Translate (side panel, chat-with-page,
server-side rate limiting, bilingual translation, reading library, payments).

A competitive-landscape study of 8 products (Monica, Sider, Glasp, Wiseone,
Harpa, MaxAI, Immersive Translate, Perplexity/Comet) surfaced a striking,
convergent pattern of unmet needs that fall into two buckets:

1. **Trust crisis (the category's fatal wound).** Predatory credit-based
   billing (MaxAI 1.9★ on Trustpilot; Sider/Monica "credits vanish"
   complaints), privacy invasion (UC Davis 2025 study naming Monica/Sider
   recording browsing activity, even in incognito), and **ungrounded,
   hallucinated summaries** — users do not trust AI output. Only Harpa and
   Wiseone seriously ground answers in sources, and neither does so in the
   "read-along" use case.
2. **Reading depth (knowledge doesn't persist).** Glasp's export is buggy and
   manual; r/ObsidianMD users explicitly want a free Readwise-style sync.
   Immersive Translate explicitly lacks vocabulary learning / grammar analysis
   vs Trancy. Reading assistants are "broad but shallow" — you read, then
   forget.

**Strategic recommendation (accepted):** do NOT out-build Monica's agents or
Harpa's command breadth. Differentiate on **trust** and **reading depth**.
This spec defines three features that together tell one competitive story:

> *Lector is the reading assistant you can actually trust — grounded answers,
> and knowledge that stays with you.*

The three features share data and reinforce each other: ① grounded summaries
can be captured as ② highlights, whose source context feeds ③ vocabulary
review that jumps back to the original passage.

## The three features

| # | Feature | Attacks pain | Competitor weakness | Stack fit |
|---|---------|--------------|---------------------|-----------|
| 1 | **Citation-Grounded Reading** | Ungrounded, hallucinated summaries | Only Harpa/Wiseone cite; none in read-along | `extractPage()` already client-side |
| 2 | **Highlights → Notion / Obsidian / Markdown** | Glasp export buggy & manual | Glasp #1 complaint; Readwise paid | Local reading library exists |
| 3 | **Vocabulary Builder (SM-2)** | No vocab-learning loop in translators | Immersive Translate lacks it vs Trancy | Bilingual translation exists |

## Shared architecture

### Data model (lightweight, typed, independently testable)

```
src/shared/highlights.ts   ← used by ①②③ : Highlight = {id,text,note,quote,url,...}
src/shared/vocabulary.ts   ← used by ③    : VocabEntry = {id,word,translation,context,due,...}
src/shared/srs.ts          ← used by ③    : SM-2 scheduler (pure functions)
src/shared/exporters.ts    ← used by ②    : ExportProvider (pure functions)
src/shared/citations.ts    ← used by ①    : [bN] parse/render/prompt-build (pure functions)
src/shared/store.ts        ← extended: highlights[], vocab[], persisted
```

### Cross-cutting principles

- **Client-side first.** Page locating, highlight-range math, and SRS review
  scheduling all run in the content script / frontend. The server receives
  only the cleaned minimal text chunk (privacy differentiation).
- **Never break the page.** Highlight injection uses `Range` + text-node
  wrapping with a minimal `<mark>` node; it never replaces or overrides page
  DOM structure (lesson from Immersive Translate's "can only look, can't
  click" complaints).
- **Graceful degradation.** Each feature remains usable when external config
  is absent (Notion token, source page gone). No hard errors.
- **Independently testable.** Pure logic (citation mapping, SRS scheduling,
  highlight serialization, export formatting) is extracted into dependency-
  free pure functions with unit tests; DOM interaction is integration-tested.

---

## Feature ① — Citation-Grounded Reading

### Pain addressed
The category's #1 complaint is untrusted AI output. Monica/Sider/MaxAI emit
sourceless summaries that users cannot verify. Lector's existing client-side
`extractPage()` is a natural foundation for "answer ↔ source paragraph" maps.

### Mechanism

**1. Block-level anchor IDs (grounding foundation).**

`extractPage()` is changed from emitting flat text to emitting `text + blocks`,
where each collected block element gets a stable anchor:

```ts
interface PageBlock {
  id: string          // "b0","b1"… stable, mirrored on the DOM node as data-lector-id
  text: string
  domSelector: string // for jump-back location
}
interface ExtractedPage {
  ...existing
  blocks: PageBlock[]   // new
  text: string          // kept for backward compat (= blocks joined)
}
```

During extraction, each collected DOM block is tagged with
`data-lector-id="bN"`, so citations in a summary can scroll-and-highlight the
original passage.

**2. Backend: streaming + citation instructions (extends existing /chat).**

No new endpoint. The `/chat` system prompt embeds each block with a `[bN]`
prefix and constrains the model to cite only those ids:

```
PAGE CONTENT (each block prefixed [bN]; cite ONLY these ids):
[b0] First paragraph…
[b1] Second paragraph…
```

Instruction: *"When you state a fact from the article, append [bN] referencing
the block(s) it came from. If unsure, say so. Never cite an id not listed
above."*

The endpoint streams the raw model output verbatim (including `[bN]` markers).
**Parsing and rendering happen in the frontend** (chosen approach) so the
stream stays uninterrupted and the endpoint remains stateless.

**3. Frontend: render + click-to-jump.**

When rendering an assistant message, `[bN]` markers are parsed into clickable
superscript citation chips `[3]`. On click:

```
sidebar → content script: { action: 'lector-jump-to', blockId: 'b2' }
content script: query [data-lector-id="b2"] → scrollIntoView + 2s amber pulse highlight
```

Chips are superscripted, brand-colored, and show a 60-char preview of the
source block on hover to prevent mis-clicks.

### Data flow

```
user asks
  → sidebar fetch /chat (with page.blocks + page.text)
  → server system prompt embeds blocks prefixed [bN]
  → model streams "…delay harms user trust [0][2]."
  → frontend renders token-by-token; after completion, scans [bN] → <cite> chips
  → user clicks chip → sendMessage('lector-jump-to', blockId)
  → content script locates data-lector-id + highlights
```

### Error handling & degradation

| Case | Behavior |
|------|----------|
| Model omits `[bN]` (non-compliant) | Renders with no chips; never errors on missing citations |
| Model fabricates an id (e.g. `[b99]`) | Frontend validates id against block range; invalid ids dropped, no chip rendered |
| Page unmounted / SPA navigated after click | content script finds no node → toast "Source node unavailable" |
| Page overlong (truncated >12000 chars) | Truncated blocks keep ids; citations only point to sent blocks — inherently safe |

**Key safety property:** the id whitelist check is in the frontend; the server
never trusts self-reported model ids.

### Tests

Pure-function unit tests (no DOM):
- `parseCitations(text, validIds)` → extracts `[bN]`, filters invalid ids, returns ranges
- `buildCitedSystemPrompt(blocks)` → correct concatenation with `[bN]` prefixes
- `renderCitations(html, validIds)` → emits chip HTML; invalid ids removed

Integration test:
- content script `lector-jump-to`: inject DOM with `data-lector-id`, verify scroll + highlight called

---

## Feature ② — Highlights → Notion / Obsidian / Markdown

### Pain addressed
Glasp users explicitly crave a free Readwise-style auto-sync, but Glasp's
export is buggy and manual. Lector's local reading library extends naturally
into "capture while reading → one-click / auto export to a knowledge base".
Synergy with ①: captured highlights carry their source context and citation —
something Glasp cannot do.

### Mechanism

**1. Highlight capture (selection-toolbar action + shortcut).**

Highlight is a first-class action on the existing selection toolbar,
alongside translate/explain/summarize/ask. On selecting any text:
- toolbar shows a **Highlight** button (or `Alt+H` shortcut)

On capture:
- Use `Range` + wrap the start/end text nodes in
  `<mark class="lector-hl">`; **never replace/override page DOM structure**.
- Persist: `Highlight { id, text, note, quote (source context ±100 chars), url, title, blockId?, createdAt, color }`.
- If the highlight is inside a `data-lector-id` block, record `blockId` so it
  links back to ①'s citation grounding.

**2. Highlights management panel (new sidebar view).**

A **Highlights** entry in the sidebar header (next to Library) opens a drawer:
- grouped by page/domain; supports search, note editing, color change, delete
- top **Export** button with format dropdown: `Markdown` / `Notion` / `Obsidian`

**3. Three exports behind a unified Provider interface.**

```ts
// src/shared/exporters.ts — pure functions, easy to test
interface ExportProvider {
  format(highlights: Highlight[], opts: ExportOptions): ExportPayload
}
```

- **Markdown** — local file download, zero config. Each highlight is a
  blockquote (original) + note + source URL/title/blockId anchor link.
- **Obsidian** — `.md` with front-matter (`source`, `created`, `tags`) and
  `[[wikilinks]]`; user drops into a vault. Optional vault path for relative links.
- **Notion** — calls the Notion API to create a page; requires a user-supplied
  `NOTION_TOKEN` + database selection, stored in `chrome.storage.local`.
  On failure, degrades to a toast without losing highlights.

**Export scope control:** current page / all / by tag — to avoid bulk dumping.

### Data flow

```
select text → toolbar/Alt+H → content script: Range serialize + mark wrap + store
                                            ↓
sidebar Highlights drawer ← chrome.storage sync of highlight list
      ↓ pick Export → format
Markdown: browser Blob download
Obsidian: Blob download .md (front-matter)
Notion:   fetch Notion API (needs token) → on failure keep + toast retry
```

### Error handling & degradation

| Case | Behavior |
|------|----------|
| Range serialization fails (dynamic DOM) | Fallback to text-only highlight — store text+context, no on-page mark, still exportable |
| Duplicate highlight of same text | Detect existing same text+url; toast "Already highlighted"; no duplicate |
| Notion token missing/invalid | That format greyed out + tooltip guiding token setup; other formats unaffected |
| Notion API throttles (429) | Exponential backoff retry once; on persistent failure, keep a retry queue + toast |
| Marked elements cleared by SPA re-render | On next `lector-get-page`, best-effort re-mark by text anchor |

### Tests

Pure-function unit tests:
- `serializeRange(range)` → stable, reconstructable highlight descriptor (XPath/text anchor)
- three `ExportProvider.format()` → verify each format's structure (Markdown blockquote, Obsidian front-matter, Notion payload fields)
- highlight dedupe / grouping / search

Integration tests:
- content script highlight injection: inject paragraph, trigger highlight, verify `<mark class="lector-hl">` appears and other page nodes are untouched
- Markdown file generation + content

---

## Feature ③ — Vocabulary Builder (SM-2)

### Pain addressed
Immersive Translate explicitly lacks vocabulary learning; Trancy wins this.
Bilingual readers look up words that then scatter and are forgotten. Lector's
bilingual translation + selection toolbar add a "save word → spaced review"
loop, upgrading "read-and-translate" into "read-and-learn". This is the core
of why translation tools are criticized as "shallow".

### Mechanism

**1. Save-word in zero friction.**

On any translated/selected word or phrase:
- toolbar shows **★ Save word** (or `Alt+S`)

On save, context is captured automatically:
- `VocabEntry { id, word, translation (auto /translate), partOfSpeech?, context (sentence ±80 chars), url, title, lang, createdAt, srs }`
- `srs = { due, interval, ease, reps, lapses }` (SM-2)

Reuses ②'s highlight infrastructure: a saved word is essentially a highlight
carrying a translation and a review state.

**2. Spaced repetition (SM-2, pure function).**

A simplified SuperMemo-2 (the Anki core, validated by billions of users) —
pure math, trivially unit-testable:

```ts
// src/shared/srs.ts — pure, zero-dependency
function scheduleSrs(card, grade: 'again'|'hard'|'good'|'easy'): SrsState
function isDue(card, now): boolean
```

Review drives interval/ease updates via a 4-grade rating.

**3. Review panel (new sidebar view).**

A **Vocab** entry in the sidebar header opens a drawer:
- **Due today** count badge (based on `isDue`)
- review card: front = word + source sentence (translation hidden); back =
  translation + source link (jumps to original blockId, reusing ①)
- four grade buttons: Again / Hard / Good / Easy
- **All words** list, filterable by due/source/language

**4. Closed-loop data synergy.**

```
read foreign page → toolbar "translate" (existing) → see "★ Save word" → save (blockId+sentence)
                                                                              ↓
                                          next day / per SRS due → Vocab drawer shows "N due"
                                                                              ↓
                                          review card → flip to translation + click → jump to source (reuses ①)
```

The three features form a closed loop: **① grounded reading → ② highlights
persisted → ③ vocab review back to the original passage**.

### Data flow

```
select word → toolbar ★ Save word
  → content script: grab context (sentence) + current blockId
  → call /translate for translation (reuses existing endpoint)
  → store new VocabEntry (srs init: due = now+1d)
sidebar Vocab drawer
  → read store, isDue() computes today's queue
  → review → scheduleSrs() updates → persist
```

### Error handling & degradation

| Case | Behavior |
|------|----------|
| Translation fetch fails (/translate error/limited) | Still save; translation empty + flagged "needs translation"; prompt at review |
| Duplicate save of same word | Merge: keep latest context, keep earliest createdAt, do not reset SRS state |
| SRS due date in the past (clock skew) | `isDue` uses `<=`; card naturally falls into the due queue |
| Large vocab (>2000) | Drawer virtualizes/paginates; review queue capped at 50 per session to prevent fatigue |
| Word >60 chars or special chars | Validate; if >60 chars, toast "too long, looks like a sentence — use Highlight instead" |

### Tests

Pure-function unit tests (priority — SM-2 correctness is the trust core):
- `scheduleSrs` full matrix: first-card 4 grades, `again` reset, consecutive `easy` interval growth, `ease` floor protection (≥1.3), `lapses` accumulation
- `isDue` boundaries: due day, clock skew, future date
- save-word dedupe/merge

Integration tests:
- select → save → store persist → drawer render → grade → srs update full chain
- Vocab drawer virtualization

---

## Integration, files, tests, delivery scope

### New files (pure logic, independently unit-testable, zero DOM deps)

- `src/shared/highlights.ts` — Highlight types + serialize/dedupe/group (②, reused by ③)
- `src/shared/vocabulary.ts` — VocabEntry types + save/merge
- `src/shared/srs.ts` — SM-2 scheduler pure functions
- `src/shared/exporters.ts` — three ExportProvider pure functions
- `src/shared/citations.ts` — `[bN]` parse/render/system-prompt-build pure functions (①)

### Modified files

- `src/content.ts` — `extractPage` emits blocks + anchor ids; highlight injection; vocab save; `lector-jump-to` / `lector-highlight` / `lector-save-word` message handlers; text-anchor re-location
- `src/shared/store.ts` — add `highlights[]`, `vocab[]` state + actions, persisted
- `src/sidepanel/App.tsx` — Highlights drawer, Vocab drawer, citation chip rendering
- `src/sidepanel/markdown.ts` — citation rendering (chip replacement)
- `api/chat/index.ts` — system prompt embeds `[bN]`-prefixed blocks (citation grounding)
- `src/manifest.json` — version → 0.3.0; commands (Alt+H highlight, Alt+S save word)

### Test framework

Introduce **vitest** (project currently has none). Justified: SM-2, citation
parsing, and export formatting are pure logic whose correctness can only be
guaranteed by unit tests; manual testing cannot cover the matrices.

```
Pure-function unit tests (vitest, fast, CI-friendly)
├── citations.test.ts   parseCitations / renderCitations / buildCitedSystemPrompt
├── srs.test.ts         scheduleSrs full matrix / isDue boundaries
├── highlights.test.ts  serializeRange / dedupe / group
├── vocabulary.test.ts  save merge / validation
└── exporters.test.ts   Markdown / Obsidian / Notion payloads

Integration tests (jsdom, DOM interaction)
└── content.test.ts     jump-to highlight, highlight injection without breaking DOM
```

### Database / backend

No new tables, no new endpoints. ① extends the existing `/chat`; ②③ are
pure-client + reuse existing `/translate` and `/summarize`. Server-side rate
limiting stays uniform.

### Delivery scope (explicit boundary, anti-bloat)

**In scope:** all pure logic + unit tests; complete client-side flows for all
three features; ① backend prompt enhancement; Notion export (user-supplied
token); green build + type-check + passing tests.

**Out of scope (YAGNI):** OCR/PDF parsing; multi-tab batch Q&A; TTS
read-aloud; automatic background Notion sync (manual one-click export only);
Chrome Web Store publication.

### Risks & mitigations

- **DOM injection stability (top eng risk):** highlight/chip injection strictly
  uses Range + minimal `mark` nodes, never touching page structure; text-anchor
  re-location is best-effort; integration test covers "other page nodes intact
  after injection".
- **Model non-compliance with `[bN]`:** frontend id-whitelist check is the
  fallback; missing citations never error.
- **SM-2 correctness:** pure functions + full-matrix unit tests; constants
  reference Anki's published algorithm.
