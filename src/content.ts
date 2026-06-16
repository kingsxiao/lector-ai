// Lector AI content script.
//
// Responsibilities:
//   1. Clean page extraction (a tiny Readability-like heuristic) → feeds the
//      side panel's "chat with this page".
//   2. Selection toolbar: translate / summarize / explain / ask.
//   3. Floating "Open Lector" button to summon the side panel.
//   4. Inline bilingual paragraph translation (Immersive-Translate style).

console.log('Lector AI Content Script loaded on:', window.location.hostname)

let selectionToolbar: HTMLElement | null = null
let resultPopup: HTMLElement | null = null
let loadingPopup: HTMLElement | null = null
let fab: HTMLElement | null = null

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
function injectStyles() {
  if (document.getElementById('lector-ai-styles')) return

  const style = document.createElement('style')
  style.id = 'lector-ai-styles'
  style.textContent = `
    @keyframes lectorFadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes lectorSpin { to { transform: rotate(360deg); } }
    @keyframes lectorFabPulse { 0%,100%{ box-shadow: 0 6px 20px rgba(102,126,234,.35);} 50%{ box-shadow: 0 6px 28px rgba(118,75,162,.55);} }
    #lector-ai-fab { position: fixed; right: 20px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; cursor: pointer; z-index: 2147483646; box-shadow: 0 6px 20px rgba(102,126,234,.35); animation: lectorFabPulse 3s ease-in-out infinite; transition: transform .15s ease; user-select: none; }
    #lector-ai-fab:hover { transform: scale(1.08); }
    #lector-ai-toolbar button { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s ease; display: flex; align-items: center; gap: 4px; }
    #lector-ai-toolbar .t-btn { background: #fff; color: #667eea; }
    #lector-ai-toolbar .t-btn:hover { background: #f8fafc; transform: scale(1.05); }
    #lector-ai-toolbar .summary-btn { background: rgba(255,255,255,.2); color: #fff; }
    #lector-ai-toolbar .summary-btn:hover { background: rgba(255,255,255,.3); transform: scale(1.05); }
    #lector-ai-toolbar .close-btn { background: rgba(255,255,255,.1); color: #fff; padding: 6px 8px; }
    #lector-ai-toolbar .close-btn:hover { background: rgba(255,255,255,.25); }
    #lector-ai-result .result-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #e2e8f0; }
    #lector-ai-result .result-title { font-size:13px; font-weight:700; color:#667eea; display:flex; align-items:center; gap:6px; }
    #lector-ai-result .result-content { font-size:13px; line-height:1.7; color:#334155; white-space:pre-wrap; word-break:break-word; }
    #lector-ai-result .result-content p { margin: 0 0 8px; }
    #lector-ai-result .action-btn { flex:1; padding:8px 12px; border:none; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; transition:all .15s ease; }
    #lector-ai-result .action-btn.primary { background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:#fff; }
    #lector-ai-result .action-btn.primary:hover { transform:scale(1.02); box-shadow:0 4px 12px rgba(102,126,234,.3); }
    #lector-ai-result .copy-btn { flex:1; padding:8px 12px; border:none; border-radius:8px; font-size:12px; font-weight:600; background:#f1f5f9; color:#64748b; cursor:pointer; transition:all .15s ease; }
    #lector-ai-result .copy-btn:hover { background:#e2e8f0; }
    .lector-bilingual { font-size:.9em; color:#475569; border-left:3px solid #c7d2fe; padding:2px 0 2px 10px; margin:6px 0 6px 4px; }
  `
  document.head.appendChild(style)
}

injectStyles()

// ---------------------------------------------------------------------------
// Page extraction — pick the densest article-like container and strip noise.
// ---------------------------------------------------------------------------

const NOISE_SELECTORS = [
  'header', 'footer', 'nav', 'aside', 'form', 'iframe',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.advertisement', '.ads', '.ad', '.share', '.social', '.newsletter',
  '.related', '.comments', '.comment', '.sidebar', '.cookie',
]

function scoreNode(el: Element): number {
  const text = (el.textContent || '').trim()
  if (!text) return 0
  const commas = (text.match(/[,.，。、；:;?!]/g) || []).length
  const links = el.querySelectorAll('a').length
  // Penalize link-heavy nodes (nav-like); reward long, comma-rich text.
  const linkDensity = links / Math.max(1, text.split(/\s+/).length)
  return text.length + commas * 8 - linkDensity * 200
}

export interface ExtractedPageBlock {
  id: string
  text: string
  domSelector: string
}

