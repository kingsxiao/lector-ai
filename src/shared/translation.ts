// Translation subsystem — pure logic, zero DOM, zero chrome API.
// All exports are unit-testable in jsdom. This module is the single source
// of truth for translation direction, language metadata, prompt building,
// concurrency control, block selection, and history LRU.

// Language catalog lives in a dedicated module (105 BCP-47 entries) so this
// file stays focused on translation *logic*. We re-export the catalog + the
// legacy type alias so existing call sites keep working. `TargetLangCode` was
// a fixed 12-member union; it is now a `string` alias because the catalog grew
// past 100 entries (a 100-member union is unwieldy and slows the typechecker).
// Code is validated at runtime via isValidLangCode() at the storage boundary.
export type { LanguageDef } from './languages'
import {
  LANGUAGES as ALL_LANGUAGES,
  getLanguage as _getLanguage,
  isValidLangCode,
  searchLanguages,
} from './languages'

/** Alias kept for back-compat: any valid catalog code is a target language. */
export type TargetLangCode = string

export const LANGUAGES = ALL_LANGUAGES

/**
 * @deprecated use `isValidLangCode` from ./languages for new code; this thin
 *   wrapper is kept so existing call sites that imported getLanguage from
 *   translation.ts keep compiling.
 */
export function getLanguage(code: string) {
  return _getLanguage(code)
}

export { isValidLangCode, searchLanguages }

export type Script =
  | 'cjk' | 'cyrillic' | 'arabic' | 'latin'
  | 'hebrew' | 'greek' | 'devanagari' | 'thai'

/**
 * Detect the dominant script of a text by counting characters in each range.
 * Used to pick a sensible default target language (the "opposite" of the
 * source), matching the pre-existing zh<->en heuristic intuition.
 *
 * Extended beyond the original four scripts to cover Hebrew, Greek, Devanagari
 * (Hindi/Marathi/etc.) and Thai so the 'auto' direction is correct for a much
 * wider source set. Latin is still compared against every other script so a
 * single stray non-Latin char on an otherwise-Latin page does not flip the
 * direction (regression: English pages "translated" back to English).
 */
export function detectScript(text: string): Script {
  let cjk = 0, cyrillic = 0, arabic = 0, latin = 0
  let hebrew = 0, greek = 0, devanagari = 0, thai = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff) ||
        (c >= 0xac00 && c <= 0xd7af)) {
      cjk++
    } else if (c >= 0x0400 && c <= 0x04ff) {
      cyrillic++
    } else if (c >= 0x0600 && c <= 0x06ff) {
      arabic++
    } else if (c >= 0x0590 && c <= 0x05ff) {
      hebrew++
    } else if (c >= 0x0370 && c <= 0x03ff) {
      greek++
    } else if (c >= 0x0900 && c <= 0x097f) {
      devanagari++
    } else if (c >= 0x0e00 && c <= 0x0e7f) {
      thai++
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++
    }
  }
  // Pick the DOMINANT script by raw count, comparing ALL scripts against each
  // other (including latin). The previous logic compared cjk only to cyrillic
  // and arabic — never to latin — so a single stray CJK char in an otherwise
  // Latin page won ('cjk > 0' was enough), which made resolveTargetLang flip
  // an English page (with e.g. a Chinese footer char) to "translate to
  // English" → the page came back untranslated. Compare against latin too so
  // the majority script wins.
  const max = Math.max(cjk, cyrillic, arabic, latin, hebrew, greek, devanagari, thai)
  if (max === 0) return 'latin'
  if (cjk === max) return 'cjk'
  if (cyrillic === max) return 'cyrillic'
  if (arabic === max) return 'arabic'
  if (hebrew === max) return 'hebrew'
  if (greek === max) return 'greek'
  if (devanagari === max) return 'devanagari'
  if (thai === max) return 'thai'
  return 'latin'
}

import type { GlossaryEntry } from './glossary'

export type TargetLangSetting = string | 'auto'

/**
 * Resolve the final target language. An explicit user choice wins; 'auto'
 * picks the "opposite" of the detected source script (CJK -> English, else
 * Chinese), preserving the existing intuition.
 */
