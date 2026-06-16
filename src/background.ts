import { getApiBase } from './shared/config'

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')

  // Allow "sidePanel" globally so we can open it on demand.
  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {})
  }

  chrome.contextMenus.create({
    id: 'summarize-selection',
    title: 'Summarize with Lector AI',
    contexts: ['selection'],
  })

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate with Lector AI',
    contexts: ['selection'],
  })

  chrome.contextMenus.create({
    id: 'explain-selection',
    title: 'Explain with Lector AI',
    contexts: ['selection'],
  })
})

// Open the side panel from the action icon, and relay knowledge-capture
// messages (highlight / save-word) from the content script into chrome.storage
// so the side panel can sync them into its zustand store.
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message?.action === 'open-side-panel') {
    openSidePanel(message.seed || null)
    return false
  }
  if (message?.action === 'lector-highlight') {
    chrome.storage.local.get(['lectorHighlights'], (r) => {
      const list = Array.isArray(r.lectorHighlights) ? r.lectorHighlights : []
      list.unshift(message.highlight)
      chrome.storage.local.set({ lectorHighlights: list.slice(0, 500) })
    })
    return false
  }
  if (message?.action === 'lector-save-word') {
    handleSaveWordRelay(message).catch(() => {})
    return false
  }
  return false
})

// Keyboard commands → forward to the active tab's content script.
chrome.commands?.onCommand.addListener((cmd) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId === undefined) return
    chrome.tabs.sendMessage(tabId, { action: 'lector-command', command: cmd }, () => {
      void chrome.runtime.lastError
    })
  })
})

async function handleSaveWordRelay(message: {
  word: string
  context: string
  url: string
  title: string
  blockId?: string
}) {
  const apiBase = await getApiBase()
  let translation = ''
  try {
    const res = await fetch(`${apiBase}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message.word, targetLang: '中文' }),
    })
    if (res.ok) translation = (await res.json()).translatedText || ''
  } catch {
    // leave translation empty; flagged at review time
  }
  const entry = {
    id: 'v' + Date.now().toString(36),
    word: message.word,
    translation,
    context: message.context,
    url: message.url,
    title: message.title,
    lang: 'en',
    blockId: message.blockId,
    createdAt: Date.now(),
    srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  }
  chrome.storage.local.get(['lectorVocab'], (r) => {
    const list: Array<{ word: string; srs: { interval: number; ease: number; reps: number; lapses: number; due: number }; createdAt: number; context: string; translation: string }> =
      Array.isArray(r.lectorVocab) ? r.lectorVocab : []
    const idx = list.findIndex((x) => x.word.toLowerCase() === entry.word.toLowerCase())
    if (idx === -1) {
      list.unshift(entry)
    } else {
      const existing = list[idx]
      list[idx] = {
        ...existing,
        context: entry.context || existing.context,
        translation: entry.translation || existing.translation,
        createdAt: Math.min(existing.createdAt, entry.createdAt),
        srs: existing.srs,
      }
    }
    chrome.storage.local.set({ lectorVocab: list.slice(0, 2000) })
  })
}

async function openSidePanel(seed: { kind: string; text: string } | null) {
  // Stash the seed so the side panel can read it after it opens.
  if (seed) {
    await chrome.storage.local.set({ lectorSeed: seed })
  }
  // Find the active tab and open the panel for it.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.windowId !== undefined && chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
}

chrome.contextMenus.onClicked.addListener((itemData) => {
  if (itemData.selectionText) {
    if (itemData.menuItemId === 'summarize-selection') {
      handleSummarize(itemData.selectionText).then((r) =>
        chrome.runtime.sendMessage({ action: 'summary-result', ...r }).catch(() => {})
      )
    } else if (itemData.menuItemId === 'translate-selection') {
      handleTranslate(itemData.selectionText).then((r) =>
        chrome.runtime.sendMessage({ action: 'translate-result', ...r }).catch(() => {})
      )
    } else if (itemData.menuItemId === 'explain-selection') {
      handleExplain(itemData.selectionText).then((r) =>
        chrome.runtime.sendMessage({ action: 'explain-result', ...r }).catch(() => {})
      )
    }
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'summarize') {
    handleSummarize(message.text).then(sendResponse)
    return true
  }
  if (message.action === 'translate') {
    handleTranslate(message.text, message.targetLang).then(sendResponse)
    return true
  }
  if (message.action === 'explain') {
    handleExplain(message.text).then(sendResponse)
    return true
  }
  return false
})

async function handleSummarize(text: string) {
  try {
    const apiBase = await getApiBase()
    const response = await fetch(`${apiBase}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style: 'brief' }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`)
    }
    return await response.json()
  } catch (error) {
    console.error('Summarize error:', error)
    return { error: error instanceof Error ? error.message : 'Failed to summarize' }
  }
}

async function handleTranslate(text: string, targetLang: string = '中文') {
  try {
    const apiBase = await getApiBase()
    const response = await fetch(`${apiBase}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`)
    }
    return await response.json()
  } catch (error) {
    console.error('Translate error:', error)
    return { error: error instanceof Error ? error.message : 'Failed to translate' }
  }
}

async function handleExplain(text: string) {
  try {
    const apiBase = await getApiBase()
    const response = await fetch(`${apiBase}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Explain this clearly in a few sentences, then give one concrete example:\n\n${text}` }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`)
    }
    // The chat endpoint streams; for the inline toolbar popup we just grab the
    // full text by reading SSE events.
    const explanation = await readSseToText(response)
    return { explanation }
  } catch (error) {
    console.error('Explain error:', error)
    return { error: error instanceof Error ? error.message : 'Failed to explain' }
  }
}

async function readSseToText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return out
      try {
        const json = JSON.parse(payload)
        if (json.type === 'token' && typeof json.delta === 'string') out += json.delta
        if (json.type === 'error') throw new Error(json.error || 'AI_SERVICE_ERROR')
      } catch (e) {
        if (e instanceof Error && e.message === 'AI_SERVICE_ERROR') throw e
      }
    }
  }
  return out
}
