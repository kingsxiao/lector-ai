import { create } from 'zustand'

interface AppState {
  usageCount: number
  isPro: boolean
  incrementUsage: () => void
  setPro: (value: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  usageCount: 0,
  isPro: false,
  incrementUsage: () => set((state) => ({ usageCount: state.usageCount + 1 })),
  setPro: (value: boolean) => set({ isPro: value }),
}))