export function resolveTargetLang(setting: TargetLangSetting, sourceText: string): TargetLangCode {
  if (setting !== 'auto') return setting
  return detectScript(sourceText) === 'cjk' ? 'en' : 'zh'
}

/**
 * Best-effort guess of the SOURCE language code from text, for display next to
 * an auto-resolved target (surpass-feature: surface detected source so the
 * user can trust the direction). Coarse — keyed off the dominant script — but
 * good enough to label "Detected: English → 中文".
 */
export function detectSourceLang(text: string): string {
  switch (detectScript(text)) {
    case 'cjk': return 'zh'
    case 'cyrillic': return 'ru'
    case 'arabic': return 'ar'
    case 'hebrew': return 'he'
    case 'greek': return 'el'
    case 'devanagari': return 'hi'
    case 'thai': return 'th'
    default: return 'en'
  }
}

/**
 * Build the standard translation system prompt, injecting the glossary block
 * only when non-empty. Single source of truth so the selection popup, bilingual
 * page mode, vocab save, and sentence card stay consistent. Migrated from the
 * former inline copy in content.ts.
 *
 * Prompt design notes (regression: English pages "translated" back to English):
 *  - The entire output is HARD-required to be in the target language. Without
 *    this, the model routinely echoed the source for markup-heavy / technical
 *    blocks (inline <code>, URLs, identifiers), producing an English→English
 *    result that looked like translation did nothing.
 *  - The "leave untranslated" directive is scoped to actual code/URLs *inside*
 *    the text, and paired with an explicit "translate ALL surrounding prose"
 *    instruction. The old unqualified "Keep code blocks, URLs, and HTML tags
 *    untranslated" was over-applied to prose with a few inline tokens, so the
 *    model skipped the whole block.
 *  - A source-language hint (set via buildTranslateUserPrompt) gives the model
 *    confidence to commit to a direction instead of hedging.
 *
 * The optional `personaPrompt` (Phase 8 AI Expert) is spliced AFTER the base
 * instruction but BEFORE the glossary, so the persona shapes register/tone
 * while the hard output-language requirement + glossary still win. Empty
 * personaPrompt (the 'general' persona) leaves the prompt unchanged — back-compat
 * with the original two-arg signature.
 */
export function buildTranslateSystemPrompt(
  targetLang: TargetLangCode,
  glossaryBlock: string,
  personaPrompt: string = ''
): string {
  const name = getLanguage(targetLang).en
  const base = `You are a professional translator. Translate the user text into ${name}. Preserve meaning, tone, and formatting. Your entire output MUST be written in ${name} — never echo the source language. Leave code snippets, URLs, email addresses, and HTML tags verbatim, but translate ALL surrounding prose, including sentences that contain code or links. Output ONLY the translation, no explanations, no quotes.`
  const parts = [base]
  if (personaPrompt.trim()) parts.push(personaPrompt.trim())
  if (glossaryBlock) parts.push(glossaryBlock)
  return parts.join('\n\n')
}

/**
 * Build the user-turn content for a translation request. The source text is
 * returned VERBATIM with no wrapper — this is deliberate: page-mode chunks are
 * concatenated back together by callers, so any framing text ("Translate
 * this:", language tags) would corrupt the round-trip and bleed into the
 * rendered translation. The translation direction + output language are
 * enforced entirely by the system prompt (see buildTranslateSystemPrompt),
 * which is where the model actually heeds them.
 *
 * This function exists as the explicit single entry point for the user turn so
 * callers don't inline the text and so future per-block enrichment (none
 * currently) has one place to live.
 */
export function buildTranslateUserPrompt(text: string): string {
  return text
}

/**
 * Map a target language code to its dominant script, so we can tell whether a
 * translation was *expected* to change script (en→zh must produce CJK; zh→en
 * must produce Latin). Used by isTranslationLikelyUnchanged to avoid flagging
 * same-script "translations" (en→en, es→en) where echoing is ambiguous rather
 * than a definite failure.
 */
