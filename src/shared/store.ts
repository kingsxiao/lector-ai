import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  email: string
}

interface AppState {
  // 用户认证
  user: User | null
  accessToken: string | null
  isPro: boolean
  isLoading: boolean
  
  // 用量
  usageCount: number
  
  // 操作
  setUser: (user: User | null, accessToken?: string | null) => void
  setPro: (value: boolean) => void
  setLoading: (value: boolean) => void
  incrementUsage: () => void
  logout: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isPro: false,
      isLoading: false,
      usageCount: 0,
      
      setUser: (user, accessToken = null) => {
        set({ user, accessToken })
        // 保存到 chrome storage
        if (user) {
          chrome.storage.local.set({ 
            user: JSON.stringify(user),
            accessToken 
          })
        } else {
          chrome.storage.local.remove(['user', 'accessToken'])
        }
      },
      
      setPro: (value: boolean) => set({ isPro: value }),
      
      setLoading: (value: boolean) => set({ isLoading: value }),
      
      incrementUsage: () => {
        const state = get()
        // Pro 用户不限制用量
        if (state.isPro) return
        set((state) => ({ usageCount: state.usageCount + 1 }))
      },
      
      logout: () => {
        set({ user: null, accessToken: null, isPro: false, usageCount: 0 })
        chrome.storage.local.remove(['user', 'accessToken'])
      }
    }),
    {
      name: 'lector-ai-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isPro: state.isPro,
        usageCount: state.usageCount,
      }),
    }
  )
)

// 初始化时从 chrome storage 恢复状态
export async function initializeStore() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get(['user', 'accessToken'], async (result) => {
      if (result.user) {
        try {
          const user = JSON.parse(result.user)
          const store = useStore.getState()
          store.setUser(user, result.accessToken)
          
          // 验证 token 是否有效
          if (result.accessToken) {
            try {
              const response = await fetch(`${import.meta.env.VITE_API_BASE || 'https://your-app.vercel.app/api'}/auth/me`, {
                headers: {
                  'Authorization': `Bearer ${result.accessToken}`
                }
              })
              
              if (response.ok) {
                const data = await response.json()
                store.setPro(data.isPro || false)
              } else {
                // Token 无效，清除登录状态
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
