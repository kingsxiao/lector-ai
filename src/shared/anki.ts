// AnkiConnect client + vocabulary→Anki field mapping.
//
// Pure logic + a single fetch wrapper, fully unit-testable (the fetch path is
// trivially mockable). Talks to the local AnkiConnect add-on (code 2058997622)
// at http://127.0.0.1:8765. We prefer 127.0.0.1 over localhost: AnkiConnect
// binds there by default, and the user must explicitly allow the extension's
// origin in webApiAllowedOrigins regardless — using the loopback IP avoids one
// class of "localhost also resolves to ::1" surprises.
//
// 对标 Saladict v7.13.1 的 Anki 自动制卡：把已有生词本一键送到 Anki 桌面端。

import type { VocabEntry } from './vocabulary'
import type { SentenceCard } from './sentences'

export const DEFAULT_ANKI_CONNECT_URL = 'http://127.0.0.1:8765'
export const DEFAULT_DECK_NAME = 'Lector::Vocabulary'
export const DEFAULT_MODEL_NAME = 'Basic'
export const DEFAULT_TAGS: string[] = ['lector']

/** AnkiConnect wire format for one action. */
export interface AnkiConnectAction {
  action: string
  params: Record<string, unknown>
}

/** A single AnkiConnect addNote payload, with Basic-model fields. */
export interface AnkiNote {
  deckName: string
  modelName: string
  fields: {
    Front: string
    Back: string
  }
  tags: string[]
}

/** Result of a batch export operation. */
export interface AnkiExportResult {
  added: number
  duplicated: number
  failed: number
  errors: string[]
}

/** Anki client config — lives inside ByokSettings.anki. */
export interface AnkiConfig {
  url: string
  deckName: string
  modelName: string
  tags: string[]
}

/**
 * Merge a partial config from settings with defaults. Returns a full config
 * object so callers never need to null-check. Used both by the UI and by
 * exportVocabToAnki.
 */
export function withAnkiDefaults(partial?: Partial<AnkiConfig>): AnkiConfig {
  return {
    url: partial?.url?.trim() || DEFAULT_ANKI_CONNECT_URL,
    deckName: partial?.deckName?.trim() || DEFAULT_DECK_NAME,
    modelName: partial?.modelName?.trim() || DEFAULT_MODEL_NAME,
    tags: Array.isArray(partial?.tags) && partial!.tags.length > 0 ? partial!.tags : DEFAULT_TAGS,
  }
}

/** Anki renders note fields as HTML (and executes card-side JS), so every
 *  page/AI-derived value must be HTML-escaped before landing in fields.Front/
 *  Back. Defense-in-depth: a hostile page whose text flows through a captured
 *  context or a prompt-injected model echo would otherwise land executable
 *  markup in the user's Anki collection. */
function escapeAnkiHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Source line as a real (escaped) anchor; non-http(s) URLs degrade to plain
 *  text so a smuggled scheme can't become an href. */
function ankiSourceLine(title: string, url: string): string {
  const t = title || 'Source'
  if (!url) return `Source: ${escapeAnkiHtml(t)}`
  if (/^https?:\/\//i.test(url)) {
    return `Source: <a href="${escapeAnkiHtml(url)}">${escapeAnkiHtml(t)}</a>`
  }
  return `Source: ${escapeAnkiHtml(t)} (${escapeAnkiHtml(url)})`
}

/**
 * Map a VocabEntry to an AnkiConnect addNote payload. Word → Front; the back
 * side packs translation + example context + source link so the card is
 * self-contained. Gracefully degrades when optional fields are missing (an
 * empty translation becomes a placeholder so Anki still accepts the card).
 */
export function vocabToAnkiNote(
  v: VocabEntry,
  opts: { deckName: string; modelName: string; tags?: string[] }
): AnkiNote {
  const back = renderBack(v)
  return {
    deckName: opts.deckName,
    modelName: opts.modelName,
    fields: { Front: escapeAnkiHtml(v.word), Back: back },
    tags: opts.tags ?? [],
  }
}

