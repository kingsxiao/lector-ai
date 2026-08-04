import { useEffect, useState } from 'react'

/**
 * Ask the active tab's content script to scroll to a citation block.
 * Replaces the two inline copies in App.tsx (onViewSource + CitationContent).
 * Behavior-identical: query active tab, send lector-jump-to, swallow lastError.
 */
export async function jumpToBlock(blockId: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  chrome.tabs.sendMessage(tab.id, { action: 'lector-jump-to', blockId }, () => {
    void chrome.runtime.lastError
  })
}

/**
 * React hook returning the active tab's hostname ('' until resolved).
 * Consolidates the two independent chrome.tabs.query sites that each computed
 * currentHost separately. Added as a module helper; full adoption deferred.
 */
export function useCurrentHost(): string {
  const [host, setHost] = useState('')
  useEffect(() => {
    let cancelled = false
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (!url) return
      try {
        const h = new URL(url).hostname
        if (!cancelled) setHost(h)
      } catch {
        /* invalid url — leave host empty */
      }
    })
    return () => { cancelled = true }
  }, [])
  return host
}
