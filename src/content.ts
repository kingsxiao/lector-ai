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
let fabMenu: HTMLElement | null = null

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
    #lector-ai-fab { position: fixed; right: 20px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%; background: #9C6B3C; color: #FFF8EE; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; font-family: Georgia, 'Iowan Old Style', 'Source Serif Pro', serif; cursor: pointer; z-index: 2147483646; box-shadow: 0 6px 20px rgba(156,107,60,.32); animation: lectorFabPulse 3s ease-in-out infinite; transition: transform .22s cubic-bezier(0.16,1,0.3,1), background-color .15s ease; user-select: none; }
    #lector-ai-fab:hover { transform: scale(1.08); background: #875A2F; }
    #lector-ai-fab.is-open { transform: rotate(45deg); animation: none; background: #875A2F; }
    #lector-ai-fab.is-open:hover { transform: rotate(45deg) scale(1.08); }
    /* Radial quick-action menu: items fan out from the FAB center along an
       upward arc. Each item is a circular button with a hover tooltip label. */
    .lector-fab-menu { position: fixed; z-index: 2147483645; pointer-events: none; }
    .lector-fab-item { position: absolute; width: 44px; height: 44px; border-radius: 50%; background: #FFF8EE; color: #6B6155; border: 1px solid #E8DECC; box-shadow: 0 4px 14px rgba(43,38,32,.18); cursor: pointer; display: flex; align-items: center; justify-content: center; pointer-events: auto; opacity: 0; transform: translate(0,0) scale(.4); transition: transform .26s cubic-bezier(0.18,1.2,0.4,1), opacity .18s ease; will-change: transform, opacity; }
    .lector-fab-item svg { width: 20px; height: 20px; display: block; }
    .lector-fab-item:hover { background: #9C6B3C; color: #FFF8EE; transform: var(--lector-rest) scale(1.1); }
    .lector-fab-label { position: absolute; right: 54px; top: 50%; transform: translateY(-50%); background: rgba(43,38,32,.92); color: #FFF8EE; font-size: 11px; font-weight: 500; padding: 3px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .12s ease; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .lector-fab-item:hover .lector-fab-label { opacity: 1; }
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

function findBestContentRoot(): Element {
  // Avoid scoring every <div> when semantic article roots exist. Reading
  // textContent for every nested div repeats the same subtree text at each
  // level and becomes effectively quadratic on large component applications.
  const semantic = Array.from(
    document.querySelectorAll('article, main, [role="main"]')
  )
  const named = semantic.length === 0
    ? Array.from(document.querySelectorAll('.post, .article, .content, .entry-content'))
    : []
  // Div-only pages are the fallback. Bound the scan to keep panel-open page
  // extraction responsive on pathological DOMs while retaining broad support.
  const allGeneric = semantic.length === 0 && named.length === 0
    ? Array.from(document.querySelectorAll('div'))
    : []
  const generic = allGeneric.length <= 2000 ? allGeneric : []
  const candidates = semantic.length > 0 ? semantic : named.length > 0 ? named : generic

  let best: Element | null = null
  let bestScore = 0
  for (const el of candidates) {
    const score = scoreNode(el)
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  }
  return best || document.body
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
  // Count dominant script instead of treating one stray CJK character (footer,
  // locale switcher, username) as proof that the entire English page is CJK.
  const script = detectScript(text)
  if (script === 'cjk') {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja'
    if (/[\uac00-\ud7af]/.test(text)) return 'ko'
    return 'zh'
  }
  if (script === 'cyrillic') return 'ru'
  if (script === 'arabic') return 'ar'
  if (script === 'hebrew') return 'he'
  if (script === 'greek') return 'el'
  if (script === 'devanagari') return 'hi'
  if (script === 'thai') return 'th'
  return 'en'
}

export function extractPage(): ExtractedPage {
  const root = findBestContentRoot()

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
// Floating action button → radial quick-action menu (page-level actions).
// ---------------------------------------------------------------------------
// Cache the Lector panel URL ONCE at load, while the extension context is
// guaranteed valid. After an extension reload / when the MV3 service worker is
// destroyed, this content script becomes "orphaned" and any later call to
// chrome.runtime.getURL() / chrome.runtime.sendMessage() throws
// "Extension context invalidated" SYNCHRONOUSLY. Caching the URL + wrapping
// runtime calls in try/catch + using window.open (a page DOM API, unaffected
// by context validity) keeps the FAB fully functional even when orphaned.
let fabPanelUrl = ''
try {
  fabPanelUrl = chrome.runtime.getURL('sidepanel/index.html')
} catch {
  fabPanelUrl = ''
}

function ensureFab() {
  if (fab) return
  fab = document.createElement('div')
  fab.id = 'lector-ai-fab'
  fab.title = t('fab.title', 'auto')
  fab.setAttribute('role', 'button')
  fab.setAttribute('aria-haspopup', 'menu')
  fab.setAttribute('aria-expanded', 'false')
  fab.setAttribute('tabindex', '0')
  fab.setAttribute('aria-label', t('fab.title', 'auto'))
  fab.textContent = 'L'
  fab.onclick = (e) => {
    e.stopPropagation()
    toggleFabMenu()
  }
  fab.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleFabMenu()
    } else if (e.key === 'Escape' && fabMenu) {
      closeFabMenu()
    }
  }
  document.body.appendChild(fab)
}

/** Best-effort: ask the background to open the side panel. Wrapped because a
 *  sendMessage call throws synchronously once the extension context is
 *  invalidated; a returned-promise .catch() can't catch that. */
function tryOpenSidePanel() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    }
  } catch {
    /* context invalidated — caller may fall back to window.open */
  }
}

/** Open the standalone Lector window (the old FAB behavior). Reliable: uses
 *  the cached URL + window.open (page DOM API), so it works even when the
 *  extension context is invalidated. */
function openStandaloneLector() {
  if (fabPanelUrl) window.open(fabPanelUrl, 'lector-ai-panel')
}

