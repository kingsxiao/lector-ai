import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BYOK_SETTINGS, type ByokSettings } from './providers'

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

  // Actions
  setByok: (patch: Partial<ByokSettings>) => void
  setByokAll: (s: ByokSettings) => void

  addSession: (session: ChatSession) => void
  updateSession: (id: string, patch: Partial<ChatSession>) => void
  removeSession: (id: string) => void
  clearSessions: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      byok: DEFAULT_BYOK_SETTINGS,
      sessions: [],

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
    }),
    {
      name: 'lector-ai-storage',
      // NOTE: the API key is part of `byok` and is persisted to
      // chrome.storage.local by zustand/persist. That is intentional for BYOK —
      // it stays in the browser, never touches a server. Users who share a
      // machine should clear storage or use a separate browser profile.
      partialize: (state) => ({ byok: state.byok, sessions: state.sessions }),
    }
  )
)
