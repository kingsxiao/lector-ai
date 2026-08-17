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