/** Summarize the whole page (not a selection). Feeds extractPage().text to the
 *  same summarizer the toolbar uses, and shows the result near the FAB. */
async function summarizePage() {
  const rect = fab?.getBoundingClientRect()
  const x = rect?.left || 100
  const y = rect?.top || 100
  showLoading(x, y)
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  if (!settings.apiKey) {
    removeLoading()
    showResult(x, y, tr('err.addKey'), 'translate')
    tryOpenSidePanel()
    return
  }
  const pageText = extractPage().text
  const systemPrompt = `You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.`
  try {
    const out = await completeOnce(settings, systemPrompt, pageText.slice(0, 8000), {
      maxTokens: 900,
      temperature: 0.5,
    })
    removeLoading()
    showResult(x, y, out || tr('err.emptyResponse'), 'summary')
  } catch (e) {
    removeLoading()
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    showResult(x, y, tr('err.failedPrefix').replace('{msg}', msg), 'explain')
  }
}

type FabAction = {
  id: string
  label: string
  icon: string
  run: () => void
}

/** Build the radial menu's action list. Built per-open so labels reflect the
 *  current locale (which can change without a reload). */
function fabActions(): FabAction[] {
  return [
    {
      id: 'translatePage',
      label: tr('fab.menu.translatePage'),
      icon: FAB_MENU_ICONS.translatePage,
      run: () => {
        void toggleBilingual()
      },
    },
    {
      id: 'summarizePage',
      label: tr('fab.menu.summarizePage'),
      icon: FAB_MENU_ICONS.summarizePage,
      run: () => {
        void summarizePage()
      },
    },
    {
      id: 'openPanel',
      label: tr('fab.menu.openPanel'),
      icon: FAB_MENU_ICONS.openPanel,
      run: () => {
        // MV3 forbids chrome.sidePanel.open from a content-script click (the
        // user gesture is dropped across sendMessage), so the side-panel
        // message alone would silently fail. Best-effort send it (works on
        // Chrome versions that still honor it / when the panel is already
        // open), then ALWAYS fall back to opening Lector in a standalone
        // window via window.open — the only 100%-reliable opener from a
        // content script. This matches the "open in new window" item so the
        // user always sees Lector open, never a silent no-op.
        tryOpenSidePanel()
        openStandaloneLector()
      },
    },
    {
      id: 'openStandalone',
      label: tr('fab.menu.openStandalone'),
      icon: FAB_MENU_ICONS.openStandalone,
      run: () => {
        openStandaloneLector()
      },
    },
  ]
}

/** Open the radial menu if closed, close it if open. Items fan out along an
 *  upward arc (180°→360°) from the FAB center. */
function toggleFabMenu() {
  if (fabMenu) {
    closeFabMenu()
    return
  }
  if (!fab) return
  const actions = fabActions()
  const menu = document.createElement('div')
  menu.className = 'lector-fab-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', tr('fab.menu'))
  // Anchor the menu's origin (0,0) at the FAB center; items are positioned by
  // polar coordinates relative to that point.
  const fr = fab.getBoundingClientRect()
  const cx = fr.left + fr.width / 2
  const cy = fr.top + fr.height / 2
  menu.style.left = `${cx}px`
  menu.style.top = `${cy}px`
  const R = 76 // arc radius (px) from FAB center to each item center
  const n = actions.length
  actions.forEach((a, i) => {
    // Spread across the upper semicircle: from 200° (left-up) to 340° (right-up)
    // so items sit above the FAB and don't overlap the edge.
    const angleDeg = 200 + (i * (340 - 200)) / Math.max(1, n - 1)
    const rad = (angleDeg * Math.PI) / 180
    const dx = Math.cos(rad) * R
    const dy = Math.sin(rad) * R // negative = upward (screen y grows downward)
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'lector-fab-item'
    item.setAttribute('role', 'menuitem')
    item.setAttribute('aria-label', a.label)
    item.title = a.label
    item.innerHTML = a.icon
    // Resting transform = the fan-out position. Hover scales from there via the
    // CSS var (--lector-rest), so hover stays put instead of snapping to origin.
    const rest = `translate(${dx - 22}px, ${dy - 22}px)`
    item.style.setProperty('--lector-rest', rest)
    // Stagger the open animation for a pleasing radial reveal.
    const delay = i * 35
    const label = document.createElement('span')
    label.className = 'lector-fab-label'
    label.textContent = a.label
    item.appendChild(label)
    item.onclick = (ev) => {
      ev.stopPropagation()
      closeFabMenu()
      a.run()
    }
    menu.appendChild(item)
    // Apply the resting transform on the next frame so the transition runs.
    requestAnimationFrame(() => {
      item.style.transform = rest
      item.style.opacity = '1'
    })
    // Adjust delay via transitionDelay so each item reveals in sequence.
    item.style.transitionDelay = `${delay}ms`
  })
  document.body.appendChild(menu)
  fabMenu = menu
  fab.classList.add('is-open')
  fab.setAttribute('aria-expanded', 'true')
}