function scriptOfLang(lang: TargetLangCode): Script {
  // CJK variants (incl. Traditional/Cantonese/Min Nan/Classical) all share the
  // Han script; ru/uk/be/mk/bg/sr use Cyrillic; Arabic-script langs (ar, fa,
  // ur, ps) share Arabic; Hebrew (he, yi); Greek (el); Devanagari (hi, bn, mr,
  // gu, ne, sa); Thai (th, lo). Everything else defaults to Latin.
  if (
    lang === 'zh' || lang === 'zh-TW' || lang === 'ja' || lang === 'ko' ||
    lang === 'yue' || lang === 'nan' || lang === 'wyw'
  ) return 'cjk'
  if (lang === 'ru' || lang === 'uk' || lang === 'be' || lang === 'mk' ||
      lang === 'bg' || lang === 'sr') return 'cyrillic'
  if (lang === 'ar' || lang === 'fa' || lang === 'ur' || lang === 'ps') return 'arabic'
  if (lang === 'he' || lang === 'yi') return 'hebrew'
  if (lang === 'el') return 'greek'
  if (lang === 'hi' || lang === 'bn' || lang === 'mr' || lang === 'gu' || lang === 'ne') return 'devanagari'
  if (lang === 'th' || lang === 'lo') return 'thai'
  return 'latin' // en, fr, de, es, pt, it, vi, and the rest of the catalog
}

// Below this length (after whitespace trim) a source is too short to judge
// reliably — "API", "OK", a lone URL — so we don't flag it. This also prevents
// retry loops on legitimately untranslatable identifiers.
const UNCHANGED_MIN_SOURCE_LEN = 8

/**
 * Decide whether a translation output looks like the model just echoed the
 * source instead of translating it — the English→English symptom. Pure so it
 * can be unit-tested; the page translator calls this per chunk to trigger a
 * single forceful retry when it returns true.
 *
 * Rules:
 *  - Source too short (< 8 non-space chars) → false (too noisy).
 *  - Target script equals source script → false (e.g. user asked en→en, or
 *    a Latin→Latin pair where echoing is ambiguous, not a definite failure).
 *  - Otherwise compare the two on a normalized form (lowercased, whitespace +
 *    punctuation stripped). If they match exactly OR differ by very little
 *    (≤20% of the longer string's length) → true (the model didn't translate).
 */
export function isTranslationLikelyUnchanged(
  source: string,
  output: string,
  targetLang: TargetLangCode
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  const ns = norm(source)
  const no = norm(output)
  if (ns.length < UNCHANGED_MIN_SOURCE_LEN) return false
  // Only flag when a real script change was expected.
  if (scriptOfLang(targetLang) === detectScript(source)) return false
  if (!no) return true // empty output after normalization = nothing translated
  if (ns === no) return true
  // Character-level diff ratio (cheap Levenshtein-free proxy via LCS length).
  const lcs = longestCommonSubsequence(ns, no)
  const longer = Math.max(ns.length, no.length)
  const diffRatio = 1 - lcs / longer
  return diffRatio <= 0.2
}

/** LCS length (dynamic programming). Used for the unchanged-output similarity. */
function longestCommonSubsequence(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0 || n === 0) return 0
  // Two rolling rows to keep memory O(min(m,n)).
  let prev = new Array(n + 1).fill(0)
  let curr = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Output-token budget for translating one chunk.
//  - Floor (300): short headings / labels still get headroom for the model's
//    framing; the old 200 floor produced empty-looking responses on tiny blocks.
//  - Scale (×2): a Chinese translation of N source chars can run up to ~2N
//    characters, which is roughly N–2N tokens depending on the script.
//  - Ceiling (4000): comfortably covers a full MAX_BLOCK_LEN (2000) translation
//    with margin, and bounds the request for runaway estimates.
// Regression this fixes ("翻译不全"): the per-chunk budget was capped at 1000,
// so a 2000-char English block (Chinese ≈ 1500–2500 chars ≈ 1200–1800 tokens)
// was truncated mid-sentence and the user saw a partial translation.
const MAX_TOKENS_FLOOR = 300
const MAX_TOKENS_CEIL = 4000
export function maxTokensForChunk(sourceLen: number): number {
  return Math.min(MAX_TOKENS_CEIL, Math.max(MAX_TOKENS_FLOOR, Math.floor(sourceLen * 2)))
}

