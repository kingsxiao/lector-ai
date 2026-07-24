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
    @keyframes lectorFadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes lectorSpin { to { transform: rotate(360deg); } }
    @keyframes lectorFabPulse { 0%,100%{ box-shadow: 0 6px 20px rgba(156,107,60,.32);} 50%{ box-shadow: 0 8px 28px rgba(135,90,47,.5);} }
    #lector-ai-fab { position: fixed; right: 20px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%; background: #9C6B3C; color: #FFF8EE; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; font-family: Georgia, 'Iowan Old Style', 'Source Serif Pro', serif; cursor: pointer; z-index: 2147483646; box-shadow: 0 6px 20px rgba(156,107,60,.32); animation: lectorFabPulse 3s ease-in-out infinite; transition: transform .18s cubic-bezier(0.16,1,0.3,1), background-color .15s ease; user-select: none; }
    #lector-ai-fab:hover { transform: scale(1.08); background: #875A2F; }
    #lector-ai-toolbar { display: flex; align-items: center; gap: 2px; padding: 5px 8px; border-radius: 999px; }
    #lector-ai-toolbar .t-btn { width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; background: transparent; color: #6B6155; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background-color .15s ease, color .15s ease, transform .1s ease; }
    #lector-ai-toolbar .t-btn svg { width: 16px; height: 16px; display: block; }
    #lector-ai-toolbar .t-btn:hover { background: rgba(156,107,60,.12); color: #9C6B3C; }
    #lector-ai-toolbar .t-btn:active { transform: translateY(1px); }
    #lector-ai-toolbar .t-divider { width: 1px; height: 18px; margin: 0 3px; background: currentColor; opacity: .15; flex: none; }
    #lector-ai-toolbar.is-dark .t-btn { color: rgba(255,255,255,.8); }
    #lector-ai-toolbar.is-dark .t-btn:hover { background: rgba(255,255,255,.12); color: #FFF8EE; }
    #lector-ai-result .result-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #E8DECC; }
    #lector-ai-result .result-title { font-size:13px; font-weight:700; color:#9C6B3C; display:flex; align-items:center; gap:6px; }
    #lector-ai-result .result-content { font-size:13px; line-height:1.7; color:#2B2620; white-space:pre-wrap; word-break:break-word; }
    #lector-ai-result .result-content p { margin: 0 0 8px; }
    #lector-ai-result .action-btn { flex:1; padding:8px 12px; border:none; border-radius:10px; font-size:12px; font-weight:600; cursor:pointer; transition:background-color .15s ease, box-shadow .15s ease, transform .1s ease; }
    #lector-ai-result .action-btn:active { transform: translateY(1px); }
    #lector-ai-result .action-btn.primary { background:#9C6B3C; color:#FFF8EE; }
    #lector-ai-result .action-btn.primary:hover { background:#875A2F; box-shadow:0 4px 12px rgba(156,107,60,.3); }
    #lector-ai-result .copy-btn { flex:1; padding:8px 12px; border:none; border-radius:10px; font-size:12px; font-weight:600; background:#F5EFE3; color:#6B6155; cursor:pointer; transition:background-color .15s ease, transform .1s ease; }
    #lector-ai-result .copy-btn:active { transform: translateY(1px); }
    #lector-ai-result .copy-btn:hover { background:#E8DECC; }
    .lector-bilingual { font-size:.92em; line-height:1.6; color:#6B6155; border-left:3px solid #9C6B3C; padding:4px 0 4px 12px; margin:8px 0 8px 4px; border-radius:0 3px 3px 0; position:relative; transition:opacity .2s ease; }
    .lector-bilingual.is-loading { opacity:.6; }
    .lector-bilingual.is-error { border-left-color:#c0392b; color:#c0392b; }
    .lector-bi-caret { display:inline-block; width:2px; height:1em; background:#9C6B3C; vertical-align:text-bottom; margin-left:1px; animation:lectorBlink 1s steps(2) infinite; }
    @keyframes lectorBlink { 50% { opacity:0; } }
    .lector-bi-actions { position:absolute; right:6px; top:-10px; display:none; gap:4px; background:#FFF8EE; border:1px solid #E8DECC; border-radius:6px; padding:2px 4px; box-shadow:0 2px 8px rgba(0,0,0,.1); z-index:1; }
    .lector-bilingual:hover .lector-bi-actions { display:flex; }
    .lector-bi-actions button { border:none; background:transparent; color:#9C6B3C; cursor:pointer; font-size:11px; padding:2px 4px; border-radius:4px; }
    .lector-bi-actions button:hover { background:rgba(156,107,60,.12); }
    /* display modes (toggled via body class set by content script) */
    body.lector-dm-translationOnly .lector-bi-source { display:none !important; }
    body.lector-dm-hover .lector-bilingual { display:none; }
    body.lector-dm-hover .lector-bilingual-host:hover .lector-bilingual { display:block; }
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
  fab.title = t('fab.title', 'auto')
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
// Inline SVG icons for the selection toolbar. stroke=currentColor so the
// icon inherits the button's text color; 16px rendered (set on the <svg> in markup).
const TOOLBAR_ICONS: Record<string, string> = {
  translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.2 7.3L4 20l1-4.5A8 8 0 1 1 21 12Z"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z"/><path d="M19 14l.7 2 .3.7 2 .3-2 .3-.3.7-.7 2-.7-2-.3-.7-2-.3 2-.3.3-.7z"/></svg>',
  highlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-4 4v3h3l4-4"/><path d="M12 8l4 4"/><path d="M16.5 3.5l4 4L13 15l-4-4z"/></svg>',
  saveWord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
  explainSentence: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2"/><path d="M18 7h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2"/></svg>',
}

// Rough luminance check of the block under the selection, to decide whether
// to render the light or dark glass variant. Defaults to light on any failure.
const BLOCK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P', 'LI', 'BLOCKQUOTE', 'TD', 'BODY'])
function isDarkPage(node: Node): boolean {
  try {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement
    while (el) {
      const bg = getComputedStyle(el).backgroundColor // e.g. "rgb(20, 22, 28)"
      const m = bg.match(/rgba?\(([^)]+)\)/)
      if (m) {
        const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()))
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          // alpha 0 → transparent → keep walking; otherwise threshold on luminance.
          const a = m[1].split(',')[3] ? parseFloat(m[1].split(',')[3]) : 1
          if (a > 0 && (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35) return true
          if (a > 0) return false
        }
      }
      el = el.parentElement
    }
  } catch {
    /* fall through to default */
  }
  return false
}

function createToolbar(x: number, y: number, text: string) {
  removeToolbar()

  const selection = window.getSelection()
  const anchorNode = selection?.getRangeAt(0).startContainer
  const dark = anchorNode ? isDarkPage(anchorNode) : false

  selectionToolbar = document.createElement('div')
  selectionToolbar.id = 'lector-ai-toolbar'
  if (dark) selectionToolbar.classList.add('is-dark')
  selectionToolbar.style.cssText = dark
    ? `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: rgba(28,28,30,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.18); color: #fff; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`
    : `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: rgba(255,255,255,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.6); border-radius: 999px; box-shadow: 0 4px 16px rgba(43,38,32,.14), 0 1px 2px rgba(43,38,32,.06); color: #2B2620; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`

  const mk = (actionId: string, label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.className = 't-btn'
    b.type = 'button'
    b.title = label
    b.setAttribute('aria-label', label)
    b.innerHTML = TOOLBAR_ICONS[actionId]
    b.onclick = (e) => {
      e.stopPropagation()
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        alert(tr('err.extensionNotLoaded'))
        return
      }
      fn()
    }
    return b
  }

  const mkDivider = () => {
    const d = document.createElement('span')
    d.className = 't-divider'
    d.setAttribute('aria-hidden', 'true')
    return d
  }

  // Group 1: AI actions
  selectionToolbar.appendChild(mk('translate', tr('toolbar.translate'), () => handleAction('translate', text)))
  selectionToolbar.appendChild(mk('explain', tr('toolbar.explain'), () => handleAction('explain', text)))
  selectionToolbar.appendChild(mk('summarize', tr('toolbar.summarize'), () => handleAction('summarize', text)))
  selectionToolbar.appendChild(mk('ask', tr('toolbar.ask'), () => handleAction('ask', text)))
  selectionToolbar.appendChild(mkDivider())
  // Group 2: annotation
  selectionToolbar.appendChild(mk('highlight', tr('toolbar.highlight'), () => handleHighlight(text)))
  selectionToolbar.appendChild(mk('saveWord', tr('toolbar.saveWord'), () => handleSaveWord(text)))
  selectionToolbar.appendChild(mk('explainSentence', tr('toolbar.explainSentence'), () => handleExplainSentence(text)))

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
    color: #9C6B3C;
  `

  const spinner = document.createElement('div')
  spinner.style.cssText = `
    width:16px;height:16px;border:2px solid #E8DECC;border-top-color:#9C6B3C;border-radius:50%;animation:lectorSpin .8s linear infinite;
  `
  const label = document.createElement('span')
  label.textContent = tr('popup.loading')
  loadingPopup.appendChild(spinner)
  loadingPopup.appendChild(label)
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
  const titleMap = {
    translate: tr('popup.result.translate'),
    summary: tr('popup.result.summary'),
    explain: tr('popup.result.explain'),
  }
  title.innerHTML = titleMap[type]

  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;'
  closeBtn.textContent = tr('popup.close')
  closeBtn.onclick = () => removeResult()

  header.appendChild(title)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  content.textContent = result

  const footer = document.createElement('div')
  footer.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #E8DECC;display:flex;gap:8px;'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'action-btn copy-btn'
  copyBtn.textContent = tr('popup.copy')
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(result)
    copyBtn.textContent = tr('popup.copied')
    setTimeout(() => (copyBtn.textContent = tr('popup.copy')), 1500)
  }

  const chatBtn = document.createElement('button')
  chatBtn.className = 'action-btn primary'
  chatBtn.textContent = tr('popup.continueInPanel')
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

/** Read source text aloud via the browser's built-in SpeechSynthesis (zero-dep). */
function speak(text: string, langSpeechCode: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = langSpeechCode
  window.speechSynthesis.speak(u)
}

/**
 * Streaming translate popup (DeepL-style). Shows immediately with a skeleton +
 * target-language selector; tokens stream into the content area. The caller's
 * `run(target, sink)` does the actual streaming; re-running on language change
 * reuses the same popup.
 */
function showStreamingTranslateResult(
  x: number,
  y: number,
  sourceText: string,
  initialTarget: TargetLangCode,
  run: (
    target: TargetLangCode,
    sink: { append: (d: string) => void; setText: (s: string) => void },
    signal: AbortSignal
  ) => Promise<void>
) {
  removeLoading()
  removeResult()

  resultPopup = document.createElement('div')
  resultPopup.id = 'lector-ai-result'
  const maxHeight = window.innerHeight - y - 100
  resultPopup.style.cssText = `
    position: fixed; left: ${x}px; top: ${y + 20}px; max-width: 420px; max-height: ${Math.min(maxHeight, 500)}px;
    overflow-y: auto; padding: 16px; background: #fff; border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2); z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .25s ease-out;
  `

  const header = document.createElement('div')
  header.className = 'result-header'
  const title = document.createElement('div')
  title.className = 'result-title'
  title.innerHTML = tr('popup.result.translate')

  // Target language selector.
  const langWrap = document.createElement('label')
  langWrap.style.cssText = 'font-size:11px;color:#6B6155;display:flex;align-items:center;gap:4px;'
  const langLabel = document.createElement('span')
  langLabel.textContent = tr('popup.result.targetLang')
  const sel = document.createElement('select')
  sel.style.cssText = 'font-size:11px;border:1px solid #E8DECC;border-radius:6px;padding:2px 4px;'
  const autoOpt = document.createElement('option')
  autoOpt.value = 'auto'
  autoOpt.textContent = tr('settings.translation.targetLanguage.auto')
  sel.appendChild(autoOpt)
  for (const l of LANGUAGES) {
    const o = document.createElement('option')
    o.value = l.code
    o.textContent = cachedPref === 'zh' ? l.zh : l.en
    if (l.code === initialTarget) o.selected = true
    sel.appendChild(o)
  }
  langWrap.appendChild(langLabel)
  langWrap.appendChild(sel)

  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;'
  closeBtn.textContent = tr('popup.close')
  closeBtn.onclick = () => removeResult()
  header.appendChild(title)
  header.appendChild(langWrap)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  content.appendChild(caret)

  const footer = document.createElement('div')
  footer.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #E8DECC;display:flex;gap:8px;flex-wrap:wrap;'
  const speakSrc = document.createElement('button')
  speakSrc.className = 'copy-btn'
  speakSrc.type = 'button'
  speakSrc.textContent = '🔊 ' + tr('popup.result.speak')
  speakSrc.style.flex = '0 0 auto'
  speakSrc.onclick = () => speak(sourceText, getLanguage(detectScript(sourceText) === 'cjk' ? 'zh' : 'en').speechCode)
  const speakTgt = document.createElement('button')
  speakTgt.className = 'copy-btn'
  speakTgt.type = 'button'
  speakTgt.textContent = '🔊'
  speakTgt.title = tr('popup.result.speak')
  speakTgt.style.flex = '0 0 auto'
  speakTgt.onclick = () => speak(content.textContent || '', getLanguage(curTarget).speechCode)
  const copyBtn = document.createElement('button')
  copyBtn.className = 'copy-btn'
  copyBtn.textContent = tr('popup.copy')
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(content.textContent || '').catch(() => {})
    copyBtn.textContent = tr('popup.copied')
    setTimeout(() => (copyBtn.textContent = tr('popup.copy')), 1500)
  }
  const chatBtn = document.createElement('button')
  chatBtn.className = 'action-btn primary'
  chatBtn.textContent = tr('popup.continueInPanel')
  chatBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: 'open-side-panel', seed: { kind: 'translate', text: content.textContent || '' } }).catch(() => {})
    removeResult()
    removeToolbar()
  }
  footer.appendChild(speakSrc)
  footer.appendChild(speakTgt)
  footer.appendChild(copyBtn)
  footer.appendChild(chatBtn)

  resultPopup.appendChild(header)
  resultPopup.appendChild(content)
  resultPopup.appendChild(footer)
  document.body.appendChild(resultPopup)
  setTimeout(() => document.addEventListener('click', handleClickOutside), 100)

  let acc = ''
  let curTarget = initialTarget
  // Generation guard + per-run abort: a new execute() (language switch)
  // supersedes any in-flight run — its streamChat is aborted and stale
  // sink callbacks are ignored so two streams never interleave.
  let gen = 0
  let runController: AbortController | null = null
  const sink = {
    append(delta: string) {
      acc += delta
      content.textContent = acc
      content.appendChild(caret)
    },
    setText(s: string) {
      acc = s
      content.textContent = s
      content.appendChild(caret)
    },
  }

  async function execute(target: TargetLangCode) {
    const myGen = ++gen
    curTarget = target
    // Abort the previous in-flight run (if any) before starting a new one.
    runController?.abort()
    runController = new AbortController()
    const mySink = {
      append(delta: string) { if (myGen === gen) sink.append(delta) },
      setText(s: string) { if (myGen === gen) sink.setText(s) },
    }
    mySink.setText('')
    content.appendChild(caret)
    try {
      await run(target, mySink, runController.signal)
      if (myGen !== gen) return // superseded; don't touch DOM or history
      if (caret.parentNode === content) content.removeChild(caret)
      chrome.runtime
        .sendMessage({
          action: 'lector-translation-history',
          entry: {
            source: sourceText.slice(0, 200),
            target: (acc || '').slice(0, 200),
            sourceLang: 'auto',
            targetLang: target,
            kind: 'selection',
            url: location.href,
            createdAt: Date.now(),
          },
        })
        .catch(() => {})
    } catch (e) {
      // Aborted runs are expected when the user switches language — not an error.
      const aborted = runController.signal.aborted && (e instanceof DOMException && e.name === 'AbortError')
      if (aborted && myGen !== gen) return
      if (myGen !== gen) return
      if (caret.parentNode === content) content.removeChild(caret)
      const msg = e instanceof Error ? e.message : tr('err.requestFailed')
      content.textContent = tr('err.failedPrefix').replace('{msg}', msg)
    }
  }

  sel.onchange = () => {
    const code =
      sel.value === 'auto'
        ? resolveTargetLang('auto', sourceText)
        : (sel.value as TargetLangCode)
    // Persist the user's choice so it sticks for next time.
    chrome.runtime.sendMessage({ action: 'lector-set-translation-target', target: sel.value }).catch(() => {})
    void execute(code)
  }

  void execute(initialTarget)
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
// BYOK helpers (run in the content-script context)
// ---------------------------------------------------------------------------
// The content script can import shared modules; vite bundles them in.
import { getSettings, completeOnce, streamChat } from './shared/byok'
import { t, type LocalePref, type StringKey } from './shared/i18n'
import { renderGlossaryPrompt, type GlossaryEntry } from './shared/glossary'
import {
  runConcurrent,
  shouldTranslateBlock,
  buildTranslateSystemPrompt,
  filterGlossaryForDirection,
  resolveTargetLang,
  detectScript,
  EXCLUDED_ANCESTOR_TAGS,
  LANGUAGES,
  getLanguage,
  type DisplayMode,
  type TargetLangCode,
} from './shared/translation'
import { normalizeTranslationSettings, type ByokSettings } from './shared/providers'

// --- i18n: content script reads the locale pref from storage once per action ---
let cachedPref: LocalePref = 'auto'

async function loadPref(): Promise<LocalePref> {
  try {
    const settings = await getSettings()
    cachedPref = settings.locale ?? 'auto'
  } catch {
    cachedPref = 'auto'
  }
  return cachedPref
}
const tr = (key: StringKey) => t(key, cachedPref)

/**
 * Read the user's glossary from chrome.storage. The zustand store writes to
 * window.localStorage under 'lector-ai-storage', but the content script runs
 * in an isolated world and cannot read window.localStorage of the page. The
 * side panel therefore mirrors the glossary into chrome.storage.local under
 * the 'lectorGlossary' key (same pattern as byok.ts's settings double-write).
 *
 * Returns [] on any error so callers safely no-op (no glossary injection).
 */
async function loadGlossary(): Promise<GlossaryEntry[]> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return []
    const r = await chrome.storage.local.get('lectorGlossary')
    const list = r.lectorGlossary as GlossaryEntry[] | undefined
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// (buildTranslationSystemPrompt now lives in src/shared/translation.ts and is
// imported above — single source of truth for the selection popup, bilingual
// mode, vocab save, and sentence card.)

// ---------------------------------------------------------------------------
// Highlight capture (Feature ②) and vocabulary save (Feature ③)
// ---------------------------------------------------------------------------
// These relay to the background worker, which persists the entry into
// chrome.storage; the side panel picks it up from there and syncs its store.
//
// If the background service worker is asleep/torn down, the relay can fail
// silently. relayOrAlert sends the message and surfaces a user-visible error
// (instead of swallowing it) so the user knows their highlight/word was lost.
async function relayOrAlert(payload: unknown): Promise<boolean> {
  try {
    await chrome.runtime.sendMessage(payload)
    return true
  } catch {
    // The worker may not be reachable (e.g. extension just reloaded). Alert
    // the user rather than silently dropping the captured data.
    alert(tr('err.extensionNotLoaded'))
    return false
  }
}

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
  void relayOrAlert({
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
  removeToolbar()
}

function handleSaveWord(word: string) {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode?.parentElement
  const block = anchor?.closest('[data-lector-id]') as HTMLElement | null
  const blockId = block?.getAttribute('data-lector-id') || undefined
  const context = (anchor?.textContent || word).slice(0, 160)
  void relayOrAlert({
    action: 'lector-save-word',
    word,
    context,
    url: location.href,
    title: document.title,
    blockId,
  })
  removeToolbar()
}

async function handleExplainSentence(sentence: string) {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode?.parentElement
  const block = anchor?.closest('[data-lector-id]') as HTMLElement | null
  const blockId = block?.getAttribute('data-lector-id') || undefined
  const quote = (anchor?.textContent || sentence).slice(0, 200)

  // No API key: mirror the runByokAction no-key UX — surface an "add key"
  // result popup at the toolbar and open the side panel, instead of silently
  // relaying (which background.ts would drop on the floor). Checklist §14.12.
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  if (!settings.apiKey) {
    const r = () => selectionToolbar?.getBoundingClientRect()
    showResult(r()?.left || 100, r()?.top || 100, tr('err.addKey'), 'explain')
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    removeToolbar()
    return
  }

  void relayOrAlert({
    action: 'lector-explain-sentence',
    sentence,
    quote,
    url: location.href,
    title: document.title,
    blockId,
  })
  removeToolbar()
}

// ---------------------------------------------------------------------------
// Actions — call the provider directly (BYOK), no backend
// ---------------------------------------------------------------------------
function handleAction(kind: 'translate' | 'summarize' | 'explain' | 'ask', text: string) {
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

  void runByokAction(kind, text)
}

async function runByokAction(kind: 'translate' | 'summarize' | 'explain', text: string) {
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  const r = () => selectionToolbar?.getBoundingClientRect()

  if (!settings.apiKey) {
    removeLoading()
    showResult(r()?.left || 100, r()?.top || 100, tr('err.addKey'), 'translate')
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    return
  }

  if (kind === 'translate') {
    const tSettings = normalizeTranslationSettings(settings.translation)
    const initialTarget = resolveTargetLang(tSettings.targetLanguage, text)
    const glossary = await loadGlossary()
    // Show the streaming popup immediately with a target-language selector.
    showStreamingTranslateResult(r()?.left || 100, r()?.top || 100, text, initialTarget, async (selTarget, sink, signal) => {
      const sp = buildTranslateSystemPrompt(
        selTarget,
        renderGlossaryPrompt(filterGlossaryForDirection(glossary, selTarget))
      )
      await streamChat(
        settings,
        [{ role: 'system', content: sp }, { role: 'user', content: text.slice(0, 8000) }],
        { maxTokens: Math.min(3000, Math.max(500, text.length * 2)), temperature: 0.2 },
        (delta) => sink.append(delta),
        signal
      )
    })
    return
  }

  // summarize / explain stay non-streaming.
  let systemPrompt = ''
  let maxTokens = 900
  if (kind === 'summarize') {
    systemPrompt = `You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.`
  } else {
    systemPrompt = `You are Lector AI. Explain the user content clearly in a few sentences, then give one concrete example. Clean Markdown.`
  }
  try {
    const out = await completeOnce(settings, systemPrompt, text.slice(0, 8000), {
      maxTokens,
      temperature: 0.5,
    })
    removeLoading()
    showResult(
      r()?.left || 100,
      r()?.top || 100,
      out || tr('err.emptyResponse'),
      kind === 'summarize' ? 'summary' : 'explain'
    )
  } catch (e) {
    removeLoading()
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    showResult(r()?.left || 100, r()?.top || 100, tr('err.failedPrefix').replace('{msg}', msg), 'explain')
  }
}

// ---------------------------------------------------------------------------
// Inline bilingual translation (Immersive-Translate style) — BYOK direct.
// Concurrency + streaming + viewport-first ordering + progress + cancel.
// ---------------------------------------------------------------------------
let bilingualAbort: AbortController | null = null

const EXCLUDED_SELECTOR = Array.from(EXCLUDED_ANCESTOR_TAGS).map((t) => t.toLowerCase()).join(',')

function buildBlockCandidate(el: HTMLElement) {
  const text = (el.textContent || '').trim()
  const outerLen = (el.outerHTML || '').length || text.length || 1
  return {
    text,
    tag: el.tagName,
    isInsideExcluded: !!el.closest(EXCLUDED_SELECTOR),
    isAlreadyTranslated: !!el.querySelector('.lector-bilingual'),
    textRatio: text.length / outerLen,
  }
}

function applyDisplayMode(mode: DisplayMode) {
  document.body.classList.remove('lector-dm-bilingual', 'lector-dm-translationOnly', 'lector-dm-hover')
  document.body.classList.add('lector-dm-' + mode)
}

/** Translate a single block, streaming tokens into a freshly inserted container.
 *  `signal` aborts the in-flight request (cancel / language-switch). */
async function translateOneBlock(
  settings: ByokSettings,
  systemPrompt: string,
  block: HTMLElement,
  signal?: AbortSignal
): Promise<string> {
  const original = (block.textContent || '').trim()
  // Mark the host so display-mode CSS (translationOnly / hover) can target the
  // block that owns this translation, and wrap the original content in a
  // .lector-bi-source span so translationOnly can hide it via CSS (the
  // original is a bare text node, which display:none can't reach directly).
  block.classList.add('lector-bilingual-host')
  if (!block.querySelector(':scope > .lector-bi-source')) {
    const sourceWrap = document.createElement('span')
    sourceWrap.className = 'lector-bi-source'
    while (block.firstChild) sourceWrap.appendChild(block.firstChild)
    block.appendChild(sourceWrap)
  }
  // Insert placeholder container immediately so the user sees progress.
  const span = document.createElement('div')
  span.className = 'lector-bilingual is-loading'
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  span.appendChild(caret)
  // Per-block hover actions.
  const actions = document.createElement('span')
  actions.className = 'lector-bi-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = tr('bilingual.retry')
  retry.onclick = (ev) => {
    ev.stopPropagation()
    span.remove()
    void translateOneBlock(settings, systemPrompt, block).catch(() => {})
  }
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = tr('bilingual.copyTranslation')
  copy.onclick = (ev) => { ev.stopPropagation(); navigator.clipboard.writeText(span.textContent || '').catch(() => {}) }
  actions.appendChild(retry)
  actions.appendChild(copy)
  block.appendChild(span)

  let acc = ''
  await streamChat(
    settings,
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: original.slice(0, 8000) }],
    { maxTokens: Math.min(1000, Math.max(200, original.length * 2)), temperature: 0.2 },
    (delta) => {
      acc += delta
      span.classList.remove('is-loading')
      span.textContent = acc
      span.appendChild(actions)
    },
    signal
  )
  span.textContent = acc || tr('err.emptyResponse')
  span.appendChild(actions)
  return acc
}

async function runBilingualTranslation() {
  const settings = await getSettings()
  if (!settings.apiKey) {
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    return
  }
  const tSettings = normalizeTranslationSettings(settings.translation)
  applyDisplayMode(tSettings.displayMode)

  // Gather candidates, viewport-first ordering.
  const all = Array.from(document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary')) as HTMLElement[]
  const vh = window.innerHeight
  const candidates = all
    .map((el) => ({ el, c: buildBlockCandidate(el) }))
    .filter((x) => shouldTranslateBlock(x.c) && !x.el.closest('#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, [data-lector-no-translate]'))
    .sort((a, b) => {
      const ra = a.el.getBoundingClientRect()
      const rb = b.el.getBoundingClientRect()
      const aIn = ra.top < vh && ra.bottom > 0 ? 0 : 1
      const bIn = rb.top < vh && rb.bottom > 0 ? 0 : 1
      return aIn - bIn
    })
    .map((x) => x.el)
  if (candidates.length === 0) return

  const page = extractPage()
  const probeText = page.lang === 'zh' ? '中文示例文本' : 'Hello world sample text'
  const target = resolveTargetLang(tSettings.targetLanguage, probeText)
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock)

  bilingualAbort = new AbortController()
  const controller = bilingualAbort
  const total = candidates.length
  let done = 0
  const report = () =>
    chrome.runtime
      .sendMessage({ action: 'lector-bilingual-progress', done, total })
      .catch(() => {})
  report()

  const results = await runConcurrent(
    candidates,
    async (block) => {
      try {
        await translateOneBlock(settings, systemPrompt, block, controller.signal)
      } catch (e) {
        // Don't retry (or count) once the user has cancelled.
        if (controller.signal.aborted) throw e
        // Retry once with a short backoff (still abortable).
        await new Promise((r) => setTimeout(r, 500))
        if (controller.signal.aborted) throw e
        try {
          await translateOneBlock(settings, systemPrompt, block, controller.signal)
        } catch (e2) {
          const span = block.querySelector('.lector-bilingual')
          if (span) {
            span.classList.remove('is-loading')
            span.classList.add('is-error')
            span.textContent = tr('bilingual.blockError')
          }
          throw e2
        }
      } finally {
        // Don't count aborted tasks as "translated" — that would report a
        // misleading 30/30 right after a cancel.
        if (!controller.signal.aborted) {
          done++
          report()
        }
      }
    },
    { concurrency: tSettings.concurrency, signal: controller.signal }
  )

  // Relay one history entry for the page (sample = first successfully translated block).
  const firstOkIdx = results.findIndex((r) => r.ok)
  if (firstOkIdx >= 0) {
    const sample = candidates[firstOkIdx]
    const tgt = (sample.querySelector('.lector-bilingual')?.textContent || '').slice(0, 200)
    chrome.runtime
      .sendMessage({
        action: 'lector-translation-history',
        entry: {
          source: ((sample.textContent) || '').trim().slice(0, 200),
          target: tgt,
          sourceLang: page.lang || 'auto',
          targetLang: target,
          kind: 'page',
          url: location.href,
          createdAt: Date.now(),
        },
      })
      .catch(() => {})
  }

  // First non-abort error surfaces to side panel (preserve existing UX).
  const firstErr = results.find(
    (r) => !r.ok && !(r.error instanceof DOMException && (r.error as DOMException).name === 'AbortError')
  )
  if (firstErr && !firstErr.ok) {
    const msg = firstErr.error instanceof Error ? firstErr.error.message : tr('err.requestFailed')
    chrome.runtime.sendMessage({ action: 'lector-bilingual-error', message: msg }).catch(() => {})
  }
  bilingualAbort = null
}

function cancelBilingual() {
  if (bilingualAbort) {
    bilingualAbort.abort()
    bilingualAbort = null
  }
  chrome.runtime
    .sendMessage({ action: 'lector-bilingual-error', message: tr('bilingual.canceled') })
    .catch(() => {})
}

/** Backwards-compat entry point; the side panel / command send lector-toggle-bilingual. */
async function toggleBilingual() {
  await runBilingualTranslation()
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
    const GAP = 8
    // Initial placement: left-aligned to selection, just below it.
    // Final clamping happens after the pill is in the DOM and measured.
    const initialX = rect.left
    const initialY = rect.bottom + GAP
    loadPref().then(() => {
      createToolbar(initialX, initialY, text)
      if (!selectionToolbar) return
      const pw = selectionToolbar.offsetWidth
      const ph = selectionToolbar.offsetHeight
      // Clamp horizontally so the pill never overflows the right edge (8px margin).
      let x = Math.min(initialX, window.innerWidth - pw - 8)
      x = Math.max(8, x)
      // If it would overflow the bottom, flip above the selection.
      let y = initialY
      if (y + ph > window.innerHeight - 8) {
        y = Math.max(8, rect.top - ph - GAP)
      }
      selectionToolbar.style.left = `${x}px`
      selectionToolbar.style.top = `${y}px`
    })
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
  if (message?.action === 'lector-get-selection') {
    const sel = window.getSelection()
    sendResponse({ selection: sel ? sel.toString().trim() : '' })
    return false
  }
  if (message?.action === 'lector-toggle-bilingual') {
    // Respond immediately so the side panel can release bilingualBusy without
    // holding the message channel open across concurrent provider calls (MV3
    // may tear the channel/worker down during that time, leaving the button
    // stuck). Translations still inject into the DOM as they land; progress
    // is reported via separate lector-bilingual-progress messages.
    sendResponse({ ok: true })
    void toggleBilingual()
    return false
  }
  if (message?.action === 'lector-cancel-bilingual') {
    cancelBilingual()
    sendResponse({ ok: true })
    return false
  }
  if (message?.action === 'lector-translation-settings-changed') {
    // Re-apply display mode live without re-translating.
    void (async () => {
      const s = await getSettings()
      const ts = normalizeTranslationSettings(s.translation)
      applyDisplayMode(ts.displayMode)
    })()
    sendResponse({ ok: true })
    return false
  }
  if (message?.action === 'lector-jump-to') {
    // blockId is generated by this extension as `b<digits>`; whitelist it
    // before interpolating into the selector to avoid any selector injection.
    const blockId = typeof message.blockId === 'string' ? message.blockId : ''
    if (!/^b\d+$/.test(blockId)) {
      sendResponse({ ok: false, reason: 'bad-id' })
      return false
    }
    const node = document.querySelector<HTMLElement>(`[data-lector-id="${blockId}"]`)
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
