import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BYOK_SETTINGS, type ByokSettings } from './providers'
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { SrsState } from './srs'

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
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      byok: DEFAULT_BYOK_SETTINGS,
      sessions: [],
      highlights: [],
      vocab: [],

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
      }),
    }
  )
)