function closeFabMenu() {
  if (!fabMenu) return
  // Reverse the items back toward the FAB center, then remove after the
  // transition ends so the collapse animates.
  const items = fabMenu.querySelectorAll<HTMLElement>('.lector-fab-item')
  items.forEach((it, i) => {
    it.style.transitionDelay = `${(items.length - 1 - i) * 25}ms`
    it.style.transform = 'translate(0,0) scale(.4)'
    it.style.opacity = '0'
  })
  const toRemove = fabMenu
  fabMenu = null
  if (fab) {
    fab.classList.remove('is-open')
    fab.setAttribute('aria-expanded', 'false')
  }
  setTimeout(() => toRemove.remove(), 280)
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
// Page-level icons for the FAB radial quick-action menu (no text selection).
const FAB_MENU_ICONS: Record<string, string> = {
  // bilingual page translation (globe)
  translatePage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></svg>',
  // summarize whole page (document with lines)
  summarizePage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  // open side panel (chat bubble)
  openPanel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.2 7.3L4 20l1-4.5A8 8 0 1 1 21 12Z"/></svg>',
  // open in standalone window (external expand)
  openStandalone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 21H3V6"/></svg>',
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
  // Guard rangeCount: the selection was validated in the mouseup setTimeout,
  // but loadPref() awaits chrome.storage in between, and the selection can be
  // cleared (programmatic removeAllRanges, focus change, SPA route change)
  // before we reach here. getRangeAt(0) throws IndexSizeError when rangeCount
  // is 0, which would crash toolbar creation synchronously.
  const anchorNode = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null
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
      // A run superseded by a newer language switch was aborted — don't
      // surface its error or touch the DOM; the newer run owns the popup.
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
  splitBlockForTranslation,
  buildTranslateSystemPrompt,
  filterGlossaryForDirection,
  resolveTargetLang,
  detectScript,
  isTranslationLikelyUnchanged,
  maxTokensForChunk,
  EXCLUDED_ANCESTOR_TAGS,
  LANGUAGES,
  getLanguage,
  type DisplayMode,
  type TargetLangCode,
} from './shared/translation'
import { buildThemeStylesheet, TRANSLATION_THEMES } from './shared/translationThemes'
import { personaPrompt } from './shared/translationPersonas'
import {
  cacheKey,
  putEntry,
  getEntry,
  parseStore,
  type CacheStore,
} from './shared/translationCache'
import { findRuleForHost, shouldAutoTranslatePage } from './shared/siteRules'
import { normalizeTranslationSettings, type ByokSettings, type TranslationSettings } from './shared/providers'

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
    mark.title = t('highlight.markTitle', 'auto')
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
    const persona = personaPrompt(tSettings.persona)
    // Show the streaming popup immediately with a target-language selector.
    showStreamingTranslateResult(r()?.left || 100, r()?.top || 100, text, initialTarget, async (selTarget, sink, signal) => {
      const sp = buildTranslateSystemPrompt(
        selTarget,
        renderGlossaryPrompt(filterGlossaryForDirection(glossary, selTarget)),
        persona
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
const BASE_TRANSLATABLE_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary'
const TRANSLATION_NOISE_SELECTOR =
  'nav, header, footer, menu, [role="navigation"], [role="banner"], [role="menu"], [role="menubar"]'

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

function queryAllSafe(root: Element, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector))
  } catch {
    return []
  }
}

function closestSafe(el: Element, selector: string): Element | null {
  try {
    return el.closest(selector)
  } catch {
    return null
  }
}

/**
 * Collect non-overlapping translation hosts.
 *
 * Component pages often nest the same label through several div/span wrappers.
 * The old collector compared every candidate with every other candidate
 * (O(n²)); its symmetric parent/child predicate could remove BOTH nodes, while
 * a <p> and inner <span> could also be translated concurrently and rewrite one
 * another's DOM. This collector deduplicates with Sets and marks ancestors in
 * O(nodes × DOM depth), keeping the deepest eligible host once.
 */
export function collectTranslationCandidates(
  scopeRoot: Element,
  extraSelectors: string[] = [],
  excludeSelectors: string[] = []
): HTMLElement[] {
  const validExtra = extraSelectors.map((s) => s.trim()).filter(Boolean)
  const extraRoots = new Set<HTMLElement>()
  for (const selector of validExtra) {
    for (const el of queryAllSafe(scopeRoot, selector)) extraRoots.add(el)
    if (closestSafe(scopeRoot, selector) === scopeRoot) extraRoots.add(scopeRoot as HTMLElement)
  }

  const standardRoots = new Set<HTMLElement>()
  if (closestSafe(scopeRoot, BASE_TRANSLATABLE_SELECTOR) === scopeRoot) {
    standardRoots.add(scopeRoot as HTMLElement)
  }
  for (const el of queryAllSafe(scopeRoot, BASE_TRANSLATABLE_SELECTOR)) standardRoots.add(el)
  for (const el of extraRoots) standardRoots.add(el)

  const hasStandardAncestor = (el: HTMLElement) => {
    let parent = el.parentElement
    while (parent) {
      if (standardRoots.has(parent)) return true
      if (parent === scopeRoot) break
      parent = parent.parentElement
    }
    return false
  }

  // Precompute wrappers that contain a standard/explicit host. Querying every
  // div/span subtree separately is disproportionately expensive on large apps.
  const hasStandardDescendant = new Set<HTMLElement>()
  for (const host of standardRoots) {
    let parent = host.parentElement
    while (parent) {
      hasStandardDescendant.add(parent)
      if (parent === scopeRoot) break
      parent = parent.parentElement
    }
  }

  const textLeaves = queryAllSafe(scopeRoot, 'div, span, a').filter((el) => {
    if (closestSafe(el, EXCLUDED_SELECTOR)) return false
    if (closestSafe(el, TRANSLATION_NOISE_SELECTOR)) return false
    if (!standardRoots.has(el) && hasStandardAncestor(el)) return false
    if (hasStandardDescendant.has(el)) return false
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent || '')
      .join('')
      .trim()
    // Navigation is already excluded, so content links can use the same
    // threshold as div/span. A 25-char anchor floor skipped useful labels.
    return directText.length >= 6
  })

  const unique = [...new Set<HTMLElement>([...standardRoots, ...textLeaves])]
  const textLeafSet = new Set(textLeaves)
  const eligible = unique.filter((el) => {
    const allowAnyTag = textLeafSet.has(el) || extraRoots.has(el)
    if (!shouldTranslateBlock(buildBlockCandidate(el), allowAnyTag)) return false
    if (closestSafe(el, '#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, [data-lector-no-translate]')) {
      return false
    }
    return !excludeSelectors.some((selector) => Boolean(closestSafe(el, selector)))
  })

  const eligibleSet = new Set(eligible)
  const hasEligibleDescendant = new Set<HTMLElement>()
  for (const el of eligible) {
    let parent = el.parentElement
    while (parent) {
      if (eligibleSet.has(parent)) hasEligibleDescendant.add(parent)
      if (parent === scopeRoot) break
      parent = parent.parentElement
    }
  }

  const vh = window.innerHeight
  return eligible
    .filter((el) => !hasEligibleDescendant.has(el))
    .sort((a, b) => {
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const aIn = ra.top < vh && ra.bottom > 0 ? 0 : 1
      const bIn = rb.top < vh && rb.bottom > 0 ? 0 : 1
      return aIn - bIn
    })
}

