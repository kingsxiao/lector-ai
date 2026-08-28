import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_BYOK_SETTINGS, normalizeByokSettings, type ByokSettings } from './providers'
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import { newSrs, type SrsState } from './srs'
import { BUILTIN_TEMPLATES, newTemplateId, type PromptTemplate } from './promptTemplates'
import { newEntryId, type GlossaryEntry } from './glossary'
import { newCardId, normalizeSentence, makeSentenceCard, mergeSentenceCard, dedupeCards, type SentenceCard } from './sentences'
import { appendHistory, newHistoryId, type TranslationHistoryEntry } from './translation'
import { buildBackup, mergeBackupInto, type BackupSource, type BackupSummary, type LectorBackup } from './backup'

// --- debounced persistence ---------------------------------------------------
// zustand/persist writes the ENTIRE partialized state (sessions + highlights +
// vocab + sentences + glossary, potentially megabytes) synchronously to
// localStorage on EVERY set(). Draining a 20-item relay queue therefore used to
// stringify+write the whole library 20 times, and every SRS grade / settings
// keystroke paid the same full-state tax. This adapter coalesces writes: only
// the LAST serialized value per key lands, after a short trailing debounce.
const PERSIST_DEBOUNCE_MS = 400
const pendingPersistWrites = new Map<string, string>()
let persistFlushTimer: ReturnType<typeof setTimeout> | null = null

export function flushPendingPersistWrites(): void {
  if (persistFlushTimer !== null) {
    clearTimeout(persistFlushTimer)
    persistFlushTimer = null
  }
  for (const [name, value] of pendingPersistWrites) {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Quota exceeded — same best-effort behavior as the default adapter.
    }
  }
  pendingPersistWrites.clear()
}

const debouncedJsonStorage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(name),
  setItem: (name: string, value: string) => {
    pendingPersistWrites.set(name, value)
    if (persistFlushTimer === null) {
      persistFlushTimer = setTimeout(flushPendingPersistWrites, PERSIST_DEBOUNCE_MS)
    }
  },
  removeItem: (name: string) => {
    pendingPersistWrites.delete(name)
    localStorage.removeItem(name)
  },
}))

// A panel closed inside the debounce window must not lose its tail writes.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushPendingPersistWrites)
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSession {
  id: string
  title: string
  url: string
  createdAt: number
  messages: ChatMessage[]
}

function pickBackupSource(s: AppState): BackupSource {
  return {
    sessions: s.sessions,
    highlights: s.highlights,
    vocab: s.vocab,
    templates: s.templates,
    glossary: s.glossary,
    sentences: s.sentences,
    translationHistory: s.translationHistory,
  }
}

interface AppState {
  // BYOK settings (key stored locally; never sent anywhere except the provider)
  byok: ByokSettings

  // Reading library — chat sessions, newest-first.
  sessions: ChatSession[]

  // Knowledge layer — highlights (Feature ②) + vocabulary (Feature ③).
  highlights: Highlight[]
  vocab: VocabEntry[]

  // Prompt templates — built-in + user-custom, invoked via "/" in composer.
  templates: PromptTemplate[]

  // Custom glossary — source→target term mappings injected into translation
  // prompts for consistency (对标沉浸式翻译 AI 术语库).
  glossary: GlossaryEntry[]

  // Sentence library — structured deep-analysis cards (Feature ④).
  sentences: SentenceCard[]

  // Translation history — LRU list of recent translations (max 200).
  translationHistory: TranslationHistoryEntry[]

  // Onboarding: set true once the user has opened the panel (and seen the
  // first-run feature hint). Lets us show a one-time guide without nagging
  // returning users.
  hasOpened: boolean

  // Actions
  setByok: (patch: Partial<ByokSettings>) => void
  setByokAll: (s: ByokSettings) => void

  addSession: (session: ChatSession) => void
  updateSession: (id: string, patch: Partial<ChatSession>) => void
  removeSession: (id: string) => void
  clearSessions: () => void

  addHighlight: (h: Highlight) => { duplicate: boolean }
  /** Batch merge for relay-queue drains: one set()/persist instead of N. */
  addHighlights: (items: Highlight[]) => { duplicates: number }
  removeHighlight: (id: string) => void
  updateHighlight: (id: string, patch: Partial<Highlight>) => void