/** Render the back-of-card content. Kept inline to keep the test fixtures stable. */
function renderBack(v: VocabEntry): string {
  const parts: string[] = []
  parts.push(escapeAnkiHtml(v.translation?.trim() || '(no translation yet)'))
  if (v.context?.trim()) {
    parts.push('')
    parts.push(`&gt; ${escapeAnkiHtml(v.context.trim())}`)
  }
  if (v.url?.trim() || v.title?.trim()) {
    parts.push('')
    parts.push(ankiSourceLine(v.title?.trim() || '', v.url?.trim() || ''))
  }
  return parts.join('\n')
}

/**
 * Build the AnkiConnect POST body. A single action is sent as `{ action, …}`;
 * multiple actions are bundled as a `multi` action whose `params.actions` each
 * carry their own `version: 6` (AnkiConnect requires this inside multi).
 */
export function buildAnkiConnectBody(action: AnkiConnectAction | AnkiConnectAction[]): string {
  if (Array.isArray(action)) {
    return JSON.stringify({
      action: 'multi',
      version: 6,
      params: { actions: action.map((a) => ({ ...a, version: 6 })) },
    })
  }
  return JSON.stringify({ ...action, version: 6 })
}

/**
 * Invoke one (or many) AnkiConnect actions. Returns `{ ok, result?, error? }`.
 *  - Network failure (Anki not running / wrong URL / CORS) → ok=false, and
 *    the error message explicitly mentions Anki so the user knows what to do.
 *  - AnkiConnect returns an `error` string → ok=false with that error.
 *  - Success → ok=true with the raw result.
 *
 * `multi` actions return an array of per-action results; the caller is
 * responsible for indexing it in the same order it built the actions.
 */