/**
 * Direction-aware glossary filter. When the target is Chinese, only Latin-source
 * terms are relevant (we are translating foreign text INTO chinese); when the
 * target is English, only CJK-source terms are relevant. For other target
 * languages we cannot infer direction, so keep all enabled entries. Disabled
 * entries are always dropped.
 */
export function filterGlossaryForDirection(entries: GlossaryEntry[], targetLang: TargetLangCode): GlossaryEntry[] {
  const enabled = entries.filter((e) => e.enabled && e.source.trim() && e.target.trim())
  if (targetLang !== 'zh' && targetLang !== 'en') return enabled
  return enabled.filter((e) => {
    const srcScript = detectScript(e.source)
    return targetLang === 'zh' ? srcScript !== 'cjk' : srcScript === 'cjk'
  })
}

// ---------------------------------------------------------------------------
// Bounded concurrency runner
// ---------------------------------------------------------------------------

export interface ConcurrencyOptions {
  concurrency: number
  signal?: AbortSignal
}

export type ConcurrentResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: unknown; index: number }

/**
 * Run `worker` over `items` with at most `concurrency` in-flight tasks. Never
 * throws: a failing task is reported as { ok:false } so callers (e.g. bilingual
 * page translation) can keep going best-effort. Respects an optional AbortSignal:
 * when aborted, not-yet-started tasks are rejected with the abort error.
 */
export async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: ConcurrencyOptions
): Promise<ConcurrentResult<R>[]> {
  const n = Math.max(1, opts.concurrency)
  const results: ConcurrentResult<R>[] = new Array(items.length)
  let cursor = 0
  const aborted = () => opts.signal?.aborted === true

  async function runOne(myIndex: number): Promise<void> {
    if (aborted()) {
      results[myIndex] = { ok: false, error: new DOMException('Aborted', 'AbortError'), index: myIndex }
      return
    }
    try {
      const value = await worker(items[myIndex], myIndex)
      results[myIndex] = { ok: true, value }
    } catch (e) {
      results[myIndex] = { ok: false, error: e, index: myIndex }
    }
  }

  // Pool of workers; each grabs the next index until exhausted or aborted.
  async function pool(): Promise<void> {
    while (true) {
      if (aborted()) return
      const myIndex = cursor++
      if (myIndex >= items.length) return
      await runOne(myIndex)
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(n, items.length); i++) workers.push(pool())
  await Promise.all(workers)

  // Fill any untouched slots (e.g. abort before a pooled worker claimed them).
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { ok: false, error: new DOMException('Aborted', 'AbortError'), index: i }
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Block selection policy (pure — DOM querying stays in content.ts)
// ---------------------------------------------------------------------------

/** Tags whose text content is worth translating. */
export const TRANSLATABLE_TAGS = new Set([
  'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'SUMMARY',
])

/** Ancestor tags that mark content as non-translatable (code, controls, etc). */
export const EXCLUDED_ANCESTOR_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT',
  'SELECT', 'OPTION', 'BUTTON', 'SVG', 'MATH',
])

export interface BlockCandidate {
  text: string
  tag: string
  isInsideExcluded: boolean
  isAlreadyTranslated: boolean
  /** text length / element outerHTML length; below threshold = mostly markup. */
  textRatio: number
}

// Minimum block length chosen so trivial fragments (e.g. "hi", nav labels)
// are skipped, while short-but-meaningful headings/list items still qualify.
const MIN_BLOCK_LEN = 3
/** Soft upper bound for a single translation chunk. Blocks longer than this are
 *  SPLIT (see splitBlockForTranslation) rather than dropped — long sections on
 *  technical-doc sites used to vanish entirely. Exported so content.ts shares
 *  the same split threshold the filter treats as "needs splitting". */
