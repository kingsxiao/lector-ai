export const DEFAULT_API_BASE = 'https://lector-ai-two.vercel.app/api'

export function getApiBase(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['apiBase'], (result) => {
        resolve((result.apiBase as string) || DEFAULT_API_BASE)
      })
    } else {
      resolve(DEFAULT_API_BASE)
    }
  })
}