export async function invokeAnkiConnect(
  url: string,
  action: AnkiConnectAction | AnkiConnectAction[],
  timeoutMs = 5000
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const body = buildAnkiConnectBody(action)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `AnkiConnect HTTP ${res.status}` }
    }
    let json: { result?: unknown; error?: string | null }
    try {
      json = await res.json()
    } catch {
      return { ok: false, error: 'AnkiConnect returned non-JSON response' }
    }
    if (json.error) {
      return { ok: false, error: `AnkiConnect: ${json.error}` }
    }
    return { ok: true, result: json.result }
  } catch (e) {
    // Most common cause: Anki desktop not running, AnkiConnect not installed,
    // or the extension origin isn't allowed. Give one friendly hint.
    const reason = e instanceof Error ? e.message : String(e)
    if (/abort|timeout/i.test(reason)) {
      return { ok: false, error: 'AnkiConnect timed out. Is Anki desktop running with the AnkiConnect add-on?' }
    }
    return {
      ok: false,
      error: `Cannot reach AnkiConnect (${reason}). Open Anki desktop and install the AnkiConnect add-on (code 2058997622); if the URL is correct, add this extension's origin to AnkiConnect's webApiAllowedOrigins.`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Export a batch of vocab entries to Anki. Steps:
 *   1. Bail out cheaply on empty input (no network call at all).
 *   2. createDeck (idempotent in AnkiConnect) + one addNote per entry, sent as
 *      a single multi action for efficiency.
 *   3. Walk the per-action results and tally added / duplicated / failed.
 *
 * AnkiConnect reports a duplicate (same first field already exists in the deck)
 * by returning `null` for that addNote with no top-level error. We map that to
 * `duplicated` so the user can re-export safely and only new cards are added.
 */
export async function exportVocabToAnki(
  vocab: VocabEntry[],
  opts: AnkiConfig
): Promise<AnkiExportResult> {
  const result: AnkiExportResult = { added: 0, duplicated: 0, failed: 0, errors: [] }
  if (vocab.length === 0) return result

  const actions: AnkiConnectAction[] = [
    { action: 'createDeck', params: { deck: opts.deckName } },
    ...vocab.map((v) => ({
      action: 'addNote',
      params: { note: vocabToAnkiNote(v, { deckName: opts.deckName, modelName: opts.modelName, tags: opts.tags }) },
    })),
  ]

  const res = await invokeAnkiConnect(opts.url, actions)
  if (!res.ok) {
    // Whole batch failed at the transport/AnkiConnect layer; every card is failed.
    result.failed = vocab.length
    result.errors.push(res.error || 'Unknown AnkiConnect error')
    return result
  }

  // Multi returns one result per action; index 0 is createDeck, rest are addNote.
  const perAction = Array.isArray(res.result) ? (res.result as unknown[]) : []
  // createDeck result lives at index 0; addNote results start at 1.
  for (let i = 0; i < vocab.length; i++) {
    const addResult = perAction[i + 1]
    if (addResult === null) {
      // AnkiConnect convention: null result means "duplicate, not added".
      result.duplicated += 1
    } else if (typeof addResult === 'number' && addResult > 0) {
      result.added += 1
    } else {
      result.failed += 1
      result.errors.push(`"${vocab[i].word}" was rejected by AnkiConnect`)
    }
  }
  return result
}

/** 句库导出 Anki 默认牌组名（与 Vocab 区分）。 */
export const DEFAULT_SENTENCE_DECK_NAME = 'Lector::Sentences'

/**
 * Map a SentenceCard to an AnkiConnect addNote payload. Front = 原句；
 * Back = 译文 + 完整 analysis Markdown + 来源链接。空字段优雅降级。
 */
export function sentenceToAnkiNote(
  c: SentenceCard,
  opts: { deckName: string; modelName: string; tags?: string[] }
): AnkiNote {
  return {
    deckName: opts.deckName,
    modelName: opts.modelName,
    fields: { Front: escapeAnkiHtml(c.sentence), Back: renderSentenceBack(c) },
    tags: opts.tags ?? [],
  }
}

/** Render the back-of-card content for a sentence card. */
function renderSentenceBack(c: SentenceCard): string {
  const parts: string[] = []
  if (c.translation?.trim()) {
    parts.push(escapeAnkiHtml(c.translation.trim()))
  }
  if (c.analysis?.trim()) {
    parts.push('')
    parts.push(escapeAnkiHtml(c.analysis.trim()))
  }
  if (c.url?.trim() || c.title?.trim()) {
    parts.push('')
    parts.push(ankiSourceLine(c.title?.trim() || '', c.url?.trim() || ''))
  }
  // 若译文和分析都空，给占位避免 Anki 拒收空 Back。
  if (parts.length === 0) parts.push('(no analysis yet)')
  return parts.join('\n')
}

/**
 * Export a batch of sentence cards to Anki. Mirrors exportVocabToAnki:
 * createDeck + N×addNote as a single multi action, tally added/duplicated/failed.
 */
export async function exportSentencesToAnki(
  cards: SentenceCard[],
  opts: AnkiConfig
): Promise<AnkiExportResult> {
  const result: AnkiExportResult = { added: 0, duplicated: 0, failed: 0, errors: [] }
  if (cards.length === 0) return result

  const actions: AnkiConnectAction[] = [
    { action: 'createDeck', params: { deck: opts.deckName } },
    ...cards.map((c) => ({
      action: 'addNote',
      params: { note: sentenceToAnkiNote(c, { deckName: opts.deckName, modelName: opts.modelName, tags: opts.tags }) },
    })),
  ]

  const res = await invokeAnkiConnect(opts.url, actions)
  if (!res.ok) {
    result.failed = cards.length
    result.errors.push(res.error || 'Unknown AnkiConnect error')
    return result
  }

  const perAction = Array.isArray(res.result) ? (res.result as unknown[]) : []
  for (let i = 0; i < cards.length; i++) {
    const addResult = perAction[i + 1]
    if (addResult === null) {
      result.duplicated += 1
    } else if (typeof addResult === 'number' && addResult > 0) {
      result.added += 1
    } else {
      result.failed += 1
      result.errors.push(`"${cards[i].sentence.slice(0, 30)}…" was rejected by AnkiConnect`)
    }
  }
  return result
}