export const MAX_BLOCK_LEN = 2000
// Relaxed from 0.6 to 0.4: technical-doc / code-site blocks are markup-heavy
// (inline <code>, links, entities), which inflates outerHTML and pushes
// textRatio = text.length/outerHTML.length below 0.6 even for perfectly
// translatable prose. 0.4 keeps nav/button fragments out while rescuing
// ~half the blocks on a typical docs page.
const MIN_TEXT_RATIO = 0.4
// List/table/description tags naturally carry heavy inline markup (links,
// topic tags, badges) but contain genuine prose — a GitHub repo description is
// a <p> or <li> full of <a> topic links whose textRatio can be ~0.35. Use a
// looser ratio for these so their content is translated instead of dropped.
const LISTISH_TAGS = new Set(['LI', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'SUMMARY'])
const MIN_TEXT_RATIO_LISTISH = 0.18
// Absolute text-length floor: if a block has this much REAL text (≥ 30 chars)
// it is almost always a meaningful clause/sentence regardless of how much
// markup wraps it, so translate it even when the ratio is low. This catches
// the GitHub repo-description case (link-heavy <p>/<li>) that the ratio alone
// dropped. 30 is ~the length of a short clause (a 1-2 word nav label is well
// under this), so it doesn't pull in nav/button fragments.
const ABSOLUTE_TEXT_LEN_FLOOR = 30

/**
 * Decide whether a candidate DOM block should be translated. Pure function so
 * the DOM-querying (content.ts) is decoupled from the policy (here, unit-tested).
 *
 * Note: length is NOT a reason to reject — long blocks are accepted here and
 * split into chunks by the caller (splitBlockForTranslation). Only genuinely
 * untranslatable content (wrong tag, too short, excluded ancestor, already
 * translated, markup-dominant) is filtered out.
 *
 * The markup-ratio test has three tiers so genuine prose is not dropped on
 * markup-heavy / list pages (the regression that left GitHub repo descriptions
 * and other link-heavy content untranslated):
 *   1. ≥ ABSOLUTE_TEXT_LEN_FLOOR real chars → translate (prose is prose).
 *   2. List/table tags → looser LISTISH ratio (they're markup-heavy by nature).
 *   3. Otherwise → the standard ratio (keeps nav/button fragments out).
 */
export function shouldTranslateBlock(c: BlockCandidate): boolean {
  if (!TRANSLATABLE_TAGS.has(c.tag.toUpperCase())) return false
  const t = c.text.trim()
  if (t.length < MIN_BLOCK_LEN) return false
  if (c.isInsideExcluded) return false
  if (c.isAlreadyTranslated) return false
  if (t.length >= ABSOLUTE_TEXT_LEN_FLOOR) return true
  const isListish = LISTISH_TAGS.has(c.tag.toUpperCase())
  const threshold = isListish ? MIN_TEXT_RATIO_LISTISH : MIN_TEXT_RATIO
  if (c.textRatio < threshold) return false
  return true
}

/**
 * Split a long block's text into translation chunks, each no longer than
 * `maxLen` (default MAX_BLOCK_LEN). Strategy:
 *   1. Empty/whitespace → [] (nothing to translate).
 *   2. Fits the limit → [text] (single chunk, no overhead).
 *   3. Otherwise, greedily pack sentences (splitting after . ! ? 。！？ or
 *      newlines) until adding the next sentence would exceed maxLen, then
 *      start a new chunk. A single sentence longer than maxLen is hard-split
 *      at maxLen so progress is always made.
 *
 * Chunks join back to the original text exactly (no trimming/loss), so the
 * caller can render them in order under one host block. Pure & unit-tested.
 */