function applyDisplayMode(mode: DisplayMode) {
  document.body.classList.remove('lector-dm-bilingual', 'lector-dm-translationOnly', 'lector-dm-hover')
  document.body.classList.add('lector-dm-' + mode)
}

/**
 * Apply the full translation styling: display mode + theme + font size +
 * reading-focus + injected custom CSS. Called on initial run and whenever the
 * side panel broadcasts a settings change (so theme/font swaps are live).
 *
 * The theme stylesheet is (re)generated into a dedicated <style> block
 * (#lector-ai-theme-styles) kept separate from #lector-ai-styles so a hot-swap
 * only replaces the theme rules, not the base UI CSS.
 */
function applyTranslationStyle(ts: TranslationSettings) {
  applyDisplayMode(ts.displayMode)
  // Strip every known theme class, then set the active one.
  document.body.classList.remove(...TRANSLATION_THEMES.map((t) => `lector-theme-${t.id}`))
  document.body.classList.add(`lector-theme-${ts.theme}`)
  document.body.classList.toggle('lector-focus-on', !!ts.readingFocus)
  // (Re)inject the theme stylesheet.
  let styleEl = document.getElementById('lector-ai-theme-styles') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'lector-ai-theme-styles'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = buildThemeStylesheet(ts.fontSize, ts.customCss, ts.readingFocus)
}

/** Build the per-chunk hover action cluster (retry + copy). Shared by the
 *  streaming path and the cache-hit fast-path so a cached translation gets the
 *  same per-chunk controls. `onRetry` re-runs just this chunk. */
function makeChunkActions(span: HTMLElement, onRetry: () => void): HTMLElement {
  const actions = document.createElement('span')
  actions.className = 'lector-bi-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = tr('bilingual.retry')
  retry.onclick = (ev) => { ev.stopPropagation(); onRetry() }
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = tr('bilingual.copyTranslation')
  copy.onclick = (ev) => {
    ev.stopPropagation()
    navigator.clipboard.writeText(readChunkTranslation(span)).catch(() => {})
  }
  actions.appendChild(retry)
  actions.appendChild(copy)
  return actions
}

/** Read only provider output, excluding retry/copy control labels. */
function readChunkTranslation(span: Element): string {
  return Array.from(span.childNodes)
    .filter((node) =>
      !(node instanceof Element && node.classList.contains('lector-bi-actions'))
    )
    .map((node) => node.textContent || '')
    .join('')
    .trim()
}

/** Return a copy of a CacheCtx with caching disabled (for retries that must
 *  bypass a possibly-bad cached value). Type-safe replacement for a spread,
 *  which TS would widen to optional fields. */
function cacheDisabled(cache: CacheCtx): CacheCtx {
  return {
    enabled: false,
    ttlDays: cache.ttlDays,
    store: cache.store,
    keyInputs: cache.keyInputs,
    persist: cache.persist,
  }
}

/** Best-effort main-content root for the `smart` page scope. Reuses the same
 *  density-scoring heuristic as extractPage() so the "smart" translation scope
 *  matches what "chat with this page" reads. Returns the element or null. */
function extractPageRoot(): Element | null {
  const root = findBestContentRoot()
  return root === document.body ? null : root
}

/** Read the translation cache from chrome.storage.local. Returns {} on any
 *  error so callers safely treat it as empty (no caching). */
async function loadCache(): Promise<CacheStore> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return {}
    const r = await chrome.storage.local.get('lectorCache')
    const raw = (r as Record<string, unknown>).lectorCache
    if (!raw) return {}
    // Stored as parsed JSON already (object) OR a JSON string.
    return typeof raw === 'string' ? parseStoreFromString(raw) : parseStore(raw)
  } catch {
    return {}
  }
}

/** Parse a JSON string into a CacheStore (tolerant). Kept inline to avoid an
 *  extra import indirection; the pure parseStore is used for object input. */
function parseStoreFromString(raw: string): CacheStore {
  try {
    const obj = JSON.parse(raw)
    // Reuse the pure parseStore for validation/tolerance.
    return parseStore(obj)
  } catch {
    return {}
  }
}

/** Persist the cache to chrome.storage.local (best-effort, fire-and-forget). */
async function saveCache(store: CacheStore): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    await chrome.storage.local.set({ lectorCache: store })
  } catch {
    /* storage unavailable — caching is best-effort */
  }
}

/** Cache context threaded through the chunk workers. `keyInputs` are the
 *  values folded into the cache key (everything that affects output); the
 *  caller owns the store + persist so a run shares one store and writes once. */
interface CacheCtx {
  enabled: boolean
  ttlDays: number
  store: CacheStore
  /** (targetLang, model, glossaryBlock, personaPrompt) — source added per chunk. */
  keyInputs: { targetLang: TargetLangCode; model: string; glossaryBlock: string; personaPrompt: string }
  persist: (next: CacheStore) => void
}

/** Translate a single chunk of source text, streaming tokens into a freshly
 *  inserted `.lector-bilingual` container appended to `block`. `signal` aborts
 *  the in-flight request (cancel / language-switch / retry).
 *
 *  This is the per-chunk worker; `translateBlockChunks` splits a long block
 *  and calls this once per chunk so a 4000-char section renders as several
 *  streaming translations instead of being dropped outright.
 *
 *  Cache (Phase 5): when `cache?.enabled`, a cache hit resolves immediately
 *  (no provider call, no skeleton) and a miss streams + writes the result back
 *  into the shared store via `cache.persist`.
 *
 *  Unchanged-output guard (English→English regression): if the model echoes
 *  the source verbatim despite being asked to translate, we retry ONCE with a
 *  forceful "you must actually translate" prefix. `attempt` tracks the depth so
 *  we never loop; `targetLang` drives the unchanged detector. */
