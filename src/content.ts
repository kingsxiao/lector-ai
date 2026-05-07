console.log('Lector AI Content Script loaded on:', window.location.hostname)

let selectionToolbar: HTMLElement | null = null
let resultPopup: HTMLElement | null = null
let loadingPopup: HTMLElement | null = null

function injectStyles() {
  if (document.getElementById('lector-ai-styles')) return

  const style = document.createElement('style')
  style.id = 'lector-ai-styles'
  style.textContent = `
    @keyframes lectorFadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes lectorSpin {
      to { transform: rotate(360deg); }
    }
    #lector-ai-toolbar button {
      padding: 6px 12px; border: none; border-radius: 6px;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: all 0.15s ease; display: flex; align-items: center; gap: 4px;
    }
    #lector-ai-toolbar .translate-btn { background: white; color: #667eea; }
    #lector-ai-toolbar .translate-btn:hover { background: #f8fafc; transform: scale(1.05); }
    #lector-ai-toolbar .summary-btn { background: rgba(255,255,255,0.2); color: white; }
    #lector-ai-toolbar .summary-btn:hover { background: rgba(255,255,255,0.3); transform: scale(1.05); }
    #lector-ai-toolbar .close-btn { background: rgba(255,255,255,0.1); color: white; padding: 6px 8px; }
    #lector-ai-toolbar .close-btn:hover { background: rgba(255,255,255,0.25); }
    #lector-ai-result .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
    #lector-ai-result .result-title { font-size: 13px; font-weight: 700; color: #667eea; display: flex; align-items: center; gap: 6px; }
    #lector-ai-result .result-content { font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap; word-break: break-word; }
    #lector-ai-result .action-btn { flex: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    #lector-ai-result .action-btn.primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    #lector-ai-result .action-btn.primary:hover { transform: scale(1.02); box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
    #lector-ai-result .copy-btn { flex: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; background: #f1f5f9; color: #64748b; cursor: pointer; transition: all 0.15s ease; }
    #lector-ai-result .copy-btn:hover { background: #e2e8f0; }
  `
  document.head.appendChild(style)
}

injectStyles()

function createToolbar(x: number, y: number, text: string) {
  removeToolbar()
  
  selectionToolbar = document.createElement('div')
  selectionToolbar.id = 'lector-ai-toolbar'
  selectionToolbar.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y + 20}px;
    display: flex;
    gap: 6px;
    padding: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.2s ease-out;
  `

  const translateBtn = document.createElement('button')
  translateBtn.className = 'translate-btn'
  translateBtn.innerHTML = '🌐 翻译'
  translateBtn.onclick = (e) => {
    e.stopPropagation()
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      handleTranslate(text)
    } else {
      alert('扩展未正确加载，请刷新页面')
    }
  }
  
  const summaryBtn = document.createElement('button')
  summaryBtn.className = 'summary-btn'
  summaryBtn.innerHTML = '📄 摘要'
  summaryBtn.onclick = (e) => {
    e.stopPropagation()
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      handleSummarize(text)
    } else {
      alert('扩展未正确加载，请刷新页面')
    }
  }
  
  const closeBtn = document.createElement('button')
  closeBtn.className = 'close-btn'
  closeBtn.innerHTML = '✕'
  closeBtn.onclick = () => removeToolbar()
  
  selectionToolbar.appendChild(translateBtn)
  selectionToolbar.appendChild(summaryBtn)
  selectionToolbar.appendChild(closeBtn)
  
  document.body.appendChild(selectionToolbar)
}

function removeToolbar() {
  if (selectionToolbar) {
    selectionToolbar.remove()
    selectionToolbar = null
  }
}

function showLoading(x: number, y: number) {
  removeLoading()
  removeResult()
  
  loadingPopup = document.createElement('div')
  loadingPopup.id = 'lector-ai-loading'
  loadingPopup.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y + 20}px;
    padding: 12px 20px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #667eea;
  `
  
  const spinner = document.createElement('div')
  spinner.style.cssText = `
    width: 16px;
    height: 16px;
    border: 2px solid #e2e8f0;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: lectorSpin 0.8s linear infinite;
  `

  const text = document.createElement('span')
  text.textContent = 'AI 处理中...'
  
  loadingPopup.appendChild(spinner)
  loadingPopup.appendChild(text)
  document.body.appendChild(loadingPopup)
}

function removeLoading() {
  if (loadingPopup) {
    loadingPopup.remove()
    loadingPopup = null
  }
}