  addVocab: (v: VocabEntry) => void
  /** Batch merge with the same per-item semantics as addVocab. */
  addVocabs: (items: VocabEntry[]) => void
  removeVocab: (id: string) => void
  updateVocabSrs: (id: string, srs: SrsState) => void

  addTemplate: (t: Omit<PromptTemplate, 'id' | 'builtIn' | 'order'>) => void
  updateTemplate: (id: string, patch: Partial<PromptTemplate>) => void
  removeTemplate: (id: string) => void
  reorderTemplates: (orderedIds: string[]) => void

  addGlossaryEntry: (e: Omit<GlossaryEntry, 'id' | 'createdAt'>) => void
  updateGlossaryEntry: (id: string, patch: Partial<GlossaryEntry>) => void
  removeGlossaryEntry: (id: string) => void
  /** Replace the entire glossary (used by JSON import). Dedupes by source. */
  replaceGlossary: (entries: GlossaryEntry[]) => void

  addSentence: (s: Omit<SentenceCard, 'id' | 'createdAt'> & { createdAt?: number }) => void
  /** Batch merge with the same per-item semantics as addSentence. */
  addSentences: (items: Array<Omit<SentenceCard, 'id' | 'createdAt'> & { createdAt?: number }>) => void
  updateSentence: (id: string, patch: Partial<SentenceCard>) => void
  removeSentence: (id: string) => void
  replaceSentences: (cards: SentenceCard[]) => void
  /** Opt a passive reference card into SRS review: srs null → newSrs(). */
  promoteSentenceToReview: (id: string) => void
  /** Advance/punish an already-reviewable card's SRS. No-op if srs is null. */
  updateSentenceSrs: (id: string, srs: SrsState) => void

  // Translation history (LRU, max 200).
  addTranslationHistory: (entry: Omit<TranslationHistoryEntry, 'id'>) => void
  /** Batch append for relay-queue drains. */
  addTranslationHistoryBatch: (entries: Array<Omit<TranslationHistoryEntry, 'id'>>) => void
  clearTranslationHistory: () => void
  removeTranslationHistory: (id: string) => void

  // Full-library backup (Settings → 备份与恢复). Export never touches byok;
  // import merges into the live library (existing rows win, idempotent).
  exportBackup: () => LectorBackup
  importBackup: (backup: LectorBackup) => BackupSummary

  // Mark the panel as opened (first-run onboarding gate).
  markOpened: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      byok: DEFAULT_BYOK_SETTINGS,
      sessions: [],
      highlights: [],
      vocab: [],
      templates: BUILTIN_TEMPLATES,
      glossary: [],
      sentences: [],
      translationHistory: [],
      hasOpened: false,

      setByok: (patch) => set((s) => ({ byok: { ...s.byok, ...patch } })),
      setByokAll: (next) => set({ byok: next }),