async function translateOneChunk(
  settings: ByokSettings,
  systemPrompt: string,
  block: HTMLElement,
  chunkText: string,
  targetLang: TargetLangCode,
  attempt: number,
  signal?: AbortSignal,
  cache?: CacheCtx
): Promise<string> {
  // Cache hit fast-path: resolve instantly without touching the provider.
  if (cache?.enabled) {
    const key = cacheKey(chunkText, cache.keyInputs.targetLang, cache.keyInputs.model, cache.keyInputs.glossaryBlock, cache.keyInputs.personaPrompt)
    const { value, store: touched } = getEntry(cache.store, key, cache.ttlDays)
    if (value !== null) {
      cache.store = touched
      const span = document.createElement('div')
      span.className = 'lector-bilingual'
      span.textContent = value
      const actions = makeChunkActions(span, () => {
        span.remove()
        void translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 0, undefined, cache ? cacheDisabled(cache) : undefined).catch(() => {})
      })
      span.appendChild(actions)
      block.appendChild(span)
      return value
    }
  }

  // Insert placeholder container immediately so the user sees progress.
  const span = document.createElement('div')
  span.className = 'lector-bilingual is-loading'
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  span.appendChild(caret)
  // Per-chunk hover actions: retry re-runs ONLY this chunk.
  const actions = makeChunkActions(span, () => {
    span.remove()
    // A page-level cancel aborts `signal`; reusing that dead signal would make
    // the visible Retry control permanently inert.
    void translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 0, undefined, cache ? cacheDisabled(cache) : undefined).catch(() => {})
  })
  block.appendChild(span)

  // On the forced retry, prepend an imperative instruction so the model stops
  // echoing the source. The base system prompt already requires the target
  // language, but some models need the per-turn nudge on stubborn blocks.
  const effectiveSystem = attempt > 0
    ? systemPrompt + `\n\nIMPORTANT: The previous response was identical to the source text, which means you did NOT translate it. You must translate the following text into ${getLanguage(targetLang).en} now. Do not copy the original.`
    : systemPrompt

  let acc = ''
  try {
    await streamChat(
      settings,
      [{ role: 'system', content: effectiveSystem }, { role: 'user', content: chunkText }],
      { maxTokens: maxTokensForChunk(chunkText.length), temperature: 0.2 },
      (delta) => {
        acc += delta
        span.classList.remove('is-loading')
        span.textContent = acc
        span.appendChild(actions)
      },
      signal
    )
  } catch (e) {
    // Abort is expected (cancel / language-switch) — leave whatever partial
    // text streamed so far and rethrow without an error marker. A genuine
    // failure (network / provider) leaves this chunk's span visibly errored
    // so (a) the user sees which chunk failed and (b) the worker can target
    // it rather than the first .lector-bilingual (which may be a successful
    // chunk's translation). Previously the is-loading skeleton stayed forever
    // and the block became permanently un-translatable.
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      span.textContent = acc
      span.appendChild(actions)
      throw e
    }
    span.classList.remove('is-loading')
    span.classList.add('is-error')
    span.textContent = tr('bilingual.blockError')
    span.appendChild(actions)
    throw e
  }

  // Unchanged-output guard: if the model echoed the source (the core
  // English→English symptom) OR returned nothing, retry once with the
  // forceful system prompt. Only retry on the first attempt and only when a
  // real script change was expected (the detector handles the same-script case
  // and treats empty output as "needs retry"). Disable cache on the retry so a
  // bad cached value can't poison it.
  if (attempt === 0 && isTranslationLikelyUnchanged(chunkText, acc, targetLang)) {
    span.remove()
    return translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 1, signal, cache ? cacheDisabled(cache) : undefined)
  }

  // Empty-output fallback: if the model genuinely returned nothing even after
  // the retry, do NOT show a "(空响应)" placeholder — that leaves a confusing
  // gap in the page. Fall back to the source text so the block renders its
  // original content (the model effectively decided "nothing to translate",
  // e.g. a lone URL/identifier, and the page stays readable).
  const rendered = acc || chunkText
  span.textContent = rendered
  span.appendChild(actions)

  // Cache the successful translation (only the genuine model output, not the
  // source-fallback, so we don't cache "nothing to translate").
  if (cache?.enabled && acc) {
    const key = cacheKey(chunkText, cache.keyInputs.targetLang, cache.keyInputs.model, cache.keyInputs.glossaryBlock, cache.keyInputs.personaPrompt)
    cache.store = putEntry(cache.store, key, acc, chunkText.length)
    cache.persist(cache.store)
  }
  return rendered
}

/** Translate a DOM block, splitting long text into chunks first so nothing is
 *  silently dropped. Marks the host + wraps the original content once, then
 *  appends one `.lector-bilingual` per chunk in order. `signal` aborts every
 *  chunk's request. Returns the concatenation of chunk translations. */
async function translateBlockChunks(
  settings: ByokSettings,
  systemPrompt: string,
  block: HTMLElement,
  targetLang: TargetLangCode,
  signal?: AbortSignal,
  cache?: CacheCtx
): Promise<string> {
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
  // IMPORTANT: read the source from the .lector-bi-source wrap, NOT from
  // block.textContent. On a retry, block.textContent also contains the chunk
  // translations + loading skeletons already appended below — re-reading it
  // would re-split a polluted string (source + stale translations) and append
  // a second, corrupted pass on top. Also drop any leftover chunk outputs /
  // error markers from the previous attempt so we render fresh.
  const sourceWrap = block.querySelector(':scope > .lector-bi-source')
  const original = ((sourceWrap && (sourceWrap.textContent || '')) || block.textContent || '').trim()
  block.querySelectorAll(':scope > .lector-bilingual').forEach((n) => n.remove())
  const chunks = splitBlockForTranslation(original)
  if (chunks.length === 0) return ''
  let acc = ''
  for (const chunk of chunks) {
    // Stop early if cancelled — don't start fresh chunks after an abort.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    acc += await translateOneChunk(settings, systemPrompt, block, chunk, targetLang, 0, signal, cache)
  }
  return acc
}