function showResult(x: number, y: number, result: string, type: 'translate' | 'summary') {
  removeLoading()
  removeResult()
  
  resultPopup = document.createElement('div')
  resultPopup.id = 'lector-ai-result'
  
  const maxHeight = window.innerHeight - y - 100
  resultPopup.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y + 20}px;
    max-width: 420px;
    max-height: ${Math.min(maxHeight, 500)}px;
    overflow-y: auto;
    padding: 16px;
    background: white;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.25s ease-out;
  `
  
  const header = document.createElement('div')
  header.className = 'result-header'
  
  const title = document.createElement('div')
  title.className = 'result-title'
  title.innerHTML = type === 'translate' ? '🌐 翻译结果' : '📄 摘要结果'
  
  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'padding: 4px 8px; border: none; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 11px; color: #94a3b8;'
  closeBtn.textContent = '关闭'
  closeBtn.onclick = () => removeResult()
  
  header.appendChild(title)
  header.appendChild(closeBtn)
  
  const content = document.createElement('div')
  content.className = 'result-content'
  content.textContent = result
  
  const footer = document.createElement('div')
  footer.style.cssText = 'margin-top: 12px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px;'
  
  const copyBtn = document.createElement('button')
  copyBtn.className = 'action-btn copy-btn'
  copyBtn.textContent = '📋 复制'
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(result)
    copyBtn.textContent = '✅ 已复制'
    setTimeout(() => copyBtn.textContent = '📋 复制', 1500)
  }
  
  const newTranslateBtn = document.createElement('button')
  newTranslateBtn.className = 'action-btn primary'
  newTranslateBtn.textContent = '🌐 再翻译一段'
  newTranslateBtn.onclick = () => {
    removeResult()
    removeToolbar()
  }
  
  footer.appendChild(copyBtn)
  footer.appendChild(newTranslateBtn)
  
  resultPopup.appendChild(header)
  resultPopup.appendChild(content)
  resultPopup.appendChild(footer)
  
  document.body.appendChild(resultPopup)
  
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside)
  }, 100)
}

function removeResult() {
  if (resultPopup) {
    resultPopup.remove()
    resultPopup = null
  }
  document.removeEventListener('click', handleClickOutside)
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (resultPopup && !resultPopup.contains(target)) {
    removeResult()
  }
  if (selectionToolbar && !selectionToolbar.contains(target)) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.toString().trim().length < 2) {
      removeToolbar()
    }
  }
}

function handleTranslate(text: string) {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('Chrome runtime not available')
    return
  }

  const rect = selectionToolbar?.getBoundingClientRect()
  showLoading(rect?.left || 100, rect?.top || 100)

  chrome.runtime.sendMessage(
    { action: 'translate', text, targetLang: '中文' },
    (response) => {
      try {
        removeLoading()

        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError)
          const errRect = selectionToolbar?.getBoundingClientRect()
          showResult(errRect?.left || 100, errRect?.top || 100, '扩展已更新，请刷新页面重试', 'translate')
          return
        }

        if (response && response.error) {
          console.error('Translate error:', response.error)
          const errRect = selectionToolbar?.getBoundingClientRect()
          showResult(errRect?.left || 100, errRect?.top || 100, `翻译失败: ${response.error}`, 'translate')
          return
        }

        const resultRect = selectionToolbar?.getBoundingClientRect()
        showResult(
          resultRect?.left || 100,
          resultRect?.top || 100,
          response?.translatedText || '翻译结果',
          'translate'
        )
      } catch (e) {
        console.error('Error in translate callback:', e)
        removeLoading()
      }
    }
  )
}

function handleSummarize(text: string) {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('Chrome runtime not available')
    return
  }

  const rect = selectionToolbar?.getBoundingClientRect()
  showLoading(rect?.left || 100, rect?.top || 100)

  chrome.runtime.sendMessage(
    { action: 'summarize', text },
    (response) => {
      try {
        removeLoading()

        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError)
          const errRect = selectionToolbar?.getBoundingClientRect()
          showResult(errRect?.left || 100, errRect?.top || 100, '扩展已更新，请刷新页面重试', 'summary')
          return
        }

        if (response && response.error) {
          console.error('Summary error:', response.error)
          const errRect = selectionToolbar?.getBoundingClientRect()
          showResult(errRect?.left || 100, errRect?.top || 100, `摘要失败: ${response.error}`, 'summary')
          return
        }

        const result = response?.summary || '暂无摘要'
        const resultRect = selectionToolbar?.getBoundingClientRect()
        showResult(
          resultRect?.left || 100,
          resultRect?.top || 100,
          result,
          'summary'
        )
      } catch (e) {
        console.error('Error in summary callback:', e)
        removeLoading()
      }
    }
  )
}

document.addEventListener('mouseup', (e) => {
  const target = e.target as HTMLElement
  
  if (target.closest('#lector-ai-toolbar') || 
      target.closest('#lector-ai-result') ||
      target.closest('#lector-ai-loading')) {
    return
  }
  
  setTimeout(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      return
    }
    
    const selectedText = selection.toString().trim()
    
    if (selectedText.length < 2 || selectedText.length > 5000) {
      removeToolbar()
      return
    }
    
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const x = Math.max(10, Math.min(rect.left, window.innerWidth - 200))
    const y = rect.bottom + window.scrollY
    
    createToolbar(x, y, selectedText)
  }, 100)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removeToolbar()
    removeResult()
  }
})

document.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement
  if (!target.closest('#lector-ai-toolbar') && 
      !target.closest('#lector-ai-result') &&
      !target.closest('#lector-ai-loading')) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      removeToolbar()
    }
  }
})
