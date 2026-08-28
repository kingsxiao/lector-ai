// Full-library backup: a portable JSON file of everything the user has
// accumulated (sessions, highlights, vocab + SRS progress, templates, glossary,
// sentence cards, translation history). Deliberately EXCLUDES `byok` — the
// API key must never ride along into a file in ~/Downloads.
//
// Pure module (no DOM, no chrome.*, no zustand): the store imports
// `mergeBackupInto` for its `importBackup` action; both directions are
// unit-tested in tests/backup.test.ts.
import type { ChatSession } from './store'
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { PromptTemplate } from './promptTemplates'
import type { GlossaryEntry } from './glossary'
import type { SentenceCard } from './sentences'
import { normalizeSentence } from './sentences'
import type { TranslationHistoryEntry } from './translation'

/** Mirrors the store's per-slice caps (sessions/highlights/vocab/glossary/
 *  sentences/history). Single source of truth for import truncation. */
export const LIBRARY_CAPS = {
  sessions: 50,
  highlights: 500,
  vocab: 2000,
  glossary: 2000,
  sentences: 1000,
  history: 200,
} as const

export const BACKUP_APP_MARKER = 'lector-ai'
export const BACKUP_VERSION = 1

export interface LectorBackup {
  app: typeof BACKUP_APP_MARKER
  version: number
  createdAt: number
  sessions: ChatSession[]
  highlights: Highlight[]
  vocab: VocabEntry[]
  /** Custom templates only — built-ins are reconciled against the shipping
   *  list at hydration, so persisting them would only freeze stale copies. */
  templates: PromptTemplate[]
  glossary: GlossaryEntry[]
  sentences: SentenceCard[]
  translationHistory: TranslationHistoryEntry[]
}

/** The slices `buildBackup` reads. Structurally the persisted half of the
 *  zustand state minus byok/hasOpened. */
export interface BackupSource {
  sessions: ChatSession[]
  highlights: Highlight[]
  vocab: VocabEntry[]
  templates: PromptTemplate[]
  glossary: GlossaryEntry[]
  sentences: SentenceCard[]
  translationHistory: TranslationHistoryEntry[]
}

export function buildBackup(src: BackupSource): LectorBackup {
  return {
    app: BACKUP_APP_MARKER,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    sessions: src.sessions,
    highlights: src.highlights,
    vocab: src.vocab,
    templates: src.templates.filter((t) => !t.builtIn),
    glossary: src.glossary,
    sentences: src.sentences,
    translationHistory: src.translationHistory,
  }
}

export class BackupFormatError extends Error {}

// --- per-entry validation ----------------------------------------------------
// Import drops malformed entries instead of failing the whole file (a single
// hand-edited row shouldn't cost the user their entire restore), but slices
// that aren't arrays at all reject the file — that's not a Lector backup.

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

function isSrsLike(v: unknown): boolean {
  if (v === null) return true // sentence cards: null = passive reference
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  // Matches SrsState: due/interval/ease/reps/lapses (all numbers).
  return isNum(s.due) && isNum(s.interval) && isNum(s.ease) && isNum(s.reps) && isNum(s.lapses)
}

function validSession(v: unknown): v is ChatSession {
  const s = v as Partial<ChatSession>
  return (
    !!s && isStr(s.id) && isStr(s.title) && isStr(s.url) && isNum(s.createdAt) &&
    Array.isArray(s.messages) &&
    s.messages.every(
      (m) =>
        isStr(m.id) && (m.role === 'user' || m.role === 'assistant') && isStr(m.content)
    )
  )
}

function validHighlight(v: unknown): v is Highlight {
  const h = v as Partial<Highlight>
  return (
    !!h && isStr(h.id) && isStr(h.text) && isStr(h.url) && isStr(h.title) && isNum(h.createdAt) &&
    (h.note === undefined || isStr(h.note))
  )
}

function validVocab(v: unknown): v is VocabEntry {
  const e = v as Partial<VocabEntry>
  return (
    !!e && isStr(e.id) && isStr(e.word) && isStr(e.translation) && isNum(e.createdAt) &&
    (e.context === undefined || isStr(e.context)) && isSrsLike(e.srs)
  )
}

function validTemplate(v: unknown): v is PromptTemplate {
  const t = v as Partial<PromptTemplate>
  return !!t && isStr(t.id) && isStr(t.title) && isStr(t.content) && isBool(t.builtIn) && isNum(t.order)
}

function validGlossaryEntry(v: unknown): v is GlossaryEntry {
  const e = v as Partial<GlossaryEntry>
  return (
    !!e && isStr(e.id) && isStr(e.source) && isStr(e.target) && isBool(e.enabled) &&
    (e.note === undefined || isStr(e.note))
  )
}

function validSentenceCard(v: unknown): v is SentenceCard {
  const c = v as Partial<SentenceCard>
  return (
    !!c && isStr(c.id) && isStr(c.sentence) && isStr(c.analysis) && isNum(c.createdAt) &&
    (c.translation === undefined || isStr(c.translation)) &&
    (c.keywords === undefined || (Array.isArray(c.keywords) && c.keywords.every(isStr))) &&
    isSrsLike(c.srs)
  )
}

