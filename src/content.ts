// Content Script for Lector AI
// Handles DOM interactions like text selection, translation highlights, etc.

// Listen for messages from background or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showTranslation') {
    showTranslationPopup(message.text, message.translatedText, message.x, message.y)
  }
  
  if (message.action === 'showSummary') {
    showSummaryPopup(message.summary, message.x, message.y)
  }
})

// Create floating translation/summary popup
function createPopup(content: string, x: number, y: number): HTMLElement {
  // Remove existing popup if any
  const existing = document.getElementById('lector-ai-popup')
  if (existing) existing.remove()
  
  const popup = document.createElement('div')
  popup.id = 'lector-ai-popup'
  popup.className = 'lector-ai-popup'
  popup.textContent = content
  popup.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    padding: 16px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 999999;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
  `
  
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closePopup(e) {
      if (!popup.contains(e.target as Node)) {
        popup.remove()
        document.removeEventListener('click', closePopup)
      }
    })
  }, 100)
  
  // Close on escape
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      popup.remove()
      document.removeEventListener('keydown', closeOnEscape)
    }
  }
  document.addEventListener('keydown', closeOnEscape)
  
  document.body.appendChild(popup)
  return popup
}

function showTranslationPopup(original: string, translated: string, x: number, y: number) {
  const content = `${translated}\n\n---\n原文: ${original}`
  createPopup(content, x, y)
}

function showSummaryPopup(summary: string, x: number, y: number) {
  createPopup(summary, x, y)
}

// Handle text selection for translation
document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  
  const selectedText = selection.toString().trim()
  if (selectedText.length < 2 || selectedText.length > 5000) return
  
  // Could trigger translation here or show a small tooltip
  // For now we let the user right-click to translate
})