async function runBilingualTranslation() {
  // Re-entrancy guard: a second toggle (or a side-panel re-send) must abort
  // any in-flight run FIRST. Otherwise both runs translate the same blocks
  // (duplicate .lector-bilingual injections) and the second run's controller
  // assignment clobbers the first's, making the first uncancellable. Aborting
  // here also short-circuits the first run's runConcurrent via its signal.
  if (bilingualAbort) {
    bilingualAbort.abort()
    bilingualAbort = null
  }
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  if (!settings.apiKey) {
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-progress',
      done: 0,
      total: 0,
      complete: true,
    }).catch(() => {})
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-error',
      message: tr('err.addKey'),
    }).catch(() => {})
    return
  }
  const tSettings = normalizeTranslationSettings(settings.translation)
  applyTranslationStyle(tSettings)

  // Site rules: per-domain extra selectors / exclusions augment the default
  // block query. `pageScope` controls whether we translate the smart main
  // content root only (opt-in) or the whole document.body (default, matches the
  // long-standing behavior + Immersive Translate). A keyboard override
  // (Alt+A smart / Alt+W whole) wins for this run, then is cleared.
  const effectiveScope = bilingualScopeOverride || tSettings.pageScope
  bilingualScopeOverride = null
  const host = location.hostname
  const siteRule = findRuleForHost(tSettings.siteRules, host) || undefined
  // 'whole' (default) → translate every block in the document. 'smart' → try
  // the detected main-content root, but FALL BACK to the whole document when
  // the root is missing OR yields no candidates, so smart never silently drops
  // text (the regression that left list/app pages untranslated).
  const smartRoot = effectiveScope === 'smart' ? extractPageRoot() : null
  const scopeRoot: Element = (effectiveScope === 'whole' || !smartRoot) ? document.body : smartRoot
  const excludeExtra = siteRule?.excludeSelectors?.length
    ? siteRule.excludeSelectors.map((s) => s.trim()).filter(Boolean)
    : []
  let candidates = collectTranslationCandidates(
    scopeRoot,
    siteRule?.selectors || [],
    excludeExtra
  )
  // Smart-scope safety net: if the detected main-content root yielded nothing
  // (common on list/app/dashboard pages where prose lives outside the scored
  // root), fall back to the WHOLE document so text is never silently dropped.
  if (candidates.length === 0 && effectiveScope === 'smart') {
    candidates = collectTranslationCandidates(
      document.body,
      siteRule?.selectors || [],
      excludeExtra
    )
  }
  if (candidates.length === 0) {
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-progress',
      done: 0,
      total: 0,
      complete: true,
    }).catch(() => {})
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-error',
      message: tr('bilingual.noContent'),
    }).catch(() => {})
    return
  }

  const page = extractPage()
  // Detect translation direction from the ACTUAL page text, not a synthesized
  // probe. The old code built probeText from page.lang, but page.lang is set by
  // detectLang() which returns 'zh' if the text contains even ONE CJK char —
  // so an overwhelmingly-English page with a stray Chinese footer char flipped
  // page.lang to 'zh', which made probeText Chinese, which made resolveTargetLang
  // return 'en', which translated the English page to English. Using the real
  // page text + count-based detectScript (in resolveTargetLang) is robust to a
  // few stray CJK chars because it compares dominant script counts.
  const target = resolveTargetLang(tSettings.targetLanguage, page.text || 'Hello world')
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const persona = personaPrompt(tSettings.persona)
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock, persona)

  // Translation cache (Phase 5): load once per run, persist after. A hit skips
  // the provider call entirely; a miss streams + writes back. ttlDays 0 = off.
  const cacheOn = tSettings.cacheTtlDays > 0
  let cache: CacheStore = cacheOn ? await loadCache() : {}
  const persistCache = (() => {
    let scheduled = false
    let snapshot = cache
    return (next: CacheStore) => {
      snapshot = next
      if (scheduled) return
      scheduled = true
      // Debounce persistence so a burst of chunk completements writes once.
      setTimeout(() => {
        scheduled = false
        void saveCache(snapshot)
      }, 800)
    }
  })()

  bilingualAbort = new AbortController()
  const controller = bilingualAbort
  const total = candidates.length
  let done = 0
  const report = (complete = false) =>
    chrome.runtime
      .sendMessage({ action: 'lector-bilingual-progress', done, total, complete })
      .catch(() => {})
  report()

  // Wrap the run in try/finally so the module-level controller is always
  // released — but only if it is STILL ours. A later run may have already
  // reassigned bilingualAbort (re-entrancy); nulling it then would orphan the
  // newer run and make IT uncancellable.
  try {
  const results = await runConcurrent(
    candidates,
    async (block) => {
      // Build the cache context fresh per worker so it reads the latest shared
      // `cache` store (workers run concurrently and each may add entries). The
      // store field is a getter so a worker always sees sibling writes.
      const cacheCtx: CacheCtx | undefined = cacheOn
        ? {
            enabled: true,
            ttlDays: tSettings.cacheTtlDays,
            get store() { return cache },
            set store(v) { cache = v },
            keyInputs: { targetLang: target, model: settings.model, glossaryBlock, personaPrompt: persona },
            persist: persistCache,
          }
        : undefined
      try {
        await translateBlockChunks(settings, systemPrompt, block, target, controller.signal, cacheCtx)
      } catch (e) {
        // Don't retry (or count) once the user has cancelled.
        if (controller.signal.aborted) throw e
        // Retry once with a short backoff (still abortable).
        await new Promise((r) => setTimeout(r, 500))
        if (controller.signal.aborted) throw e
        try {
          await translateBlockChunks(settings, systemPrompt, block, target, controller.signal, cacheCtx)
        } catch (e2) {
          // The failed chunk's own span was already marked is-error inside
          // translateOneChunk's catch. Don't reach for the first .lector-bilingual
          // here — that may be a SUCCESSFUL chunk's translation, which we must
          // not overwrite with the error text.
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
    const source = (
      sample.querySelector(':scope > .lector-bi-source')?.textContent || ''
    ).trim()
    const tgt = Array.from(sample.querySelectorAll(':scope > .lector-bilingual'))
      .map(readChunkTranslation)
      .join('')
      .slice(0, 200)
    chrome.runtime
      .sendMessage({
        action: 'lector-translation-history',
        entry: {
          source: source.slice(0, 200),
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
  report(true)
  } finally {
    // Release the controller only if it is still ours. If a newer run already
    // reassigned bilingualAbort (re-entrancy), leave it alone — nulling it
    // would orphan that newer run and make it uncancellable.
    if (bilingualAbort === controller) bilingualAbort = null
  }
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

/** When set, overrides the configured pageScope for the next bilingual run.
 *  Used by the Alt+W "whole page" shortcut (and Alt+A "smart" shortcut) so the
 *  same toggleBilingual path can target either scope without a settings write.
 *  Cleared after each run. */
let bilingualScopeOverride: 'smart' | 'whole' | null = null

/** Backwards-compat entry point; the side panel / command send lector-toggle-bilingual. */
async function toggleBilingual() {
  try {
    await runBilingualTranslation()
  } catch (e) {
    const message = e instanceof Error ? e.message : tr('err.requestFailed')
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-progress',
      done: 0,
      total: 0,
      complete: true,
    }).catch(() => {})
    chrome.runtime.sendMessage({
      action: 'lector-bilingual-error',
      message,
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Shift+hover paragraph translation (Phase 6)
// ---------------------------------------------------------------------------
// Distinct from the CSS-only `hover` display mode: this is an on-demand TRIGGER
// that translates just the paragraph under the cursor when the user holds Shift
// and hovers — no pre-rendering of the whole page. Reuses translateBlockChunks
// so a hovered block gets the same chunking/cache/persona treatment.
let hoverCfg = { enabled: true, holdKey: 'Shift' as 'Shift' | 'Control' | 'Alt', debounceMs: 350 }
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let lastHoverBlock: HTMLElement | null = null
let hoverAbort: AbortController | null = null

/** On-demand single-block translation for Shift+hover. Idempotent: if the block
 *  already has a `.lector-bilingual` translation, it's a no-op (the user is just
 *  reading it). Translates only this block, scoped to its own abort so leaving
 *  the block cancels any in-flight chunk. */
async function translateBlockOnHover(block: HTMLElement) {
  // Skip if already translated (avoid duplicate injection on repeated hovers).
  if (block.querySelector(':scope > .lector-bilingual')) return
  const settings = await getSettings()
  if (!settings.apiKey) return
  const tSettings = normalizeTranslationSettings(settings.translation)
  const text = (block.textContent || '').trim()
  if (text.length < 3) return
  const target = resolveTargetLang(tSettings.targetLanguage, text)
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const persona = personaPrompt(tSettings.persona)
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock, persona)
  hoverAbort?.abort()
  const controller = new AbortController()
  hoverAbort = controller
  try {
    await translateBlockChunks(settings, systemPrompt, block, target, controller.signal)
  } catch {
    /* abort or provider error — leave whatever streamed; user can re-hover */
  } finally {
    if (hoverAbort === controller) hoverAbort = null
  }
}

document.addEventListener('mousemove', (e) => {
  if (!hoverCfg.enabled) return
  // Only trigger when the configured hold key is currently pressed.
  const held =
    (hoverCfg.holdKey === 'Shift' && e.shiftKey) ||
    (hoverCfg.holdKey === 'Control' && e.ctrlKey) ||
    (hoverCfg.holdKey === 'Alt' && e.altKey)
  if (!held) return
  const target = e.target as HTMLElement
  if (!target || !target.closest) return
  // Find the nearest translatable block ancestor.
  const block = target.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary') as HTMLElement | null
  if (!block || block === lastHoverBlock) return
  // Skip our own UI + already-excluded regions.
  if (block.closest('#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, [data-lector-no-translate]')) return
  lastHoverBlock = block
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    void translateBlockOnHover(block)
  }, hoverCfg.debounceMs)
})

document.addEventListener('keyup', () => {
  // Cancel a pending hover-translation if the user releases the hold key early.
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  hoverAbort?.abort()
  hoverAbort = null
  // Allow the same block to be attempted again on a later hold+hover gesture.
  lastHoverBlock = null
})

// ---------------------------------------------------------------------------
// Input-box translation (Phase 7)
// ---------------------------------------------------------------------------
// Immersive-style: triple-space (configurable symbol) triggers translation of
// the active input/textarea; `/xx` slash commands set the target for the call;
// `//word` partial-translates just that token. Some sites swallow multiple
// spaces, so the trigger symbol is configurable. Per-site disable is handled
// via the site rules (checked at trigger time).
let inputCfg = {
  enabled: true,
  /** Trigger string; default three spaces. Some sites (Quora) collapse these. */
  trigger: '   ',
  /** On trigger: 'replace' overwrites the field, 'append' adds a bilingual line. */
  mode: 'replace' as 'replace' | 'append',
}

/** Known-incompatible site hosts where input-box translation is off by default
 *  (matches Immersive's documented limits). The user can still force-enable it
 *  per-site via a rule, but this avoids flaky behavior on the listed domains. */
const INPUT_BLACKLIST = ['chrome.google.com', 'notion.so', 'notion.so/', 'larksuite.com', 'feishu.cn']

function inputBoxDisabledForHost(): boolean {
  const h = location.hostname.toLowerCase()
  return INPUT_BLACKLIST.some((b) => h.includes(b))
}

/** Translate the value of an editable field and write it back. The whole source
 *  value is translated (so `/ja hello world` → Japanese for "hello world",
 *  dropping the command prefix). Partial `//word` is handled per-token before
 *  this is called. */
type EditableField = HTMLInputElement | HTMLTextAreaElement | HTMLElement

function readEditableField(el: EditableField): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.value
    : el.textContent || ''
}

function writeEditableField(el: EditableField, value: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value
  } else {
    el.textContent = value
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
}

async function translateInputField(el: EditableField, targetOverride?: string) {
  const settings = await getSettings()
  if (!settings.apiKey) return
  const tSettings = normalizeTranslationSettings(settings.translation)
  const raw = readEditableField(el)
  if (!raw.trim()) return
  const target = (targetOverride && targetOverride !== 'auto'
    ? targetOverride
    : resolveTargetLang(tSettings.targetLanguage, raw))
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const persona = personaPrompt(tSettings.persona)
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock, persona)
  try {
    const out = await completeOnce(
      settings,
      systemPrompt,
      raw.slice(0, 4000),
      { maxTokens: Math.min(2000, Math.max(200, raw.length * 2)), temperature: 0.2 }
    )
    if (!out) return
    if (inputCfg.mode === 'append') {
      writeEditableField(el, raw + '\n' + out)
    } else {
      writeEditableField(el, out)
    }
  } catch {
    /* provider error — leave the field unchanged */
  }
}

/** Keydown listener for editable fields: detects the triple-space trigger,
 *  slash commands (`/xx `), and partial `//word`. Attached to the document so
 *  dynamically-added fields are covered; we filter to INPUT/TEXTAREA + contenteditable. */
document.addEventListener('keydown', (e) => {
  if (!inputCfg.enabled || inputBoxDisabledForHost()) return
  if (e.key !== ' ' && e.key !== 'Spacebar') return
  const el = e.target as HTMLElement | null
  if (!el) return
  const isField =
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
    el.isContentEditable === true
  if (!isField) return
  const field = el as EditableField
  const value = readEditableField(field)
  // Triple-space: the field already ends with two trailing spaces and this is
  // the third → fire translation, then swallow the key so the third space
  // doesn't itself land in the field.
  if (inputCfg.trigger === '   ' && value.endsWith('  ')) {
    e.preventDefault()
    // Strip the two leading trigger spaces before translating.
    const source = value.slice(0, -2)
    writeEditableField(field, source)
    // Slash command: `/xx ` at the start sets the target for this call.
    const cmdMatch = source.match(/^\s*\/([a-zA-Z-]{2,8})\s+(.*)/s)
    if (cmdMatch) {
      writeEditableField(field, cmdMatch[2])
      void translateInputField(field, cmdMatch[1].toLowerCase())
    } else {
      void translateInputField(field)
    }
  }
}, true) // capture so we see the key before the site's own handlers

// ---------------------------------------------------------------------------
// Listeners: selection → toolbar, Escape, side-panel messages
// ---------------------------------------------------------------------------
document.addEventListener('mouseup', (e) => {
  const target = e.target as HTMLElement
  if (
    target.closest('#lector-ai-toolbar') ||
    target.closest('#lector-ai-result') ||
    target.closest('#lector-ai-loading') ||
    target.closest('#lector-ai-fab') ||
    target.closest('.lector-fab-menu')
  ) {
    return
  }
  // Click outside the FAB menu → close it (and don't show a selection toolbar).
  if (fabMenu) {
    closeFabMenu()
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
    if (fabMenu) closeFabMenu()
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
    !target.closest('#lector-ai-fab') &&
    !target.closest('.lector-fab-menu')
  ) {
    if (fabMenu) closeFabMenu()
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
    // An optional `scope` ('smart'|'whole') from the keyboard shortcut forces
    // the page scope for this run only (Alt+A vs Alt+W).
    if (message.scope === 'smart' || message.scope === 'whole') {
      bilingualScopeOverride = message.scope
    }
    sendResponse({ ok: true })
    void toggleBilingual()
    return false
  }
  if (message?.action === 'lector-translate-selection') {
    // Alt+Q: translate the current selection directly (no manual toolbar click).
    // Reuses the selection-translate pipeline so persona + target picker are
    // honored identically. Position falls back to top-left when no toolbar is
    // open (keyboard-triggered).
    sendResponse({ ok: true })
    void (async () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() || ''
      if (text.length < 2) return
      await loadPref()
      runByokAction('translate', text)
    })()
    return false
  }
  if (message?.action === 'lector-cancel-bilingual') {
    cancelBilingual()
    sendResponse({ ok: true })
    return false
  }
  if (message?.action === 'lector-translation-settings-changed') {
    // Re-apply the full translation styling live (theme/font/focus/mode)
    // without re-translating.
    void (async () => {
      const s = await getSettings()
      const ts = normalizeTranslationSettings(s.translation)
      applyTranslationStyle(ts)
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

// Apply saved presentation settings immediately and honor automatic/site-level
// translation rules. Previously the Settings UI persisted autoTranslate and
// always/never rules, but the content script never consulted them on page load,
// so the controls appeared to work while doing nothing.
void (async () => {
  try {
    const settings = await getSettings()
    cachedPref = settings.locale ?? 'auto'
    const ts = normalizeTranslationSettings(settings.translation)
    applyTranslationStyle(ts)
    const rule = findRuleForHost(ts.siteRules, location.hostname)
    const shouldAutoRun =
      settings.apiKey && shouldAutoTranslatePage(ts.autoTranslate, rule)
    if (shouldAutoRun) {
      // Yield once so late document-idle mutations and the page's first paint
      // are not blocked by candidate collection.
      setTimeout(() => { void toggleBilingual() }, 0)
    }
  } catch {
    // Extension context/storage may have been invalidated during navigation.
    // Manual translation remains available after a refresh.
  }
})()