export interface ExtractedPage {
  title: string
  url: string
  byline: string | null
  text: string
  /** Best-effort language tag (e.g. "en", "zh") for the bilingual feature. */
  lang: string
  /** Block-level anchors (Feature ①) for citation grounding + jump-to. */
  blocks: ExtractedPageBlock[]
}

function detectLang(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh'
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  return 'en'
}

export function extractPage(): ExtractedPage {
  const candidates = document.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div')

  let best: Element | null = null
  let bestScore = 0
  candidates.forEach((el) => {
    if (el === document.body) return
    const s = scoreNode(el)
    if (s > bestScore) {
      bestScore = s
      best = el
    }
  })

  const root: Element = best || document.body

  // Clone before stripping so we don't mutate the live page.
  const clone = root.cloneNode(true) as Element
  NOISE_SELECTORS.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((n) => n.remove())
  })

  // Collect paragraph-ish text preserving some structure, tagging the LIVE DOM
  // nodes with stable ids so citations (Feature ①) can jump back to them.
  const pageBlocks: ExtractedPageBlock[] = []
  const textParts: string[] = []
  const liveNodes = root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')
  liveNodes.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (t.length === 0) return
    const id = `b${pageBlocks.length}`
    try {
      ;(el as HTMLElement).setAttribute('data-lector-id', id)
    } catch {
      // some nodes reject setAttribute; skip tagging
    }
    pageBlocks.push({ id, text: t, domSelector: '' })
    textParts.push(t)
  })
  let text = textParts.join('\n\n')
  if (text.length < 200) {
    text = (clone.textContent || '').replace(/\s+/g, ' ').trim()
  }
  text = text.slice(0, 20000)

  const title =
    (document.querySelector('h1')?.textContent || '').trim() ||
    document.title ||
    ''

  const bylineMeta =
    document.querySelector('meta[name="author"]') ||
    document.querySelector('meta[property="article:author"]')

  return {
    title,
    url: location.href,
    byline: bylineMeta?.getAttribute('content') || null,
    text,
    lang: detectLang(text),
    blocks: pageBlocks,
  }
}

// ---------------------------------------------------------------------------
// Floating action button → open the side panel
// ---------------------------------------------------------------------------
function ensureFab() {
  if (fab) return
  fab = document.createElement('div')
  fab.id = 'lector-ai-fab'
  fab.title = 'Open Lector AI'
  fab.textContent = 'L'
  fab.onclick = () => {
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
  }
  document.body.appendChild(fab)
}

ensureFab()

// ---------------------------------------------------------------------------
// Selection toolbar
// ---------------------------------------------------------------------------
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
    box-shadow: 0 4px 20px rgba(0,0,0,.25);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .2s ease-out;
  `

  const mk = (cls: string, html: string, fn: () => void) => {
    const b = document.createElement('button')
    b.className = cls
    b.innerHTML = html
    b.onclick = (e) => {
      e.stopPropagation()
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        alert('扩展未正确加载，请刷新页面')
        return
      }
      fn()
    }
    return b
  }

  selectionToolbar.appendChild(mk('t-btn', '🌐 翻译', () => handleAction('translate', text)))
  selectionToolbar.appendChild(mk('t-btn', '💬 解释', () => handleAction('explain', text)))
  selectionToolbar.appendChild(mk('summary-btn', '📄 摘要', () => handleAction('summarize', text)))
  selectionToolbar.appendChild(mk('t-btn', '🤖 提问', () => handleAction('ask', text)))
  selectionToolbar.appendChild(mk('t-btn', '🔖 高亮', () => handleHighlight(text)))
  selectionToolbar.appendChild(mk('t-btn', '★ 存词', () => handleSaveWord(text)))

  const closeBtn = document.createElement('button')
  closeBtn.className = 'close-btn'
  closeBtn.innerHTML = '✕'
  closeBtn.onclick = () => removeToolbar()
  selectionToolbar.appendChild(closeBtn)

  document.body.appendChild(selectionToolbar)
}

function removeToolbar() {
  if (selectionToolbar) {
    selectionToolbar.remove()
    selectionToolbar = null
  }
}

// ---------------------------------------------------------------------------
// Loading + result popups
// ---------------------------------------------------------------------------
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
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,.15);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #667eea;
  `

  const spinner = document.createElement('div')
  spinner.style.cssText = `
    width:16px;height:16px;border:2px solid #e2e8f0;border-top-color:#667eea;border-radius:50%;animation:lectorSpin .8s linear infinite;
  `
  const t = document.createElement('span')
  t.textContent = 'AI 处理中...'
  loadingPopup.appendChild(spinner)
  loadingPopup.appendChild(t)
  document.body.appendChild(loadingPopup)
}

