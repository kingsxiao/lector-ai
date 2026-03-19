// Background Service Worker for Lector AI
// Handles API calls and context menu actions

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')
  
  // Create context menu for quick actions
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

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((itemData, tab) => {
  if (itemData.menuItemId === 'summarize-selection' && itemData.selectionText) {
    // Send selection to popup or process directly
    chrome.runtime.sendMessage({
      action: 'summarize',
      text: itemData.selectionText
    })
  }
  
  if (itemData.menuItemId === 'translate-selection' && itemData.selectionText) {
    chrome.runtime.sendMessage({
      action: 'translate',
      text: itemData.selectionText
    })
  }
})

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    // Handle summarize action
    handleSummarize(message.text).then(sendResponse)
    return true // Keep channel open for async response
  }
  
  if (message.action === 'translate') {
    handleTranslate(message.text, message.targetLang).then(sendResponse)
    return true
  }
})

async function handleSummarize(text: string) {
  try {
    const response = await fetch('https://your-app.vercel.app/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    
    return await response.json()
  } catch (error) {
    console.error('Summarize error:', error)
    return { error: 'Failed to summarize' }
  }
}

async function handleTranslate(text: string, targetLang: string = 'en') {
  try {
    const response = await fetch('https://your-app.vercel.app/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang })
    })
    
    return await response.json()
  } catch (error) {
    console.error('Translate error:', error)
    return { error: 'Failed to translate' }
  }
}
