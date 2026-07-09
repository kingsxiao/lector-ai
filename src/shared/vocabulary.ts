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
