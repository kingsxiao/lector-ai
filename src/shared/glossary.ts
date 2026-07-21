// Custom glossary (术语表) domain logic for translation consistency.
//
// Pure functions, zero deps. Each entry maps a source term to a canonical
// translation. At translation time, enabled entries are rendered into a
// GLOSSARY block that is injected into the system prompt so the model
// translates those terms consistently (对标沉浸式翻译 AI 术语库).
//
// Persistence is handled by the zustand store (see store.ts), which writes
// this array into chrome.storage.local alongside templates / highlights / vocab.

export interface GlossaryEntry {
  id: string
  /** Original term (key), e.g. "LLM" "RAG" "Hugging Face". */
  source: string
  /** Canonical translation (value), e.g. "大语言模型" "检索增强生成" "抱抱脸". */
  target: string
  /** Optional note. UI-only; never injected into the prompt. */
  note?: string
  /** When false, the entry is skipped by renderGlossaryPrompt. */
  enabled: boolean
  /** Creation timestamp; used for stable sort + dedupe tiebreak. */
  createdAt: number
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/** Field length cap. Generous for terminology, but blocks accidental essay-length input. */
const MAX_FIELD_LEN = 200

/**
 * Validate a candidate entry before saving. Both source and target must be
 * non-empty trim, and neither may exceed MAX_FIELD_LEN.
 */
export function validateEntry(e: { source: string; target: string }): ValidationResult {
  if (e.source.trim().length === 0) return { ok: false, reason: 'empty-source' }
  if (e.target.trim().length === 0) return { ok: false, reason: 'empty-target' }
  if (e.source.length > MAX_FIELD_LEN) return { ok: false, reason: 'source-too-long' }
  if (e.target.length > MAX_FIELD_LEN) return { ok: false, reason: 'target-too-long' }
  return { ok: true }
}

/** Generate a unique-ish entry id. */
export function newEntryId(): string {
  return 'glossary_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * Render enabled entries into a prompt-injectable block. Returns '' for an
 * empty list OR a fully-disabled list so callers can cheaply skip the splice
 * when there's nothing to say (zero token cost when the user has no glossary).
 *
 * The block is intentionally short and directive — modern chat models follow
 * "translate X as Y" instructions reliably when they appear in the system
 * prompt, without needing few-shot examples.
 */
export function renderGlossaryPrompt(entries: GlossaryEntry[]): string {
  const active = entries.filter((e) => e.enabled && e.source.trim() && e.target.trim())
  if (active.length === 0) return ''
  const lines = active.map((e) => `- ${e.source} → ${e.target}`)
  return [
    'GLOSSARY (translate these terms consistently; always use the right-hand form):',
    ...lines,
  ].join('\n')
}

/** Serialize entries as pretty JSON for backup / migration. */
export function exportGlossary(entries: GlossaryEntry[]): string {
  return JSON.stringify(entries, null, 2)
}

/**
 * Import entries from a JSON string. Tolerates dirty data: malformed JSON or
 * non-array top-level produces { ok: false }; rows missing required fields
 * are silently skipped so a partially-corrupted backup still imports the
 * salvageable rows.
 */
export function importGlossary(json: string): {
  ok: boolean
  entries?: GlossaryEntry[]
  reason?: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'invalid JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'top-level JSON must be an array' }
  }
  const now = Date.now()
  const entries: GlossaryEntry[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : newEntryId()
    const source = typeof r.source === 'string' ? r.source : ''
    const target = typeof r.target === 'string' ? r.target : ''
    // Skip rows that fail validation — they would be unusable anyway.
    if (!validateEntry({ source, target }).ok) continue
    const note = typeof r.note === 'string' && r.note ? r.note : undefined
    const enabled = typeof r.enabled === 'boolean' ? r.enabled : true
    const createdAt = typeof r.createdAt === 'number' ? r.createdAt : now
    entries.push({ id, source, target, note, enabled, createdAt })
  }
  return { ok: true, entries }
}

/**
 * De-duplicate entries by source (case-insensitive). When two entries share a
 * source, the one with the SMALLER createdAt wins (we trust what the user
 * added first); ties break by original order. Returns a new array; input is
 * not mutated.
 */
export function dedupeEntries(entries: GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Map<string, GlossaryEntry>()
  for (const e of entries) {
    const key = e.source.trim().toLowerCase()
    if (!key) continue
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, e)
      continue
    }
    // Keep the earliest createdAt; on exact tie, keep the existing (first-seen).
    if (e.createdAt < prev.createdAt) {
      seen.set(key, e)
    }
  }
  // Preserve the relative order of first occurrences.
  const out: GlossaryEntry[] = []
  const used = new Set<string>()
  for (const e of entries) {
    const key = e.source.trim().toLowerCase()
    if (!key || used.has(key)) continue
    const winner = seen.get(key)!
    out.push(winner)
    used.add(key)
  }
  return out
}
