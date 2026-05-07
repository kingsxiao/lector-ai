import { getApiBase } from './shared/config'

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')
  
  chrome.contextMenus.create({
    id: 'summarize-selection',
    title: 'Summarize with Lector AI',
    contexts: ['selection']
  })
  
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate with Lector AI',
    contexts: ['selection']
  })
})

chrome.contextMenus.onClicked.addListener((itemData) => {
  if (itemData.menuItemId === 'summarize-selection' && itemData.selectionText) {
    handleSummarize(itemData.selectionText).then(result => {
      chrome.runtime.sendMessage({ action: 'summary-result', ...result }).catch(() => {})
    })
  }
  
  if (itemData.menuItemId === 'translate-selection' && itemData.selectionText) {
    handleTranslate(itemData.selectionText).then(result => {
      chrome.runtime.sendMessage({ action: 'translate-result', ...result }).catch(() => {})
    })
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
  
  return false
})

async function handleSummarize(text: string) {
  try {
    const apiBase = await getApiBase()
    const response = await fetch(`${apiBase}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
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
      body: JSON.stringify({ text, targetLang })
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