export function splitBlockForTranslation(text: string, maxLen: number = MAX_BLOCK_LEN): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  // Find sentence-end positions (index of the char AFTER the terminator, incl.
  // any trailing whitespace) so we can cut there. Matches runs of terminators
  // followed by optional spaces.
  const boundary = /[.!?。！？\n]+[ \t]*/g
  const cuts: number[] = []
  let m: RegExpExecArray | null
  while ((m = boundary.exec(trimmed)) !== null) {
    cuts.push(m.index + m[0].length)
  }

  const chunks: string[] = []
  let start = 0
  let nextCutIdx = 0
  while (start < trimmed.length) {
    // No chunk may exceed maxLen.
    const hardEnd = Math.min(trimmed.length, start + maxLen)
    if (hardEnd - start <= 0) break

    // If the remainder fits entirely, take it all.
    if (trimmed.length - start <= maxLen) {
      chunks.push(trimmed.slice(start))
      break
    }

    // Find the last boundary within [start, hardEnd] for a clean sentence cut.
    let end = hardEnd
    while (nextCutIdx < cuts.length && cuts[nextCutIdx] <= hardEnd) nextCutIdx++
    // nextCutIdx now points past the last boundary ≤ hardEnd; step back.
    let lastBound = -1
    for (let i = nextCutIdx - 1; i >= 0; i--) {
      if (cuts[i] > start) { lastBound = cuts[i]; break }
    }
    if (lastBound > start) end = lastBound
    // else: no boundary in range → hard-cut at maxLen (still ≤ maxLen).

    chunks.push(trimmed.slice(start, end))
    start = end
    // Keep nextCutIdx cursor monotonic; boundary list isn't regenerated.
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Translation history (LRU)
// ---------------------------------------------------------------------------

export type TranslationKind = 'selection' | 'page' | 'vocab' | 'sentence'

export interface TranslationHistoryEntry {
  id: string
  source: string
  target: string
  sourceLang: string
  targetLang: TargetLangCode
  kind: TranslationKind
  url: string
  createdAt: number
}

export function newHistoryId(): string {
  return 'th_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const HISTORY_MAX = 200
const FIELD_MAX = 200
const trunc = (s: string) => (s.length > FIELD_MAX ? s.slice(0, FIELD_MAX) : s)

/**
 * Append a history entry with LRU semantics: newest first; an exact
 * (source, targetLang) duplicate replaces the older one; the list is capped
 * at `max` (default 200). Source/target are truncated to 200 chars.
 */
export function appendHistory(
  list: TranslationHistoryEntry[],
  entry: TranslationHistoryEntry,
  max = HISTORY_MAX
): TranslationHistoryEntry[] {
  const norm = (s: string) => s.trim()
  const key = (e: TranslationHistoryEntry) => norm(e.source) + '|' + e.targetLang
  const k = key(entry)
  const filtered = list.filter((e) => key(e) !== k)
  const clean: TranslationHistoryEntry = {
    ...entry,
    source: trunc(entry.source),
    target: trunc(entry.target),
  }
  return [clean, ...filtered].slice(0, max)
}

// ---------------------------------------------------------------------------
// Batch translation (available but NOT enabled by default; preserves streaming)
// ---------------------------------------------------------------------------

export const BATCH_SEP = '\n\n@@@LECTOR_BATCH@@@\n\n'

export function buildBatchPrompt(items: string[], targetLang: TargetLangCode, glossaryBlock: string): { system: string; user: string } {
  const system = buildTranslateSystemPrompt(targetLang, glossaryBlock) +
    `\n\nThe user message contains ${items.length} segments separated by the line "${BATCH_SEP.trim()}". Translate each segment independently and output them in the SAME order, separated by exactly the same separator. Do not add numbering or extra text.`
  const user = items.join(BATCH_SEP)
  return { system, user }
}

export function parseBatchResult(raw: string, count: number): string[] {
  const parts = raw.split(BATCH_SEP).map((p) => p.trim())
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(parts[i] || '')
  return out
}

// ---------------------------------------------------------------------------
// Display mode
// ---------------------------------------------------------------------------

export type DisplayMode = 'bilingual' | 'translationOnly' | 'hover'
const DISPLAY_MODES: DisplayMode[] = ['bilingual', 'translationOnly', 'hover']
export function isValidDisplayMode(m: unknown): m is DisplayMode {
  return typeof m === 'string' && (DISPLAY_MODES as string[]).includes(m)
}