function removeLoading() {
  if (loadingPopup) {
    loadingPopup.remove()
    loadingPopup = null
  }
}

function showResult(x: number, y: number, result: string, type: 'translate' | 'summary' | 'explain') {
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
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .25s ease-out;
  `

  const header = document.createElement('div')
  header.className = 'result-header'

  const title = document.createElement('div')
  title.className = 'result-title'
  const titleMap = { translate: '🌐 翻译结果', summary: '📄 摘要结果', explain: '💡 解释' }
  title.innerHTML = titleMap[type]

  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;'
  closeBtn.textContent = '关闭'
  closeBtn.onclick = () => removeResult()

  header.appendChild(title)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  content.textContent = result

  const footer = document.createElement('div')
  footer.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'action-btn copy-btn'
  copyBtn.textContent = '📋 复制'
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(result)
    copyBtn.textContent = '✅ 已复制'
    setTimeout(() => (copyBtn.textContent = '📋 复制'), 1500)
  }

  const chatBtn = document.createElement('button')
  chatBtn.className = 'action-btn primary'
  chatBtn.textContent = '🤖 在侧栏继续'
  chatBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: 'open-side-panel', seed: { kind: type, text: result } }).catch(() => {})
    removeResult()
    removeToolbar()
  }

  footer.appendChild(copyBtn)
  footer.appendChild(chatBtn)

  resultPopup.appendChild(header)
  resultPopup.appendChild(content)
  resultPopup.appendChild(footer)

  document.body.appendChild(resultPopup)
  setTimeout(() => document.addEventListener('click', handleClickOutside), 100)
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
  if (resultPopup && !resultPopup.contains(target)) removeResult()
  if (selectionToolbar && !selectionToolbar.contains(target)) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) removeToolbar()
  }
}

// ---------------------------------------------------------------------------
// Actions dispatched to the background worker
// ---------------------------------------------------------------------------
function handleAction(kind: 'translate' | 'summarize' | 'explain' | 'ask', text: string) {
  if (typeof chrome === 'undefined' || !chrome.runtime) return

  const rect = selectionToolbar?.getBoundingClientRect()
  showLoading(rect?.left || 100, rect?.top || 100)

  if (kind === 'ask') {
    // Send the selection to the side panel as a seed question.
    chrome.runtime
      .sendMessage({ action: 'open-side-panel', seed: { kind: 'ask', text } })
      .catch(() => {})
    removeLoading()
    removeToolbar()
    return
  }

  const message =
    kind === 'translate'
      ? { action: 'translate', text }
      : kind === 'summarize'
        ? { action: 'summarize', text }
        : { action: 'explain', text }

  chrome.runtime.sendMessage(message, (response) => {
    try {
      removeLoading()
      if (chrome.runtime.lastError) {
        const r = selectionToolbar?.getBoundingClientRect()
        showResult(r?.left || 100, r?.top || 100, '扩展已更新，请刷新页面重试', 'translate')
        return
      }
      if (response && response.error) {
        const r = selectionToolbar?.getBoundingClientRect()
        showResult(r?.left || 100, r?.top || 100, `失败: ${response.error}`, 'translate')
        return
      }
      const r = selectionToolbar?.getBoundingClientRect()
      const out =
        kind === 'translate'
          ? response?.translatedText || '翻译结果'
          : kind === 'summarize'
            ? response?.summary || '暂无摘要'
            : response?.explanation || '暂无解释'
      showResult(r?.left || 100, r?.top || 100, out, kind === 'summarize' ? 'summary' : kind === 'translate' ? 'translate' : 'explain')
    } catch (e) {
      console.error('Lector callback error:', e)
      removeLoading()
    }
  })
}

// ---------------------------------------------------------------------------
// Highlight capture (Feature ②) and vocabulary save (Feature ③)
// ---------------------------------------------------------------------------
function handleHighlight(text: string) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) {
    removeToolbar()
    return
  }
  const range = sel.getRangeAt(0)
  let blockId: string | undefined
  let context = text.slice(0, 200)
  let marked = false
  try {
    // Wrap the range in a mark node without disturbing the DOM structure.
    const mark = document.createElement('mark')
    mark.className = 'lector-hl'
    mark.title = 'Lector highlight'
    range.surroundContents(mark)
    marked = true
    const block = mark.closest('[data-lector-id]') as HTMLElement | null
    blockId = block?.getAttribute('data-lector-id') || undefined
    context = (mark.parentElement?.textContent || text).slice(0, 200)
  } catch {
    // surroundContents fails on multi-node ranges; fall back to text-only.
  }
  chrome.runtime
    .sendMessage({
      action: 'lector-highlight',
      highlight: {
        id: 'h' + Date.now().toString(36),
        text,
        note: '',
        quote: context,
        url: location.href,
        title: document.title,
        blockId,
        createdAt: Date.now(),
        color: 'yellow' as const,
        marked,
      },
    })
    .catch(() => {})
  removeToolbar()
}

function handleSaveWord(word: string) {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode?.parentElement
  const block = anchor?.closest('[data-lector-id]') as HTMLElement | null
  const blockId = block?.getAttribute('data-lector-id') || undefined
  const context = (anchor?.textContent || word).slice(0, 160)
  chrome.runtime
    .sendMessage({
      action: 'lector-save-word',
      word,
      context,
      url: location.href,
      title: document.title,
      blockId,
    })
    .catch(() => {})
  removeToolbar()
}

// ---------------------------------------------------------------------------
// Inline bilingual translation (Immersive-Translate style)
// ---------------------------------------------------------------------------
const translatedSet = new WeakSet<HTMLElement>()

async function toggleBilingual() {
  const page = extractPage()
  const targetLang = page.lang === 'zh' ? 'English' : '中文'

  // Collect paragraph blocks we haven't translated yet.
  const blocks = Array.from(document.querySelectorAll('p, li, blockquote'))
    .filter((el) => {
      const t = (el.textContent || '').trim()
      return t.length >= 20 && t.length <= 600 && !translatedSet.has(el as HTMLElement) && !el.closest('#lector-ai-result')
    })
    .slice(0, 30) as HTMLElement[]

  if (blocks.length === 0) return

  const apiBase = await getApiBaseLocal()
  for (const block of blocks) {
    const original = (block.textContent || '').trim()
    try {
      const res = await fetch(`${apiBase}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang, bilingual: true }),
      })
      if (!res.ok) continue
      const data = await res.json()
      const translated = data.translatedText as string
      const span = document.createElement('div')
      span.className = 'lector-bilingual'
      span.textContent = translated
      block.appendChild(span)
      translatedSet.add(block)
    } catch {
      // best-effort; skip on error
    }
  }
}

