import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_API_BASE } from './config'

interface User {
  id: string
  email: string
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

interface AppState {
  // Auth
  user: User | null
  accessToken: string | null
  isPro: boolean
  isLoading: boolean

  // Usage (UI hint only; server is source of truth)
  usageCount: number

  // Reading library — chat sessions keyed by id, newest-first.
  sessions: ChatSession[]

  // Actions
  setUser: (user: User | null, accessToken?: string | null) => void
  setPro: (value: boolean) => void
  setLoading: (value: boolean) => void
  incrementUsage: () => void
  logout: () => void

  addSession: (session: ChatSession) => void
  updateSession: (id: string, patch: Partial<ChatSession>) => void
  removeSession: (id: string) => void
  clearSessions: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isPro: false,
      isLoading: false,
      usageCount: 0,
      sessions: [],

      setUser: (user, accessToken = null) => set({ user, accessToken }),
      setPro: (value: boolean) => set({ isPro: value }),
      setLoading: (value: boolean) => set({ isLoading: value }),
      incrementUsage: () => {
        const state = get()
        if (state.isPro) return
        set((s) => ({ usageCount: s.usageCount + 1 }))
      },
      logout: () => set({ user: null, accessToken: null, isPro: false, usageCount: 0 }),

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
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isPro: state.isPro,
        usageCount: state.usageCount,
        sessions: state.sessions,
      }),
    }
  )
)

// Initialize from chrome storage on popup load and verify the token.
export async function initializeStore() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get(['user', 'accessToken'], async (result) => {
      if (result.user) {
        try {
          const user = JSON.parse(result.user as string)
          const store = useStore.getState()
          store.setUser(user, result.accessToken as string | undefined)

          if (result.accessToken) {
            try {
              const response = await fetch(`${DEFAULT_API_BASE}/auth/me`, {
                headers: { Authorization: `Bearer ${result.accessToken}` },
              })
              if (response.ok) {
                const data = await response.json()
                store.setPro(data.isPro || false)
              } else {
                store.logout()
              }
            } catch (e) {
              console.error('Failed to verify token:', e)
            }
          }
        } catch (e) {
          console.error('Failed to parse user:', e)
        }
      }
      resolve()
    })
  })
}
