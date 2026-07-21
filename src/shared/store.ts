import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BYOK_SETTINGS, type ByokSettings } from './providers'
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { SrsState } from './srs'
import { BUILTIN_TEMPLATES, newTemplateId, type PromptTemplate } from './promptTemplates'
import { newEntryId, type GlossaryEntry } from './glossary'

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

  // Actions
  setByok: (patch: Partial<ByokSettings>) => void
  setByokAll: (s: ByokSettings) => void

  addSession: (session: ChatSession) => void
  updateSession: (id: string, patch: Partial<ChatSession>) => void
  removeSession: (id: string) => void
  clearSessions: () => void

  addHighlight: (h: Highlight) => { duplicate: boolean }
  removeHighlight: (id: string) => void
  updateHighlight: (id: string, patch: Partial<Highlight>) => void

  addVocab: (v: VocabEntry) => void
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
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      byok: DEFAULT_BYOK_SETTINGS,
      sessions: [],
      highlights: [],
      vocab: [],
      templates: BUILTIN_TEMPLATES,
      glossary: [],

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
            url: v.url || existing.url,
            title: v.title || existing.title,
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
    }),
    {
      name: 'lector-ai-storage',
      // NOTE: the API key is part of `byok` and is persisted to
      // chrome.storage.local by zustand/persist. That is intentional for BYOK —
      // it stays in the browser, never touches a server. Users who share a
      // machine should clear storage or use a separate browser profile.
      partialize: (state) => ({
        byok: state.byok,
        sessions: state.sessions,
        highlights: state.highlights,
        vocab: state.vocab,
        templates: state.templates,
        glossary: state.glossary,
      }),
    }
  )
)