async function getApiBaseLocal(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['apiBase'], (r) => resolve((r.apiBase as string) || 'https://lector-ai-two.vercel.app/api'))
    } else {
      resolve('https://lector-ai-two.vercel.app/api')
    }
  })
}

// ---------------------------------------------------------------------------
// Listeners: selection → toolbar, Escape, side-panel messages
// ---------------------------------------------------------------------------
document.addEventListener('mouseup', (e) => {
  const target = e.target as HTMLElement
  if (
    target.closest('#lector-ai-toolbar') ||
    target.closest('#lector-ai-result') ||
    target.closest('#lector-ai-loading') ||
    target.closest('#lector-ai-fab')
  ) {
    return
  }

  setTimeout(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (text.length < 2 || text.length > 5000) {
      removeToolbar()
      return
    }
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const x = Math.max(10, Math.min(rect.left, window.innerWidth - 280))
    const y = rect.bottom + window.scrollY
    createToolbar(x, y, text)
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
  if (
    !target.closest('#lector-ai-toolbar') &&
    !target.closest('#lector-ai-result') &&
    !target.closest('#lector-ai-loading') &&
    !target.closest('#lector-ai-fab')
  ) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) removeToolbar()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'lector-get-page') {
    const page = extractPage()
    sendResponse({ page })
    return false
  }
  if (message?.action === 'lector-toggle-bilingual') {
    toggleBilingual().then(() => sendResponse({ ok: true }))
    return true
  }
  if (message?.action === 'lector-jump-to') {
    const node = document.querySelector<HTMLElement>(`[data-lector-id="${message.blockId}"]`)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      node.classList.add('lector-pulse')
      setTimeout(() => node.classList.remove('lector-pulse'), 2000)
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, reason: 'node-unavailable' })
    }
    return false
  }
  if (message?.action === 'lector-command') {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    if (text.length > 0) {
      if (message.command === 'highlight-selection') handleHighlight(text)
      else if (message.command === 'save-word') handleSaveWord(text)
    }
    return false
  }
  return false
})