      addSession: (session) =>
        set((s) => ({ sessions: [session, ...s.sessions].slice(0, 50) })),
      updateSession: (id, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeSession: (id) =>
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
      clearSessions: () => set({ sessions: [] }),

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
      addHighlights: (items) => {
        let duplicates = 0
        set((s) => {
          let highlights = s.highlights
          for (const h of items) {
            if (highlights.some((x) => x.text === h.text && x.url === h.url)) {
              duplicates++
              continue
            }
            highlights = [h, ...highlights].slice(0, 500)
          }
          // Same reference when nothing changed → no re-render, no persist.
          if (highlights === s.highlights) return s
          return { highlights }
        })
        return { duplicates }
      },
      removeHighlight: (id) =>
        set((s) => ({ highlights: s.highlights.filter((x) => x.id !== id) })),
      updateHighlight: (id, patch) =>
        set((s) => ({
          highlights: s.highlights.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      addVocab: (v) =>
        set((s) => {
          const w = v.word.toLowerCase()
          const idx = s.vocab.findIndex((x) => x.word.toLowerCase() === w)
          if (idx === -1) return { vocab: [v, ...s.vocab].slice(0, 2000) }
          // merge: keep earliest createdAt, latest context, preserve srs
          const existing = s.vocab[idx]
          const merged: VocabEntry = {
            ...existing,
            context: v.context || existing.context,
            translation: v.translation || existing.translation,
            url: v.url || existing.url,
            title: v.title || existing.title,
            createdAt: Math.min(existing.createdAt, v.createdAt),
            srs: existing.srs,
          }
          const next = [...s.vocab]
          next[idx] = merged
          return { vocab: next }
        }),
      addVocabs: (items) =>
        set((s) => {
          if (items.length === 0) return s
          let vocab = s.vocab
          for (const v of items) {
            const w = v.word.toLowerCase()
            const idx = vocab.findIndex((x) => x.word.toLowerCase() === w)
            if (idx === -1) {
              vocab = [v, ...vocab].slice(0, 2000)
              continue
            }
            const existing = vocab[idx]
            const merged: VocabEntry = {
              ...existing,
              context: v.context || existing.context,
              translation: v.translation || existing.translation,
              url: v.url || existing.url,
              title: v.title || existing.title,
              createdAt: Math.min(existing.createdAt, v.createdAt),
              srs: existing.srs,
            }
            const next = [...vocab]
            next[idx] = merged
            vocab = next
          }
          if (vocab === s.vocab) return s
          return { vocab }
        }),
      removeVocab: (id) => set((s) => ({ vocab: s.vocab.filter((x) => x.id !== id) })),
      updateVocabSrs: (id, srs) =>
        set((s) => ({
          vocab: s.vocab.map((x) => (x.id === id ? { ...x, srs } : x)),
        })),

      addTemplate: (t) =>
        set((s) => {
          // New custom templates go to the top (order = min - 1, clamped ≥ 0).
          const minOrder = s.templates.reduce((m, x) => Math.min(m, x.order), 0)
          const entry: PromptTemplate = {
            ...t,
            id: newTemplateId(),
            builtIn: false,
            order: Math.max(0, minOrder - 1),
          }
          return { templates: [entry, ...s.templates] }
        }),
      updateTemplate: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeTemplate: (id) =>
        set((s) => ({
          // Built-in templates can't be removed — keep them even if id matches.
          templates: s.templates.filter((x) => x.id !== id || x.builtIn),
        })),
      reorderTemplates: (orderedIds) =>
        set((s) => {
          const map = new Map(s.templates.map((t) => [t.id, t]))
          const reordered: PromptTemplate[] = []
          orderedIds.forEach((id, i) => {
            const t = map.get(id)
            if (t) {
              reordered.push({ ...t, order: i })
              map.delete(id)
            }
          })
          // Append any templates not in orderedIds (shouldn't happen) at the end.
          reordered.push(...[...map.values()].map((t, i) => ({ ...t, order: orderedIds.length + i })))
          return { templates: reordered }
        }),

      // Glossary: add prepends (newest first); duplicate source (case-insensitive)
      // updates the existing entry's target/note/enabled but preserves id+createdAt.
      // Matches the merge-semantics style of addVocab above.
      addGlossaryEntry: (e) =>
        set((s) => {
          const idx = s.glossary.findIndex(
            (x) => x.source.trim().toLowerCase() === e.source.trim().toLowerCase()
          )
          if (idx === -1) {
            const entry: GlossaryEntry = {
              ...e,
              id: newEntryId(),
              createdAt: Date.now(),
            }
            return { glossary: [entry, ...s.glossary].slice(0, 2000) }
          }
          const existing = s.glossary[idx]
          const merged: GlossaryEntry = {
            ...existing,
            source: e.source,
            target: e.target,
            note: e.note ?? existing.note,
            enabled: e.enabled,
          }
          const next = [...s.glossary]
          next[idx] = merged
          return { glossary: next }
        }),
      updateGlossaryEntry: (id, patch) =>
        set((s) => ({
          glossary: s.glossary.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeGlossaryEntry: (id) =>
        set((s) => ({ glossary: s.glossary.filter((x) => x.id !== id) })),
      replaceGlossary: (entries) =>
        set(() => {
          // Dedupe by source (earliest createdAt wins) to keep import idempotent.
          const seen = new Map<string, GlossaryEntry>()
          for (const e of entries) {
            const key = e.source.trim().toLowerCase()
            if (!key) continue
            const prev = seen.get(key)
            if (!prev || e.createdAt < prev.createdAt) seen.set(key, e)
          }
          // Preserve incoming order of first occurrences.
          const out: GlossaryEntry[] = []
          const used = new Set<string>()
          for (const e of entries) {
            const key = e.source.trim().toLowerCase()
            if (!key || used.has(key)) continue
            out.push(seen.get(key)!)
            used.add(key)
          }
          return { glossary: out }
        }),

      addSentence: (s) =>
        set((state) => {
          const idx = state.sentences.findIndex(
            (x) => normalizeSentence(x.sentence) === normalizeSentence(s.sentence)
          )
          if (idx === -1) {
            const card: SentenceCard = makeSentenceCard({ ...s, id: newCardId() })
            return { sentences: [card, ...state.sentences].slice(0, 1000) }
          }
          // merge: refresh analysis/translation/keywords/quote, preserve srs + earliest createdAt
          const existing = state.sentences[idx]
          const incoming = makeSentenceCard({ ...s, id: existing.id, createdAt: Date.now() })
          const merged = mergeSentenceCard(existing, incoming)
          const next = [...state.sentences]
          next[idx] = merged
          return { sentences: next }
        }),
      addSentences: (items) =>
        set((state) => {
          if (items.length === 0) return state
          let sentences = state.sentences
          for (const s of items) {
            const key = normalizeSentence(s.sentence)
            const idx = sentences.findIndex((x) => normalizeSentence(x.sentence) === key)
            if (idx === -1) {
              const card: SentenceCard = makeSentenceCard({ ...s, id: newCardId() })
              sentences = [card, ...sentences].slice(0, 1000)
              continue
            }
            const existing = sentences[idx]
            const incoming = makeSentenceCard({ ...s, id: existing.id, createdAt: Date.now() })
            const next = [...sentences]
            next[idx] = mergeSentenceCard(existing, incoming)
            sentences = next
          }
          if (sentences === state.sentences) return state
          return { sentences }
        }),
      updateSentence: (id, patch) =>
        set((s) => ({
          sentences: s.sentences.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeSentence: (id) =>
        set((s) => ({ sentences: s.sentences.filter((x) => x.id !== id) })),
      replaceSentences: (cards) =>
        set(() => {
          const deduped = dedupeCards(cards)
          return { sentences: deduped.slice(0, 1000) }
        }),
      promoteSentenceToReview: (id) =>
        set((s) => ({
          sentences: s.sentences.map((c) =>
            c.id === id && c.srs === null ? { ...c, srs: newSrs() } : c
          ),
        })),
      updateSentenceSrs: (id, srs) =>
        set((s) => ({
          sentences: s.sentences.map((c) => (c.id === id ? { ...c, srs } : c)),
        })),

      addTranslationHistory: (entry) =>
        set((s) => ({
          translationHistory: appendHistory(s.translationHistory, { ...entry, id: newHistoryId() }),
        })),
      addTranslationHistoryBatch: (entries) =>
        set((s) => {
          if (entries.length === 0) return s
          let history = s.translationHistory
          for (const entry of entries) {
            history = appendHistory(history, { ...entry, id: newHistoryId() })
          }
          return { translationHistory: history }
        }),
      clearTranslationHistory: () => set({ translationHistory: [] }),
      removeTranslationHistory: (id) =>
        set((s) => ({ translationHistory: s.translationHistory.filter((e) => e.id !== id) })),

      exportBackup: () => buildBackup(pickBackupSource(get())),
      importBackup: (backup) => {
        let added: BackupSummary = {
          sessions: 0, highlights: 0, vocab: 0, templates: 0, glossary: 0, sentences: 0, history: 0,
        }
        set((s) => {
          const { next, added: a } = mergeBackupInto(pickBackupSource(s), backup)
          added = a
          return next
        })
        return added
      },

      markOpened: () => set({ hasOpened: true }),
    }),
    {
      name: 'lector-ai-storage',
      version: 1,
      // Debounced coalescing adapter (see top of file): the default adapter
      // synchronously stringified+wrote the ENTIRE partialized state on every
      // set(); with a multi-MB library that made each of N queued relay items
      // a full-state write.
      storage: debouncedJsonStorage,
      // NOTE on persistence & the API key: zustand/persist (with no custom
      // storage adapter) writes to window.localStorage, NOT chrome.storage.
      // The API key lives in `byok` and is therefore in localStorage here —
      // intentional for BYOK (it stays in the browser, never touches a
      // server). Separately, byok.ts's saveSettings/getSettings mirror the
      // same `byok` object into chrome.storage.local under
      // `lector_byok_settings` so the content script and background worker
      // (which can't read window.localStorage of the side-panel origin) can
      // read the key. Users who share a machine should clear storage or use a
      // separate browser profile.
      //
      // version + migrate: bump version when the persisted shape changes in a
      // breaking way and handle old shapes here. v0 users (no version field)
      // migrate to v1 with defaults filled for any missing keys, so an upgrade
      // never silently corrupts their saved sessions/highlights/vocab.
      migrate: (persisted, _version) => {
        const s = (persisted || {}) as Partial<AppState>
        // Forward-compatible: fill defaults for any missing top-level slice so
        // an upgrade from an older persisted shape (e.g. a field added later)
        // doesn't leave holes that would crash selectors.
        return {
          byok: s.byok ?? DEFAULT_BYOK_SETTINGS,
          sessions: s.sessions ?? [],
          highlights: s.highlights ?? [],
          vocab: s.vocab ?? [],
          templates: s.templates ?? BUILTIN_TEMPLATES,
          glossary: s.glossary ?? [],
          sentences: s.sentences ?? [],
          translationHistory: s.translationHistory ?? [],
          hasOpened: s.hasOpened ?? false,
        } as AppState
      },
      // Validate every hydration, not only version migrations. localStorage can
      // be partially written or manually edited; Zustand's default shallow
      // merge would otherwise replace safe defaults with malformed arrays or
      // an invalid provider and crash the entire panel on first render.
      merge: (persisted, current) => {
        const s = (persisted || {}) as Partial<AppState>
        // Reconcile templates against the CURRENT built-ins. Built-ins live
        // inside the persisted array, so blindly trusting it would freeze the
        // built-in list at whatever shipped when the user first installed —
        // new built-ins would never appear and renamed ones would stay stale.
        // Keep user templates as-is; replace built-in rows with the current
        // BUILTIN_TEMPLATES (dropping built-ins that no longer exist).
        const persistedTemplates = Array.isArray(s.templates) ? s.templates : []
        const builtIns = BUILTIN_TEMPLATES.map((builtin) => {
          const override = persistedTemplates.find((t) => t.id === builtin.id && t.builtIn)
          // A user-renamed built-in carries a cleared titleKey (custom title
          // wins over the i18n key); anything else takes the shipped body.
          return override && override.titleKey === undefined
            ? { ...builtin, title: override.title, titleKey: undefined }
            : builtin
        })
        const templates = [...builtIns, ...persistedTemplates.filter((t) => !t.builtIn)]
        return {
          ...current,
          byok: normalizeByokSettings(s.byok),
          sessions: Array.isArray(s.sessions) ? s.sessions : [],
          highlights: Array.isArray(s.highlights) ? s.highlights : [],
          vocab: Array.isArray(s.vocab) ? s.vocab : [],
          templates,
          glossary: Array.isArray(s.glossary) ? s.glossary : [],
          sentences: Array.isArray(s.sentences) ? s.sentences : [],
          translationHistory: Array.isArray(s.translationHistory) ? s.translationHistory : [],
          hasOpened: typeof s.hasOpened === 'boolean' ? s.hasOpened : false,
        }
      },
      partialize: (state) => ({
        byok: state.byok,
        sessions: state.sessions,
        highlights: state.highlights,
        vocab: state.vocab,
        templates: state.templates,
        glossary: state.glossary,
        sentences: state.sentences,
        translationHistory: state.translationHistory,
        hasOpened: state.hasOpened,
      }),
    }
  )
)