function validHistoryEntry(v: unknown): v is TranslationHistoryEntry {
  const e = v as Partial<TranslationHistoryEntry>
  return (
    !!e && isStr(e.id) && isStr(e.source) && isStr(e.target) && isNum(e.createdAt) &&
    (e.url === undefined || isStr(e.url))
  )
}

function sliceOf<T>(root: Record<string, unknown>, key: string, valid: (v: unknown) => v is T): T[] {
  const raw = root[key]
  if (!Array.isArray(raw)) {
    throw new BackupFormatError(`Backup is missing a valid "${key}" list.`)
  }
  return raw.filter(valid)
}

/** Parse + validate a downloaded backup file. Throws BackupFormatError with a
 *  user-presentable message for anything that isn't a Lector backup. */
export function parseBackup(raw: string): LectorBackup {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new BackupFormatError('File is not valid JSON.')
  }
  if (typeof json !== 'object' || json === null) {
    throw new BackupFormatError('File is not a Lector AI backup.')
  }
  const root = json as Record<string, unknown>
  if (root.app !== BACKUP_APP_MARKER) {
    throw new BackupFormatError('File is not a Lector AI backup.')
  }
  if (root.version !== BACKUP_VERSION) {
    throw new BackupFormatError(`Unsupported backup version: ${String(root.version)}`)
  }
  return {
    app: BACKUP_APP_MARKER,
    version: root.version,
    createdAt: isNum(root.createdAt) ? root.createdAt : Date.now(),
    sessions: sliceOf(root, 'sessions', validSession),
    highlights: sliceOf(root, 'highlights', validHighlight),
    vocab: sliceOf(root, 'vocab', validVocab),
    templates: sliceOf(root, 'templates', validTemplate).filter((t) => !t.builtIn),
    glossary: sliceOf(root, 'glossary', validGlossaryEntry),
    sentences: sliceOf(root, 'sentences', validSentenceCard),
    translationHistory: sliceOf(root, 'translationHistory', validHistoryEntry),
  }
}

export interface BackupSummary {
  sessions: number
  highlights: number
  vocab: number
  templates: number
  glossary: number
  sentences: number
  history: number
}

export interface BackupMergeResult {
  next: BackupSource
  /** How many entries per slice were actually ADDED (not already present). */
  added: BackupSummary
}

/** Merge a backup INTO the live library. Existing rows always win (the live
 *  copy carries newer SRS progress / edits / renames); the backup only fills
 *  gaps. This makes import idempotent — importing the same file twice adds
 *  nothing the second time. */
export function mergeBackupInto(current: BackupSource, b: LectorBackup): BackupMergeResult {
  // Sessions: union by id, newest-first, capped.
  const sessionIds = new Set(current.sessions.map((s) => s.id))
  const newSessions = b.sessions.filter((s) => !sessionIds.has(s.id))
  const sessions = [...current.sessions, ...newSessions]
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, LIBRARY_CAPS.sessions)

  const hlKey = (h: Highlight) => h.text + '\u0000' + h.url
  const hlSeen = new Set(current.highlights.map(hlKey))
  const newHighlights = b.highlights.filter((h) => !hlSeen.has(hlKey(h)))
  const highlights = [...newHighlights, ...current.highlights].slice(0, LIBRARY_CAPS.highlights)

  const wordKey = (v: VocabEntry) => v.word.trim().toLowerCase()
  const vocabSeen = new Set(current.vocab.map(wordKey))
  const newVocab = b.vocab.filter((v) => !vocabSeen.has(wordKey(v)))
  const vocab = [...newVocab, ...current.vocab].slice(0, LIBRARY_CAPS.vocab)

  const tplIds = new Set(current.templates.map((t) => t.id))
  const newTemplates = b.templates.filter((t) => !t.builtIn && !tplIds.has(t.id))
  const templates = [...current.templates, ...newTemplates]

  const gKey = (g: GlossaryEntry) => g.source.trim().toLowerCase()
  const gSeen = new Set(current.glossary.map(gKey))
  const newGlossary = b.glossary.filter((g) => !gSeen.has(gKey(g)))
  const glossary = [...newGlossary, ...current.glossary].slice(0, LIBRARY_CAPS.glossary)

  const sentKey = (s: SentenceCard) => normalizeSentence(s.sentence)
  const sentSeen = new Set(current.sentences.map(sentKey))
  const newSentences = b.sentences.filter((s) => !sentSeen.has(sentKey(s)))
  const sentences = [...newSentences, ...current.sentences].slice(0, LIBRARY_CAPS.sentences)

  // History dedupes on (source|targetLang) — the same key appendHistory uses —
  // with the live entry winning; newest-first, capped.
  const histKey = (e: TranslationHistoryEntry) => e.source.trim() + '|' + e.targetLang
  const histSeen = new Set(current.translationHistory.map(histKey))
  const newHistory = b.translationHistory.filter((e) => !histSeen.has(histKey(e)))
  const translationHistory = [...current.translationHistory, ...newHistory]
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, LIBRARY_CAPS.history)

  return {
    next: { sessions, highlights, vocab, templates, glossary, sentences, translationHistory },
    added: {
      sessions: newSessions.length,
      highlights: newHighlights.length,
      vocab: newVocab.length,
      templates: newTemplates.length,
      glossary: newGlossary.length,
      sentences: newSentences.length,
      history: newHistory.length,
    },
  }
}
