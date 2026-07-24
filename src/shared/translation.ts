// Translation subsystem — pure logic, zero DOM, zero chrome API.
// All exports are unit-testable in jsdom. This module is the single source
// of truth for translation direction, language metadata, prompt building,
// concurrency control, block selection, and history LRU.

export type TargetLangCode =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de'
  | 'es' | 'ru' | 'pt' | 'it' | 'vi' | 'ar'

export interface LanguageDef {
  code: TargetLangCode
  /** English name (also used as the translation target token in prompts). */
  en: string
  /** Chinese name. */
  zh: string
  /** BCP-47 tag for SpeechSynthesis (browser TTS, zero-dependency). */
  speechCode: string
}

// zh/en first (most common), then by usage frequency.
export const LANGUAGES: LanguageDef[] = [
  { code: 'zh', en: 'Chinese',    zh: '中文',     speechCode: 'zh-CN' },
  { code: 'en', en: 'English',    zh: '英语',     speechCode: 'en-US' },
  { code: 'ja', en: 'Japanese',   zh: '日语',     speechCode: 'ja-JP' },
  { code: 'ko', en: 'Korean',     zh: '韩语',     speechCode: 'ko-KR' },
  { code: 'fr', en: 'French',     zh: '法语',     speechCode: 'fr-FR' },
  { code: 'de', en: 'German',     zh: '德语',     speechCode: 'de-DE' },
  { code: 'es', en: 'Spanish',    zh: '西班牙语', speechCode: 'es-ES' },
  { code: 'ru', en: 'Russian',    zh: '俄语',     speechCode: 'ru-RU' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语', speechCode: 'pt-PT' },
  { code: 'it', en: 'Italian',    zh: '意大利语', speechCode: 'it-IT' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语',   speechCode: 'vi-VN' },
  { code: 'ar', en: 'Arabic',     zh: '阿拉伯语', speechCode: 'ar-SA' },
]

const LANG_BY_CODE: Record<TargetLangCode, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l])
) as Record<TargetLangCode, LanguageDef>

/** Look up a language def; falls back to English for unknown codes. */
export function getLanguage(code: TargetLangCode): LanguageDef {
  return LANG_BY_CODE[code] || LANGUAGES[1] // en
}

export type Script = 'cjk' | 'cyrillic' | 'arabic' | 'latin'

/**
 * Detect the dominant script of a text by counting characters in each range.
 * Used to pick a sensible default target language (the "opposite" of the
 * source), matching the pre-existing zh<->en heuristic intuition.
 */
export function detectScript(text: string): Script {
  let cjk = 0, cyrillic = 0, arabic = 0, latin = 0
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
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++
    }
  }
  if (cjk >= cyrillic && cjk >= arabic && cjk > 0) return 'cjk'
  if (cyrillic >= arabic && cyrillic > 0) return 'cyrillic'
  if (arabic > 0) return 'arabic'
  return 'latin'
}

import type { GlossaryEntry } from './glossary'

export type TargetLangSetting = TargetLangCode | 'auto'

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
 * Build the standard translation system prompt, injecting the glossary block
 * only when non-empty. Single source of truth so the selection popup, bilingual
 * page mode, vocab save, and sentence card stay consistent. Migrated from the
 * former inline copy in content.ts.
 */
export function buildTranslateSystemPrompt(targetLang: TargetLangCode, glossaryBlock: string): string {
  const name = getLanguage(targetLang).en
  const base = `You are a professional translator. Translate the user text to ${name}. Preserve meaning, tone, and formatting. Keep code blocks, URLs, and HTML tags untranslated. Output ONLY the translation, no explanations.`
  return glossaryBlock ? `${base}\n\n${glossaryBlock}` : base
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
const MAX_BLOCK_LEN = 2000
const MIN_TEXT_RATIO = 0.6

/**
 * Decide whether a candidate DOM block should be translated. Pure function so
 * the DOM-querying (content.ts) is decoupled from the policy (here, unit-tested).
 */
export function shouldTranslateBlock(c: BlockCandidate): boolean {
  if (!TRANSLATABLE_TAGS.has(c.tag.toUpperCase())) return false
  const t = c.text.trim()
  if (t.length < MIN_BLOCK_LEN || t.length > MAX_BLOCK_LEN) return false
  if (c.isInsideExcluded) return false
  if (c.isAlreadyTranslated) return false
  if (c.textRatio < MIN_TEXT_RATIO) return false
  return true
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
