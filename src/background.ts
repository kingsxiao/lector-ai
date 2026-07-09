// Lector AI background service worker.
//
// Responsibilities (minimal in the BYOK model):
//   - Register context-menu entries that seed the side panel.
//   - Open the side panel on demand (from the FAB, action icon, or menus).
// All AI calls happen client-side (content script or side panel) using the
// user's own key — there is no backend.

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')

  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {})
  }

  const menus: { id: string; title: string }[] = [
    { id: 'lector-summarize', title: 'Summarize with Lector AI' },
    { id: 'lector-translate', title: 'Translate with Lector AI' },
    { id: 'lector-explain', title: 'Explain with Lector AI' },
    { id: 'lector-ask', title: 'Ask Lector AI about this…' },
  ]
  menus.forEach((m) => {
    chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ['selection'] })
  })
})

// Open the side panel from the FAB / popup / content script.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'open-side-panel') {
    openSidePanel(message.seed || null)
  }
})

async function openSidePanel(seed: { kind: string; text: string } | null) {
  if (seed) {
    await chrome.storage.local.set({ lectorSeed: seed })
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.windowId !== undefined && chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
}

// Context-menu clicks seed the side panel (translate/summarize/explain/ask).
chrome.contextMenus.onClicked.addListener((info) => {
  if (!info.selectionText) return
  const map: Record<string, string> = {
    'lector-summarize': 'summarize',
    'lector-translate': 'translate',
    'lector-explain': 'explain',
    'lector-ask': 'ask',
  }
  const kind = map[info.menuItemId as string]
  if (kind) {
    openSidePanel({ kind, text: info.selectionText })
  }
})
