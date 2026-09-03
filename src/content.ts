// Lector AI content script.
//
// Responsibilities:
//   1. Clean page extraction (a tiny Readability-like heuristic) → feeds the
//      side panel's "chat with this page".
//   2. Selection toolbar: translate / summarize / explain / ask.
//   3. Floating "Open Lector" button to summon the side panel.
//   4. Inline bilingual paragraph translation (Immersive-Translate style).

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
    @keyframes lectorShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
    @keyframes lectorFabPulse { 0%,100%{ box-shadow: 0 6px 20px rgba(143,94,48,.32);} 50%{ box-shadow: 0 8px 28px rgba(122,78,39,.5);} }
    #lector-ai-fab { position: fixed; right: 20px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%; background: #8F5E30; color: #FFF6EA; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; font-family: Georgia, 'Iowan Old Style', 'Source Serif Pro', serif; cursor: pointer; z-index: 2147483646; box-shadow: 0 6px 20px rgba(143,94,48,.32); animation: lectorFabPulse 3s ease-in-out infinite; transition: transform .22s cubic-bezier(0.16,1,0.3,1), background-color .15s ease; user-select: none; touch-action: none; }
    #lector-ai-fab:hover { transform: scale(1.08); background: #7A4E27; }
    #lector-ai-fab.is-open { transform: rotate(45deg); animation: none; background: #7A4E27; }
    #lector-ai-fab.is-open:hover { transform: rotate(45deg) scale(1.08); }
    /* While a whole-page bilingual run is in flight the FAB doubles as the
       status indicator (Immersive-style): the letter hides and a spinner ring
       takes its place. Class lifetime is owned by runBilingualTranslation. */
    #lector-ai-fab.is-translating { animation: none; color: transparent; }
    #lector-ai-fab.is-translating:hover { transform: none; }
    #lector-ai-fab.is-translating::after { content: ''; position: absolute; inset: 7px; border: 2px solid rgba(255,246,234,.3); border-top-color: #FFF6EA; border-radius: 50%; animation: lectorSpin .9s linear infinite; }
    /* While dragging: kill the pulse + hover-scale transitions so left/top
       track the pointer 1:1, lift the z-index above the (z-2147483647) result
       popups, and let the pointer grab. touch-action:none (on the base rule)
       keeps touch drags from scrolling the page instead of moving the FAB. */
    #lector-ai-fab.is-dragging { animation: none; transition: none; cursor: grabbing; z-index: 2147483647; box-shadow: 0 10px 30px rgba(122,78,39,.4); }
    #lector-ai-fab.is-dragging:hover { transform: none; background: #8F5E30; }
    /* Radial quick-action menu: items fan out from the FAB center along an
       upward arc. Each item is a circular button with a hover tooltip label. */
    .lector-fab-menu { position: fixed; z-index: 2147483645; pointer-events: none; }
    .lector-fab-item { position: absolute; width: 44px; height: 44px; border-radius: 50%; background: #FFF6EA; color: #5C5347; border: 1px solid #E2D5BB; box-shadow: 0 4px 14px rgba(38,33,27,.18); cursor: pointer; display: flex; align-items: center; justify-content: center; pointer-events: auto; opacity: 0; transform: translate(0,0) scale(.4); transition: transform .26s cubic-bezier(0.18,1.2,0.4,1), opacity .18s ease; will-change: transform, opacity; }
    .lector-fab-item svg { width: 20px; height: 20px; display: block; }
    .lector-fab-item:hover { background: #8F5E30; color: #FFF6EA; transform: var(--lector-rest) scale(1.1); }
    .lector-fab-label { position: absolute; right: 54px; top: 50%; transform: translateY(-50%); background: rgba(38,33,27,.92); color: #FFF6EA; font-size: 11px; font-weight: 500; padding: 3px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .12s ease; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .lector-fab-label.flip-right { right: auto; left: 54px; }
    .lector-fab-item:hover .lector-fab-label { opacity: 1; }
    #lector-ai-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 2px; padding: 4px 6px; border-radius: 14px; max-width: calc(100vw - 16px); }
    #lector-ai-toolbar .t-btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px; border: none; border-radius: 8px; background: transparent; color: #5C5347; cursor: pointer; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; transition: background-color .15s ease, color .15s ease, transform .1s ease; }
    #lector-ai-toolbar .t-btn svg { width: 15px; height: 15px; display: block; flex: none; }
    #lector-ai-toolbar .t-btn:hover { background: rgba(143,94,48,.12); color: #8F5E30; }
    #lector-ai-toolbar .t-btn:active { transform: translateY(1px); }
    #lector-ai-toolbar .t-divider { width: 1px; height: 18px; margin: 0 4px; background: currentColor; opacity: .15; flex: none; }
    #lector-ai-toolbar.is-dark .t-btn { color: rgba(255,255,255,.8); }
    #lector-ai-toolbar.is-dark .t-btn:hover { background: rgba(255,255,255,.12); color: #FFF6EA; }
    #lector-ai-result .result-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #E2D5BB; }
    #lector-ai-result .result-title { font-size:13px; font-weight:700; color:#8F5E30; display:flex; align-items:center; gap:6px; }
    #lector-ai-result .result-content { font-size:13px; line-height:1.7; color:#26211B; white-space:pre-wrap; word-break:break-word; }
    #lector-ai-result .result-content p { margin: 0 0 8px; }
    #lector-ai-result .action-btn { flex:1; padding:8px 12px; border:none; border-radius:10px; font-size:12px; font-weight:600; cursor:pointer; transition:background-color .15s ease, box-shadow .15s ease, transform .1s ease; }
    #lector-ai-result .action-btn:active { transform: translateY(1px); }
    #lector-ai-result .action-btn.primary { background:#8F5E30; color:#FFF6EA; }
    #lector-ai-result .action-btn.primary:hover { background:#7A4E27; box-shadow:0 4px 12px rgba(143,94,48,.3); }
    #lector-ai-result .copy-btn { flex:1; padding:8px 12px; border:none; border-radius:10px; font-size:12px; font-weight:600; background:#F1E9D8; color:#5C5347; cursor:pointer; transition:background-color .15s ease, transform .1s ease; }
    #lector-ai-result .copy-btn:active { transform: translateY(1px); }
    #lector-ai-result .copy-btn:hover { background:#E2D5BB; }
    /* Self-drawn language dropdown for the streaming translate popup. The
       native <select> popup is OS-rendered and can't follow the popup's warm
       paper styling, so we render a button + listbox ourselves. */
    .lector-lang-dd { position: relative; display: inline-flex; }
    .lector-lang-dd-trigger { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px 0 10px; border-radius: 7px; border: 1px solid #E2D5BB; background: #F1E9D8; color: #5C5347; font-size: 11px; font-weight: 600; cursor: pointer; line-height: 1; transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
    .lector-lang-dd-trigger:hover { background: #E2D5BB; color: #26211B; }
    .lector-lang-dd-trigger.is-open { background: #8F5E30; border-color: #8F5E30; color: #FFF6EA; }
    .lector-lang-dd-trigger svg { width: 10px; height: 10px; display: block; }
    .lector-lang-dd-list { position: absolute; top: calc(100% + 6px); right: 0; min-width: 168px; max-height: 236px; overflow-y: auto; background: #FFFFFF; border: 1px solid #E2D5BB; border-radius: 10px; box-shadow: 0 4px 10px rgba(66,45,16,.06), 0 16px 36px rgba(66,45,16,.14); padding: 4px; z-index: 2; animation: lectorFadeIn .15s ease-out; }
    .lector-lang-dd-list.is-up { top: auto; bottom: calc(100% + 6px); }
    .lector-lang-dd-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: #5C5347; font-size: 11px; text-align: left; cursor: pointer; line-height: 1.3; }
    .lector-lang-dd-item:hover { background: rgba(143,94,48,.1); color: #26211B; }
    .lector-lang-dd-item.is-selected { color: #8F5E30; font-weight: 600; }
    .lector-lang-dd-check { width: 12px; height: 12px; flex: none; opacity: 0; }
    .lector-lang-dd-item.is-selected .lector-lang-dd-check { opacity: 1; }
    /* Popup chrome: paper surface with visible border + warm shadow, shared by
       the loading pill and the result cards. Dynamic geometry (left/top/
       max-height) stays inline; the look lives here. */
    .lector-pop { position: fixed; z-index: 2147483647; max-width: 420px; padding: 16px; background: #FFFFFF; border: 1px solid #E2D5BB; border-radius: 14px; box-shadow: 0 4px 10px rgba(66,45,16,.06), 0 16px 36px rgba(66,45,16,.12); font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .25s ease-out; }
    .lector-pop-loading { padding: 12px 18px; display: flex; align-items: center; gap: 8px; font-size: 13px; color: #8F5E30; border-radius: 12px; }
    #lector-ai-result .result-close { padding: 4px 8px; border: none; background: #F1E9D8; border-radius: 6px; cursor: pointer; font-size: 11px; color: #7A6E5C; transition: background-color .15s ease, color .15s ease; }
    #lector-ai-result .result-close:hover { background: #E2D5BB; color: #26211B; }
    #lector-ai-result .result-footer { margin-top: 12px; padding-top: 10px; border-top: 1px solid #E2D5BB; display: flex; gap: 8px; flex-wrap: wrap; }
    /* Dark-page popup variant: same warm genes, deep values (mirrors the
       sidepanel dark theme). Toggled via .lector-pop-dark on the popup root. */
    .lector-pop-dark.lector-pop { background: #2A241C; border-color: #3B3226; box-shadow: 0 4px 10px rgba(0,0,0,.35), 0 16px 36px rgba(0,0,0,.45); }
    .lector-pop-dark#lector-ai-loading { color: #C89866; }
    .lector-pop-dark#lector-ai-loading .lector-pop-spinner { border-color: rgba(255,255,255,.22); border-top-color: #C89866; }
    .lector-pop-dark#lector-ai-result .result-title { color: #C89866; }
    .lector-pop-dark#lector-ai-result .result-header { border-bottom-color: #3B3226; }
    .lector-pop-dark#lector-ai-result .result-content { color: #EAE0CC; }
    .lector-pop-dark#lector-ai-result .copy-btn { background: rgba(255,255,255,.08); color: #EAE0CC; }
    .lector-pop-dark#lector-ai-result .copy-btn:hover { background: rgba(255,255,255,.14); }
    .lector-pop-dark#lector-ai-result .action-btn.primary { background: #C89866; color: #221709; }
    .lector-pop-dark#lector-ai-result .action-btn.primary:hover { background: #DBAF7E; }
    .lector-pop-dark#lector-ai-result .result-close { background: rgba(255,255,255,.08); color: #BFB299; }
    .lector-pop-dark#lector-ai-result .result-close:hover { background: rgba(255,255,255,.14); }
    .lector-pop-dark#lector-ai-result .result-footer { border-top-color: #3B3226; }
    .lector-pop-dark .lector-lang-dd-trigger { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); color: rgba(255,255,255,.85); }
    .lector-pop-dark .lector-lang-dd-trigger:hover { background: rgba(255,255,255,.14); color: #FFF6EA; }
    .lector-pop-dark .lector-lang-dd-trigger.is-open { background: #C89866; border-color: #C89866; color: #221709; }
    .lector-pop-dark .lector-lang-dd-list { background: #2A241C; border-color: #3B3226; }
    .lector-pop-dark .lector-lang-dd-item { color: #BFB299; }
    .lector-pop-dark .lector-lang-dd-item:hover { background: rgba(200,152,102,.14); color: #EAE0CC; }
    .lector-pop-dark .lector-lang-dd-item.is-selected { color: #C89866; }
    /* Popup header is also the drag handle (DeepL-style movable popup). The
       grab cursor is the affordance; pointer handling lives in makeDraggable. */
    .lector-pop .result-header { cursor: grab; user-select: none; }
    .lector-pop .result-header:active { cursor: grabbing; }
    /* Detected source-language badge in the streaming translate popup: shows
       the direction ("EN →") next to the target picker so auto direction is
       visible and auditable. Compact uppercase code keeps the header tight. */
    .lector-src-badge { flex: none; font-size: 10px; font-weight: 700; letter-spacing: .4px; color: #8F5E30; background: rgba(143,94,48,.1); border-radius: 5px; padding: 3px 6px; line-height: 1; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .lector-pop-dark .lector-src-badge { color: #C89866; background: rgba(200,152,102,.16); }
    /* On-page translation status toast — the page-level twin of the sidepanel
       progress readout (Imm/Google-style): progress + cancel while running,
       result actions when done, error attribution on failure. Warm paper genes;
       dark variant mirrors the popup dark mode. */
    .lector-tstatus { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483646; display: flex; align-items: center; gap: 10px; padding: 8px 12px; max-width: calc(100vw - 24px); background: #FFF6EA; border: 1px solid #E2D5BB; border-radius: 12px; box-shadow: 0 4px 10px rgba(66,45,16,.06), 0 12px 28px rgba(66,45,16,.16); font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size: 12px; color: #26211B; animation: lectorFadeIn .25s ease-out; }
    .lector-tstatus.lector-tstatus-dark { background: #2A241C; border-color: #3B3226; color: #EAE0CC; box-shadow: 0 4px 10px rgba(0,0,0,.35), 0 12px 28px rgba(0,0,0,.45); }
    .lector-tstatus .ts-text { display: flex; align-items: center; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lector-tstatus .ts-text.is-error { color: #c0392b; white-space: normal; }
    .lector-tstatus.lector-tstatus-dark .ts-text.is-error { color: #E8837A; }
    .lector-tstatus .ts-bar { flex: none; width: 108px; height: 4px; border-radius: 2px; background: rgba(143,94,48,.18); overflow: hidden; }
    .lector-tstatus .ts-bar-fill { height: 100%; width: 0%; background: #8F5E30; border-radius: 2px; transition: width .3s ease; }
    .lector-tstatus.lector-tstatus-dark .ts-bar { background: rgba(255,255,255,.14); }
    .lector-tstatus.lector-tstatus-dark .ts-bar-fill { background: #C89866; }
    .lector-tstatus .ts-btn { flex: none; border: none; border-radius: 7px; padding: 5px 10px; font-size: 11px; font-weight: 600; line-height: 1; cursor: pointer; background: rgba(143,94,48,.12); color: #8F5E30; transition: background-color .15s ease; font-family: inherit; }
    .lector-tstatus .ts-btn:hover { background: rgba(143,94,48,.22); }
    .lector-tstatus.lector-tstatus-dark .ts-btn { background: rgba(200,152,102,.16); color: #C89866; }
    .lector-tstatus.lector-tstatus-dark .ts-btn:hover { background: rgba(200,152,102,.28); }
    .lector-tstatus .ts-close { flex: none; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: #7A6E5C; cursor: pointer; border-radius: 6px; padding: 0; transition: background-color .15s ease, color .15s ease; }
    .lector-tstatus .ts-close:hover { background: rgba(38,33,27,.08); color: #26211B; }
    .lector-tstatus.lector-tstatus-dark .ts-close { color: #BFB299; }
    .lector-tstatus.lector-tstatus-dark .ts-close:hover { background: rgba(255,255,255,.12); color: #FFF6EA; }
    .lector-bilingual { display:block; font-size:.92em; line-height:1.6; color:#5C5347; border-left:3px solid #8F5E30; padding:4px 0 4px 12px; margin:8px 0 8px 4px; border-radius:0 3px 3px 0; position:relative; transition:opacity .2s ease; }
    /* Loading skeleton: before the first token lands, the blinking caret morphs
       into a shimmering ghost bar (Immersive-style placeholder) so the block
       keeps a stable line box instead of collapsing to a 2px sliver. */
    .lector-bilingual.is-loading { opacity:1; }
    .lector-bilingual.is-loading .lector-bi-caret { width: 46%; height: .82em; vertical-align: middle; border-radius: 3px; margin-left: 0; background: linear-gradient(90deg, rgba(143,94,48,.14) 25%, rgba(143,94,48,.30) 37%, rgba(143,94,48,.14) 63%); background-size: 400% 100%; animation: lectorShimmer 1.3s ease infinite; }
    .lector-bilingual.is-error { border-left-color:#c0392b; color:#c0392b; }
    .lector-bi-caret { display:inline-block; width:2px; height:1em; background:#8F5E30; vertical-align:text-bottom; margin-left:1px; animation:lectorBlink 1s steps(2) infinite; }
    @keyframes lectorBlink { 50% { opacity:0; } }
    .lector-bi-actions { position:absolute; right:6px; top:-10px; display:none; gap:4px; background:#FFF6EA; border:1px solid #E2D5BB; border-radius:6px; padding:2px 4px; box-shadow:0 2px 8px rgba(0,0,0,.1); z-index:1; }
    .lector-bilingual:hover .lector-bi-actions { display:flex; }
    /* While a whole-page run is in flight, per-chunk Retry/Copy stay hidden:
       clicking Retry mid-run would race the run's own ownership of the block. */
    body.lector-bilingual-run-active .lector-bi-actions { display:none !important; }
    /* An error chunk has no translation to read on hover — its Retry affordance
       must be persistently visible, not hover-gated. */
    .lector-bilingual.is-error .lector-bi-actions { display:flex; }
    .lector-bi-actions button { border:none; background:transparent; color:#8F5E30; cursor:pointer; font-size:11px; padding:2px 4px; border-radius:4px; }
    .lector-bi-actions button:hover { background:rgba(143,94,48,.12); }
    /* display modes (toggled via body class set by content script) */
    body.lector-dm-translationOnly .lector-bilingual-host > .lector-bi-source-node { display:none !important; }
    body.lector-dm-translationOnly .lector-bilingual-host.lector-translation-error > .lector-bi-source-node { display:initial !important; }
    body.lector-dm-hover .lector-bilingual { display:none; }
    body.lector-dm-hover .lector-bilingual-host:hover .lector-bilingual { display:block; }
  `
  document.head.appendChild(style)
}

injectStyles()

// ---------------------------------------------------------------------------
// Page extraction — pick the densest article-like container and strip noise.
// ---------------------------------------------------------------------------

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
    const text = (el.textContent || '').trim()
    const linkCount = el.querySelectorAll('a').length
    const wordCount = text ? text.split(/\s+/).length : 0
    const score = scoreNodeFromStats({ text, linkCount, wordCount })
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

export function extractPage(): ExtractedPage {
  const root = findBestContentRoot()

  // Collect paragraph-ish text preserving some structure, tagging the LIVE DOM
  // nodes with stable ids so citations (Feature ①) can jump back to them.
  // Clear tags from any previous run FIRST: on SPAs the old article's nodes can
  // survive a route change, and a stale [data-lector-id="bN"] would win the
  // jump-to querySelector and scroll the citation to the wrong article.
  document.querySelectorAll('[data-lector-id]').forEach((el) => {
    try {
      el.removeAttribute('data-lector-id')
    } catch {
      // ignore nodes that reject attribute mutation
    }
  })
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
    // Fallback for extraction-hostile pages: clone and strip noise only now —
    // the clone is pointless overhead on the (common) happy path.
    // Clone before stripping so we don't mutate the live page.
    const clone = root.cloneNode(true) as Element
    NOISE_SELECTORS.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((n) => n.remove())
    })
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
    lang: detectSourceLang(text),
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

// --- Draggable FAB position -------------------------------------------------
// The FAB defaults to bottom-right via CSS (right/bottom). Once the user drags
// it, the position is switched to explicit left/top (right/bottom cleared),
// clamped inside the viewport, and persisted to chrome.storage.local under
// 'lectorFabPos' so every tab/page restores it. All storage access is guarded
// the same way as the relays above: an orphaned content script must keep the
// drag working (position applies live), just without persistence.
let fabPos: FabPosition | null = null

function applyFabPosition(pos: FabPosition): void {
  if (!fab) return
  // right/bottom must be cleared explicitly, else left/right fight and the
  // computed position lands mid-way between them.
  fab.style.left = `${pos.left}px`
  fab.style.top = `${pos.top}px`
  fab.style.right = 'auto'
  fab.style.bottom = 'auto'
}

/** Restore a persisted FAB position (clamped into the current viewport — the
 *  saved coordinates may come from a larger window / another monitor). */
function restoreFabPosition(pos: FabPosition): void {
  fabPos = clampFabPosition(pos, window.innerWidth, window.innerHeight)
  applyFabPosition(fabPos)
}

async function loadFabPosition(): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    const r = await chrome.storage.local.get('lectorFabPos')
    const saved = (r as Record<string, unknown>)?.lectorFabPos
    if (isFabPosition(saved)) restoreFabPosition(saved)
  } catch {
    // orphaned context / storage unavailable — keep the CSS default position
  }
}

/** Best-effort persist; never throws (orphan-safe). */
function saveFabPosition(): void {
  if (!fabPos) return
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    void chrome.storage.local.set({ lectorFabPos: fabPos })
  } catch {
    // sync "Extension context invalidated" throw — swallow
  }
}

interface FabDragState {
  pointerId: number
  startX: number
  startY: number
  origLeft: number
  origTop: number
  moved: boolean
}

// Set after a real drag; consumed by the FAB's onclick so releasing a drag
// doesn't also toggle the menu open (browsers still fire click after pointerup
// of a drag). Must live at module scope, not inside attachFabDrag: the onclick
// guard runs inside ensureFab's handler, and for events targeting the FAB
// itself listeners fire in REGISTRATION order regardless of capture flag, so
// a later-registered capture listener cannot preempt the earlier onclick.
// Reset on the next pointerdown so a canceled gesture doesn't eat the next
// real click.
let suppressFabClick = false

/** Attach the pointer-drag interaction to the FAB: press-and-move past
 *  FAB_DRAG_THRESHOLD_PX drags (with live clamping); a press released without
 *  crossing it stays a click and toggles the radial menu as before.
 *  setPointerCapture keeps the gesture alive when the pointer leaves the FAB
 *  (or the window) mid-drag. */
function attachFabDrag(): void {
  if (!fab) return
  let drag: FabDragState | null = null

  fab.addEventListener('pointerdown', (e) => {
    if (drag) return // ignore a second finger mid-drag
    if (e.button !== 0 && e.pointerType === 'mouse') return
    suppressFabClick = false
    const rect = fab!.getBoundingClientRect()
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    }
    try {
      fab!.setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort; the move/up listeners on the FAB still work
      // as long as the pointer stays over it
    }
  })

  fab.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD_PX) return
      drag.moved = true
      fab!.classList.add('is-dragging')
      // A drag starting with the menu open closes it (the menu anchors to the
      // FAB, so it would chase the FAB across the screen otherwise).
      if (fabMenu) closeFabMenu()
    }
    fabPos = clampFabPosition(
      { left: drag.origLeft + dx, top: drag.origTop + dy },
      window.innerWidth,
      window.innerHeight
    )
    applyFabPosition(fabPos)
  })

  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const wasDrag = drag.moved
    drag = null
    if (!wasDrag) return
    suppressFabClick = true
    fab!.classList.remove('is-dragging')
    // Clamp once more against the CURRENT viewport, then persist.
    if (fabPos) fabPos = clampFabPosition(fabPos, window.innerWidth, window.innerHeight)
    if (fabPos) applyFabPosition(fabPos)
    saveFabPosition()
  }
  fab.addEventListener('pointerup', endDrag)
  fab.addEventListener('pointercancel', endDrag)
}

// A saved position can reference a viewport larger than the current window
// (shrunk browser, smaller monitor). Re-clamp on resize so the FAB never ends
// up stranded outside the visible area. No re-persist: the clamped value only
// matters for this viewport; the next load re-clamps anyway.
window.addEventListener('resize', () => {
  if (!fabPos) return
  fabPos = clampFabPosition(fabPos, window.innerWidth, window.innerHeight)
  applyFabPosition(fabPos)
})

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
    // A just-finished drag must not toggle the menu open (see suppressFabClick).
    if (suppressFabClick) {
      suppressFabClick = false
      return
    }
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
  attachFabDrag()
  void loadFabPosition()
}

/** Best-effort runtime message send for orphan-safe relays. Once the
 *  extension is reloaded/updated, a still-running content script becomes
 *  "orphaned": chrome.runtime.id reads as undefined and sendMessage throws
 *  SYNCHRONOUSLY ("Extension context invalidated") — a returned-promise
 *  .catch() can't catch that, and the throw escaping an async function shows
 *  up as "Uncaught (in promise) Error: Extension context invalidated". All
 *  fire-and-forget relays (progress/history/error) must go through here.
 *  Returns the (already error-swallowed) response promise, or undefined when
 *  the context is gone / the call threw. */
export function safeRuntimeSend(message: object): Promise<unknown> | undefined {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return undefined
    return chrome.runtime.sendMessage(message).catch(() => undefined)
  } catch {
    return undefined
  }
}

/** Best-effort: ask the background to open the side panel. Wrapped because a
 *  sendMessage call throws synchronously once the extension context is
 *  invalidated; a returned-promise .catch() can't catch that. */
function tryOpenSidePanel() {
  safeRuntimeSend({ action: 'open-side-panel' })
}

/** Best-effort: ask the background to open the side panel WITH a seed (e.g. a
 *  translation/chat continuation). Same context-invalidation guard as
 *  tryOpenSidePanel — the raw sendMessage().catch() the seed sites used could
 *  not catch the synchronous "Extension context invalidated" throw. */
function tryOpenSidePanelWithSeed(seed: object): void {
  safeRuntimeSend({ action: 'open-side-panel', seed })
}

/** Shared summarizer system prompt (used by summarizePage + runByokAction). */
const SUMMARIZE_SYSTEM_PROMPT =
  'You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.'

/** Selector for any Lector-injected UI element. Used to ignore clicks/selections
 *  that originate inside our own popups/FAB (3 sites used to hand-write this).
 *  Includes [data-lector-no-translate] which the hover guard already used but the
 *  click/selection guards missed. */
const LECTOR_UI_SELECTOR =
  '#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, .lector-fab-menu, .lector-tstatus, [data-lector-no-translate]'

function isLectorUiTarget(target: HTMLElement): boolean {
  return !!target.closest(LECTOR_UI_SELECTOR)
}

/** Open self-drawn language dropdowns (see createLangDropdown). Popup teardown
 *  closes them so their capture-phase document listeners and detached DOM
 *  don't leak when the host popup is removed without going through closeList
 *  (e.g. Escape → removeResult). */
const openDropdownClosers = new Set<() => void>()
function closeAllDropdowns(): void {
  for (const close of Array.from(openDropdownClosers)) close()
  openDropdownClosers.clear()
}

/** Tear down any currently-open loading/result popup. Replaces the
 *  `removeLoading(); removeResult();` opener repeated at 3 show* sites. */
function clearPopups(): void {
  removeLoading()
  removeResult()
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
  const settings = await requireApiKey(x, y, 'summary')
  if (!settings) return
  const pageText = extractPage().text
  try {
    const out = await completeOnce(settings, SUMMARIZE_SYSTEM_PROMPT, pageText.slice(0, 8000), {
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
 *  current locale (which can change without a reload) AND the live translation
 *  state: the primary action is a true toggle (Immersive-style) — run in
 *  flight → cancel; translations shown → restore original; otherwise →
 *  translate. A display-mode cycle item sits right after it so the
 *  bilingual/translation-only/hover switch never requires the side panel. */
function fabActions(): FabAction[] {
  let primary: FabAction
  if (bilingualAbort) {
    primary = {
      id: 'cancelTranslate',
      label: tr('fab.menu.cancelTranslate'),
      icon: FAB_MENU_ICONS.cancelTranslate,
      run: () => cancelBilingual(),
    }
  } else if (pageHasTranslations()) {
    primary = {
      id: 'restoreOriginal',
      label: tr('fab.menu.restoreOriginal'),
      icon: FAB_MENU_ICONS.restoreOriginal,
      run: () => restorePageTranslations(),
    }
  } else {
    primary = {
      id: 'translatePage',
      label: tr('fab.menu.translatePage') + ` (${tr('fab.menu.translatePageHint')})`,
      icon: FAB_MENU_ICONS.translatePage,
      run: () => {
        void toggleBilingual()
      },
    }
  }
  return [
    primary,
    {
      id: 'displayMode',
      label: tr('fab.menu.displayMode').replace('{mode}', displayModeLabel(currentDisplayMode)),
      icon: FAB_MENU_ICONS.displayMode,
      run: () => {
        void cycleDisplayMode()
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
  // polar coordinates relative to that point. The origin is then clamped so
  // every item stays in the viewport — without it, the rightmost item already
  // overflows the right edge at the FAB's default bottom-right spot.
  const fr = fab.getBoundingClientRect()
  const cx = fr.left + fr.width / 2
  const cy = fr.top + fr.height / 2
  const R = 76 // arc radius (px) from FAB center to each item center
  // Spread across a semicircle so items don't overlap the edge. Geometry
  // lives in src/shared/ so it can be unit-tested. Once the FAB is draggable,
  // "up" isn't always available: dragged near the top edge, the menu flips and
  // fans downward instead (classic bottom-anchored look stays the default).
  const { startDeg, endDeg } = fabMenuArcDegrees(fr.top, window.innerHeight)
  const positions = fanOutPositions(actions.length, R, startDeg, endDeg)
  const origin = clampFabMenuOrigin(cx, cy, positions, window.innerWidth, window.innerHeight)
  menu.style.left = `${origin.cx}px`
  menu.style.top = `${origin.cy}px`
  const labelFlipChecks: Array<() => void> = []
  actions.forEach((a, i) => {
    const { dx, dy } = positions[i] // negative dy = upward (screen y grows downward)
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
    // Labels rest to the item's LEFT (toward the FAB at the default right-edge
    // spot). When the FAB is parked near the left edge that side has no room —
    // flip this one label to the item's right. Deferred until the menu is in
    // the DOM so offsetWidth measures the real rendered width.
    labelFlipChecks.push(() => {
      if (origin.cx + dx - 22 - label.offsetWidth - 54 < 8) {
        label.classList.add('flip-right')
      }
    })
  })
  document.body.appendChild(menu)
  for (const check of labelFlipChecks) check()
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
  // cancel an in-flight page translation (slash circle)
  cancelTranslate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
  // restore the original (untranslated) page (eye)
  restoreOriginal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  // cycle bilingual display mode (text lines)
  displayMode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 11h16"/><path d="M4 16h10"/></svg>',
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
      const rgb = parseCssRgb(getComputedStyle(el).backgroundColor)
      if (rgb) {
        // alpha 0 → transparent → keep walking; otherwise threshold on luminance.
        const a = typeof rgb.a === 'number' ? rgb.a : 1
        if (a > 0) return relativeLuminance(rgb) < 0.35
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
    ? `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: rgba(28,28,30,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 4px 16px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.18); color: #fff; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`
    : `position: fixed; left: ${x}px; top: ${y}px; display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: rgba(255,255,255,.82); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); border: 1px solid rgba(255,255,255,.6); box-shadow: 0 4px 16px rgba(38,33,27,.14), 0 1px 2px rgba(38,33,27,.06); color: #26211B; z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .2s ease-out;`

  const mk = (actionId: string, label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.className = 't-btn'
    b.type = 'button'
    b.title = label
    b.setAttribute('aria-label', label)
    // Icon + visible text label: an icon-only pill requires hovering every
    // button to learn what it does; the 7 dense actions benefit from words.
    b.innerHTML = TOOLBAR_ICONS[actionId]
    const text = document.createElement('span')
    text.textContent = label
    b.appendChild(text)
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
  // The toolbar is created inside the mouseup→setTimeout pipeline; the browser
  // fires the trailing click right after. Start the outside-click grace window
  // so the permanent handleClickOutside doesn't dismiss it immediately.
  lectorUiOpenedAt = Date.now()
}

function removeToolbar() {
  if (selectionToolbar) {
    selectionToolbar.remove()
    selectionToolbar = null
  }
}

/**
 * Self-drawn language dropdown for the streaming translate popup. The native
 * <select>'s option popup is OS-rendered, so it can't follow the popup's warm
 * paper styling or its dark-page variant — hence a button + listbox pair.
 * `onPick` receives the raw value ('auto' or a TargetLangCode).
 */
function createLangDropdown(
  opts: { value: string; autoLabel: string; onPick: (raw: string) => void }
): HTMLElement {
  const root = document.createElement('div')
  root.className = 'lector-lang-dd'

  const entries: Array<{ value: string; label: string }> = [
    { value: 'auto', label: opts.autoLabel },
    ...LANGUAGES.map((l) => ({ value: l.code, label: cachedPref === 'zh' ? l.zh : l.en })),
  ]
  let cur = entries.some((e) => e.value === opts.value) ? opts.value : 'auto'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'lector-lang-dd-trigger'
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  const tLabel = document.createElement('span')
  const tChevron = document.createElement('span')
  tChevron.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
  trigger.appendChild(tLabel)
  trigger.appendChild(tChevron)

  let list: HTMLElement | null = null
  // Track open dropdowns at module level so popup teardown (Escape, popup
  // replacement) can close them and drop their capture-phase document
  // listener. Without this, removing the popup while a list was open leaked
  // the listener — and its detached DOM subtree — for the page's lifetime.
  const onDocMouseDown = (e: Event) => {
    if (list && !root.contains(e.target as Node)) closeList()
  }
  const closeList = () => {
    list?.remove()
    list = null
    trigger.classList.remove('is-open')
    trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('mousedown', onDocMouseDown, true)
    openDropdownClosers.delete(closeList)
  }
  const labelFor = (v: string) => entries.find((e) => e.value === v)?.label ?? v
  const setCur = (v: string) => {
    cur = v
    tLabel.textContent = labelFor(v)
    if (list) {
      list.querySelectorAll<HTMLElement>('.lector-lang-dd-item').forEach((it) => {
        it.classList.toggle('is-selected', it.dataset.value === v)
      })
    }
  }
  setCur(cur)

  const openList = () => {
    if (list) return
    list = document.createElement('div')
    list.className = 'lector-lang-dd-list'
    list.setAttribute('role', 'listbox')
    trigger.setAttribute('aria-expanded', 'true')
    for (const e of entries) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'lector-lang-dd-item'
      item.dataset.value = e.value
      item.setAttribute('role', 'option')
      if (e.value === cur) item.classList.add('is-selected')
      const name = document.createElement('span')
      name.textContent = e.label
      const check = document.createElement('span')
      check.className = 'lector-lang-dd-check'
      check.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      item.appendChild(name)
      item.appendChild(check)
      item.onclick = (ev) => {
        ev.stopPropagation()
        setCur(e.value)
        closeList()
        opts.onPick(e.value)
      }
      list.appendChild(item)
    }
    root.appendChild(list)
    trigger.classList.add('is-open')
    // Flip above the trigger when the viewport has no room below.
    const r = trigger.getBoundingClientRect()
    if (window.innerHeight - r.bottom < 260 && r.top > 260) list.classList.add('is-up')
    document.addEventListener('mousedown', onDocMouseDown, true)
    openDropdownClosers.add(closeList)
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'center' })
  }
  trigger.onclick = (e) => {
    e.stopPropagation()
    if (list) closeList()
    else openList()
  }
  root.appendChild(trigger)
  return root
}

// ---------------------------------------------------------------------------
// Loading + result popups
// ---------------------------------------------------------------------------
/** Popup dark variant follows the toolbar's page-luminance detection so a
 *  popup over a dark page doesn't flash a bright card. */
function popupDark(): boolean {
  return selectionToolbar?.classList.contains('is-dark') ?? false
}

/** Vertical offset from an anchor (usually the selection toolbar's top) so a
 *  popup clears the toolbar's FULL height — the old +20 started the popup
 *  18px into the ~38px toolbar and covered its lower half. */
function popupTopBelowToolbar(y: number): number {
  return y + (selectionToolbar?.offsetHeight ?? 0) + 12
}

function showLoading(x: number, y: number) {
  clearPopups()

  loadingPopup = document.createElement('div')
  loadingPopup.id = 'lector-ai-loading'
  loadingPopup.className = 'lector-pop lector-pop-loading'
  if (popupDark()) loadingPopup.classList.add('lector-pop-dark')
  // Only geometry stays inline; the look lives in .lector-pop(-loading).
  loadingPopup.style.cssText = `left: ${x}px; top: ${popupTopBelowToolbar(y)}px;`

  const spinner = document.createElement('div')
  spinner.className = 'lector-pop-spinner'
  spinner.style.cssText = 'width:16px;height:16px;border:2px solid #E2D5BB;border-top-color:#8F5E30;border-radius:50%;animation:lectorSpin .8s linear infinite;flex:none;'
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
  clearPopups()

  resultPopup = document.createElement('div')
  resultPopup.id = 'lector-ai-result'
  resultPopup.className = 'lector-pop'
  if (popupDark()) resultPopup.classList.add('lector-pop-dark')

  const maxHeight = window.innerHeight - y - 100
  // Only geometry stays inline; the look lives in .lector-pop.
  resultPopup.style.cssText = `
    left: ${x}px;
    top: ${popupTopBelowToolbar(y)}px;
    max-height: ${Math.min(maxHeight, 500)}px;
    overflow-y: auto;
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
  closeBtn.className = 'result-close'
  closeBtn.textContent = tr('popup.close')
  closeBtn.onclick = () => removeResult()

  header.appendChild(title)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  content.textContent = result

  const footer = document.createElement('div')
  footer.className = 'result-footer'

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
    tryOpenSidePanelWithSeed({ kind: type, text: result })
    removeResult()
    removeToolbar()
  }

  footer.appendChild(copyBtn)
  footer.appendChild(chatBtn)

  resultPopup.appendChild(header)
  resultPopup.appendChild(content)
  resultPopup.appendChild(footer)

  document.body.appendChild(resultPopup)
  lectorUiOpenedAt = Date.now()
  makeDraggable(resultPopup, header)
}

/** Read source text aloud via the browser's built-in SpeechSynthesis (zero-dep). */
function speak(text: string, langSpeechCode: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = langSpeechCode
  window.speechSynthesis.speak(u)
}

/** Make a fixed popup movable by dragging its header (DeepL-style). Pointer
 *  events on interactive children (buttons, the language dropdown) never start
 *  a drag. Clamped to the viewport so the popup can't be dragged out of reach.
 *  Pointer capture keeps the gesture alive when the cursor outruns the handle. */
function makeDraggable(popup: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if ((e.target as HTMLElement).closest('button, input, .lector-lang-dd')) return
    const rect = popup.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const origLeft = rect.left
    const origTop = rect.top
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort; move still tracks while over the handle */
    }
    const onMove = (ev: PointerEvent) => {
      const left = Math.max(8, Math.min(window.innerWidth - 80, origLeft + ev.clientX - startX))
      const top = Math.max(8, Math.min(window.innerHeight - 48, origTop + ev.clientY - startY))
      popup.style.left = `${left}px`
      popup.style.top = `${top}px`
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  })
}

/** Map a language-dropdown pick ('auto' | language code) to a concrete target. */
function resolvePickedTarget(raw: string, sourceText: string): TargetLangCode {
  if (raw === 'auto') return resolveTargetLang('auto', sourceText)
  return raw as TargetLangCode
}

/** Persist the user's popup language choice so it sticks for next time.
 *  Orphan-safe: a synchronous "Extension context invalidated" throw must not
 *  kill the language switch itself. */
function persistPickedTarget(raw: string) {
  safeRuntimeSend({ action: 'lector-set-translation-target', target: raw })
}

// Registry of the currently-open streaming popup's aborter, so removeResult()
// can stop an in-flight stream the user dismissed (paid tokens + a history
// entry must not keep landing for a closed popup). Set on popup creation,
// cleared/aborted by removeResult.
let activeResultStream: { abort: () => void } | null = null

/** Streaming translate popup (DeepL-style). Shows immediately with a skeleton +
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
  clearPopups()


  resultPopup = document.createElement('div')
  resultPopup.id = 'lector-ai-result'
  resultPopup.className = 'lector-pop'
  if (popupDark()) resultPopup.classList.add('lector-pop-dark')
  const maxHeight = window.innerHeight - y - 100
  // Only geometry stays inline; the look lives in .lector-pop.
  resultPopup.style.cssText = `
    left: ${x}px; top: ${popupTopBelowToolbar(y)}px; max-height: ${Math.min(maxHeight, 500)}px; overflow-y: auto;
  `

  const header = document.createElement('div')
  header.className = 'result-header'
  const title = document.createElement('div')
  title.className = 'result-title'
  title.innerHTML = tr('popup.result.translate')

  // Detected source-language badge ("EN →"): makes the auto direction visible
  // and auditable next to the target picker (surpass-feature parity with the
  // side panel's "Detected: X → Y" labeling).
  const srcLang = detectSourceLang(sourceText)
  const srcBadge = document.createElement('span')
  srcBadge.className = 'lector-src-badge'
  srcBadge.textContent = `${srcLang.toUpperCase()} →`
  srcBadge.title = tr('bilingual.sourceDetected').replace(
    '{lang}',
    cachedPref === 'zh' ? getLanguage(srcLang).zh : getLanguage(srcLang).en
  )

  // Target language selector (self-drawn dropdown — see createLangDropdown).
  const langWrap = document.createElement('div')
  langWrap.style.cssText =
    'font-size:11px;color:#5C5347;display:flex;align-items:center;gap:5px;'
  const langLabel = document.createElement('span')
  langLabel.textContent = tr('popup.result.targetLang')
  const langDd = createLangDropdown({
    value: initialTarget,
    autoLabel: tr('settings.translation.targetLanguage.auto'),
    onPick: (raw) => {
      void execute(resolvePickedTarget(raw, sourceText))
      persistPickedTarget(raw)
    },
  })
  langWrap.appendChild(srcBadge)
  langWrap.appendChild(langLabel)
  langWrap.appendChild(langDd)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'result-close'
  closeBtn.textContent = tr('popup.close')
  closeBtn.onclick = () => removeResult()
  header.appendChild(title)
  header.appendChild(langWrap)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  // Fixed children [textNode, caret]: streaming deltas append to textNode in
  // place (appendData) instead of rewriting content.textContent per token.
  const textNode = document.createTextNode('')
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  content.appendChild(textNode)
  content.appendChild(caret)

  const footer = document.createElement('div')
  footer.className = 'result-footer'
  const speakSrc = document.createElement('button')
  speakSrc.className = 'copy-btn'
  speakSrc.type = 'button'
  speakSrc.textContent = '🔊 ' + tr('popup.result.speakSource')
  speakSrc.title = tr('popup.result.speak')
  speakSrc.style.flex = '0 0 auto'
  speakSrc.onclick = () => speak(sourceText, getLanguage(detectScript(sourceText) === 'cjk' ? 'zh' : 'en').speechCode)
  const speakTgt = document.createElement('button')
  speakTgt.className = 'copy-btn'
  speakTgt.type = 'button'
  speakTgt.textContent = '🔊 ' + tr('popup.result.speakTarget')
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
    tryOpenSidePanelWithSeed({ kind: 'translate', text: content.textContent || '' })
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
  lectorUiOpenedAt = Date.now()
  makeDraggable(resultPopup, header)

  let acc = ''
  let curTarget = initialTarget
  // Generation guard + per-run abort: a new execute() (language switch)
  // supersedes any in-flight run — its streamChat is aborted and stale
  // sink callbacks are ignored so two streams never interleave.
  let gen = 0
  let runController: AbortController | null = null
  let popupClosed = false
  // Expose the in-flight run to removeResult(): closing the popup aborts the
  // stream (no orphaned paid generation racing into detached DOM nodes).
  activeResultStream = {
    abort: () => {
      popupClosed = true
      runController?.abort()
    },
  }
  const sink = {
    append(delta: string) {
      acc += delta
      textNode.appendData(delta)
    },
    setText(s: string) {
      acc = s
      textNode.data = s
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
      // The popup was closed mid-stream: the run was aborted, so reaching the
      // success path here means the final frame raced the close. The user saw
      // nothing — don't detach-into caret juggling and don't log a history
      // entry for a translation that was never displayed.
      if (popupClosed) return
      if (caret.parentNode === content) content.removeChild(caret)
      // The history relay is best-effort and orphan-safe (safeRuntimeSend).
      // It lives OUTSIDE the stream's error path on purpose: a failure here
      // must not overwrite the already-streamed, fully-completed translation
      // with an error message.
      safeRuntimeSend({
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
    } catch (e) {
      // A run superseded by a newer language switch was aborted — don't
      // surface its error or touch the DOM; the newer run owns the popup.
      if (myGen !== gen) return
      if (caret.parentNode === content) content.removeChild(caret)
      const msg = e instanceof Error ? e.message : tr('err.requestFailed')
      // Write into the fixed textNode, NOT content.textContent: replacing the
      // content children would detach textNode, and a later language switch
      // would stream into the detached node with the stale error left visible.
      textNode.data = tr('err.failedPrefix').replace('{msg}', msg)
    }
  }

  void execute(initialTarget)
}

function removeResult() {
  closeAllDropdowns()
  // A dismissed popup must stop paying for its stream: abort the in-flight
  // run (Close / Escape / outside click / popup replacement all funnel here).
  activeResultStream?.abort()
  activeResultStream = null
  if (resultPopup) {
    resultPopup.remove()
    resultPopup = null
  }
}

/** When the toolbar/result popup was last opened. The outside-click listener
 *  is registered permanently, so it needs a grace window to ignore the click
 *  that is part of the OPENING interaction (mouseup → popup created → the
 *  browser still fires the trailing click on the page) — that click must not
 *  insta-close what it just opened. Replaces the old delayed
 *  setTimeout(addEventListener, 100) pattern, whose timer could fire after the
 *  popup was replaced and leave an unremovable orphan listener behind. */
let lectorUiOpenedAt = 0
const LECTOR_UI_OPEN_GRACE_MS = 200

function handleClickOutside(e: MouseEvent) {
  if (Date.now() - lectorUiOpenedAt < LECTOR_UI_OPEN_GRACE_MS) return
  const target = e.target as HTMLElement
  if (resultPopup && !resultPopup.contains(target)) removeResult()
  if (selectionToolbar && !selectionToolbar.contains(target)) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) removeToolbar()
  }
}

document.addEventListener('click', handleClickOutside)

// ---------------------------------------------------------------------------
// BYOK helpers (run in the content-script context)
// ---------------------------------------------------------------------------
// The content script can import shared modules; vite bundles them in.
import { getSettings, completeOnce, streamChat, ProviderHttpError } from './shared/byok'
import { t, type LocalePref, type StringKey } from './shared/i18n'
import { renderGlossaryPrompt, type GlossaryEntry } from './shared/glossary'
import {
  runConcurrent,
  shouldTranslateBlock,
  isLikelyProseLeafText,
  isTextAlreadyInTargetLanguage,
  splitBlockForTranslation,
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
  filterGlossaryForDirection,
  resolveTargetLang,
  detectScript,
  detectSourceLang,
  isTranslationLikelyUnchanged,
  maxTokensForChunk,
  scriptOfLang,
  ABSOLUTE_TEXT_LEN_FLOOR,
  EXCLUDED_ANCESTOR_TAGS,
  LANGUAGES,
  getLanguage,
  type DisplayMode,
  type TargetLangCode,
} from './shared/translation'
import { buildThemeStylesheet, TRANSLATION_THEMES } from './shared/translationThemes'
import { personaPrompt } from './shared/translationPersonas'
import {
  cacheKeyPrefix,
  cacheKeyWithPrefix,
  putEntry,
  getEntry,
  parseStore,
  mergeCacheStores,
  type CacheStore,
} from './shared/translationCache'
import { findRuleForHost, shouldAutoTranslatePage, inputBoxDisabledForHost } from './shared/siteRules'
import { normalizeTranslationSettings, type ByokSettings, type TranslationSettings } from './shared/providers'
import { fanOutPositions } from './shared/radialMenu'
import {
  clampFabPosition,
  clampFabMenuOrigin,
  isFabPosition,
  fabMenuArcDegrees,
  FAB_DRAG_THRESHOLD_PX,
  type FabPosition,
} from './shared/fabPosition'
import { parseCssRgb, relativeLuminance } from './shared/color'
import { NOISE_SELECTORS, scoreNodeFromStats } from './shared/readability'

// --- BYOK settings cache: getSettings() round-trips chrome.storage.local and
// sits on hot paths (every selection mouseup via loadPref, every hover, every
// run). Cache the last read; the panel's saveSettings and the background's
// model preference both land via chrome.storage.onChanged, which invalidates
// immediately. A TTL bounds staleness if the event is ever missed. ---
let cachedByokSettings: { value: ByokSettings; at: number } | null = null
const SETTINGS_CACHE_TTL_MS = 60_000

function invalidateSettingsCache(): void {
  cachedByokSettings = null
}

async function getSettingsCached(): Promise<ByokSettings> {
  if (cachedByokSettings && Date.now() - cachedByokSettings.at < SETTINGS_CACHE_TTL_MS) {
    return cachedByokSettings.value
  }
  const value = await getSettings()
  cachedByokSettings = { value, at: Date.now() }
  return value
}

try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes as Record<string, unknown>).lector_byok_settings) {
        invalidateSettingsCache()
      }
    })
  }
} catch {
  /* an orphaned content script cannot register listeners — the TTL still bounds staleness */
}

// --- i18n: content script reads the locale pref from storage once per action ---
let cachedPref: LocalePref = 'auto'

async function loadPref(): Promise<LocalePref> {
  try {
    const settings = await getSettingsCached()
    cachedPref = settings.locale ?? 'auto'
  } catch {
    cachedPref = 'auto'
  }
  return cachedPref
}
const tr = (key: StringKey) => t(key, cachedPref)

/**
 * Load BYOK settings, refresh cachedPref, and if the user has no API key show
 * the "add key" result popup at (x,y) + open the side panel, returning null.
 * Centralizes the no-key UX previously duplicated in summarizePage,
 * handleExplainSentence, and runByokAction. On success returns settings so the
 * caller avoids a second getSettings() call.
 */
async function requireApiKey(
  x: number,
  y: number,
  kind: 'translate' | 'summary' | 'explain'
): Promise<ByokSettings | null> {
  let settings: ByokSettings
  try {
    settings = await getSettingsCached()
  } catch (e) {
    // getSettings() can throw synchronously when the extension context is
    // invalidated (orphaned content script). Surface the error instead of
    // leaving a stuck loading spinner + unhandled rejection at the caller.
    clearPopups()
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    showResult(x, y, tr('err.failedPrefix').replace('{msg}', msg), kind)
    return null
  }
  cachedPref = settings.locale ?? 'auto'
  if (!settings.apiKey) {
    clearPopups()
    showResult(x, y, tr('err.addKey'), kind)
    tryOpenSidePanel()
    return null
  }
  return settings
}

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

/**
 * Build the translation prompt bundle (glossary + persona + systemPrompt) for a
 * given target language. Centralizes the 4-line setup that was duplicated in
 * runBilingualTranslation, translateBlockOnHover, and translateInputField.
 * Each of those called loadGlossary() independently (a chrome.storage round
 * trip) and hand-built the same glossaryBlock/persona/systemPrompt tuple.
 */
async function buildTranslationPromptBundle(
  tSettings: TranslationSettings,
  target: string
): Promise<{ systemPrompt: string; glossaryBlock: string; persona: string }> {
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const persona = personaPrompt(tSettings.persona)
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock, persona)
  return { systemPrompt, glossaryBlock, persona }
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
  const rect = selectionToolbar?.getBoundingClientRect()
  const settings = await requireApiKey(rect?.left || 100, rect?.top || 100, 'explain')
  if (!settings) {
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
    tryOpenSidePanelWithSeed({ kind: 'ask', text })
    removeLoading()
    removeToolbar()
    return
  }

  void runByokAction(kind, text)
}

async function runByokAction(kind: 'translate' | 'summarize' | 'explain', text: string) {
  const rect = selectionToolbar?.getBoundingClientRect()
  // The no-key popup is titled by action — a keyless Summarize must not be
  // greeted with a "Translation" heading.
  const settings = await requireApiKey(
    rect?.left || 100,
    rect?.top || 100,
    kind === 'summarize' ? 'summary' : kind
  )
  if (!settings) return

  if (kind === 'translate') {
    const tSettings = normalizeTranslationSettings(settings.translation)
    const initialTarget = resolveTargetLang(tSettings.targetLanguage, text)
    const glossary = await loadGlossary()
    const persona = personaPrompt(tSettings.persona)
    // Re-read the anchor after the awaits: the page (or the toolbar teardown)
    // may have moved since requireApiKey; show the popup where the user is now.
    const rect2 = selectionToolbar?.getBoundingClientRect()
    // Show the streaming popup immediately with a target-language selector.
    showStreamingTranslateResult(rect2?.left || rect?.left || 100, rect2?.top || rect?.top || 100, text, initialTarget, async (selTarget, sink, signal) => {
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
    systemPrompt = SUMMARIZE_SYSTEM_PROMPT
  } else {
    systemPrompt = `You are Lector AI. Explain the user content clearly in a few sentences, then give one concrete example. Clean Markdown.`
  }
  try {
    const out = await completeOnce(settings, systemPrompt, text.slice(0, 8000), {
      maxTokens,
      temperature: 0.5,
    })
    removeLoading()
    // Re-anchor after the await (the toolbar may be gone by now — fall back to
    // the position captured when the action started).
    const rectEnd = selectionToolbar?.getBoundingClientRect() || rect
    showResult(
      rectEnd?.left || 100,
      rectEnd?.top || 100,
      out || tr('err.emptyResponse'),
      kind === 'summarize' ? 'summary' : 'explain'
    )
  } catch (e) {
    removeLoading()
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    const rectErr = selectionToolbar?.getBoundingClientRect() || rect
    showResult(rectErr?.left || 100, rectErr?.top || 100, tr('err.failedPrefix').replace('{msg}', msg), 'explain')
  }
}

// ---------------------------------------------------------------------------
// Inline bilingual translation (Immersive-Translate style) — BYOK direct.
// Concurrency + streaming + viewport-first ordering + progress + cancel.
// ---------------------------------------------------------------------------
let bilingualAbort: AbortController | null = null
// Debounced cache persisters. One per translation context (whole-page run,
// incremental observer): they previously shared a single module-level timer
// slot, so whichever scheduled last silently orphaned the other's handle — the
// orphaned timer still fired and wrote its (older) snapshot. Hoisted refs let
// a re-entrant run cancel the prior run's pending write, so a stale snapshot
// can't land in storage after the new run started.
interface CachePersister {
  persist: (next: CacheStore) => void
  cancel: () => void
}
let runCachePersister: CachePersister | null = null
let incrementalCachePersister: CachePersister | null = null

function createCachePersister(delayMs = 800): CachePersister {
  let timer: ReturnType<typeof setTimeout> | null = null
  let snapshot: CacheStore = {}
  return {
    persist(next: CacheStore) {
      snapshot = next
      // Debounce so a burst of chunk completions writes once.
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        void saveCache(snapshot)
      }, delayMs)
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

const EXCLUDED_SELECTOR = Array.from(EXCLUDED_ANCESTOR_TAGS).map((t) => t.toLowerCase()).join(',')
// `summary` matches TRANSLATABLE_TAGS; it was missing here so FAQ/collapsible
// headings were never even queried (regression: FAQ pages left questions in
// English while their answers were translated).
const BASE_TRANSLATABLE_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary'
// Unconditional noise: interactive/menu regions where translation is never
// wanted regardless of text length.
const TRANSLATION_NOISE_SELECTOR =
  [
    'nav', 'menu', 'form',
    '[role="navigation"]', '[role="menu"]', '[role="menubar"]', '[role="menuitem"]',
    '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
    '[role="listbox"]', '[role="option"]', '[role="tablist"]', '[role="tab"]',
    '[role="toolbar"]', '[role="textbox"]', '[role="combobox"]',
    'details-menu', '.select-menu-modal', 'dialog:not([open])',
    '[hidden]', '[aria-hidden="true"]', '[inert]',
    '.sr-only', '.visually-hidden', '[translate="no"]', '.notranslate',
    '[contenteditable]:not([contenteditable="false"])',
  ].join(',')
// "Page chrome" containers that OFTEN hold nav junk but also real prose:
// marketing heroes live inside <header>, license text inside <footer>, and
// related-article blurbs inside <aside>. They are excluded CONDITIONALLY —
// see isChromeWorthyBlock — instead of wholesale, which used to leave the
// most visible English on a page (the hero) untranslated.
const TRANSLATION_CHROME_SELECTOR =
  'header, footer, aside, [role="banner"], [role="contentinfo"]'
// Real content inside page chrome: semantic headings, or a text run long
// enough to be a sentence. Short nav/CTA links ("Home", "Start free trial")
// stay verbatim.
const CHROME_WORTHY_MIN_TEXT = 40
function isChromeWorthyBlock(el: HTMLElement): boolean {
  if (/^H[1-6]$/.test(el.tagName)) return true
  return (el.textContent || '').trim().length >= CHROME_WORTHY_MIN_TEXT
}
const TRANSLATION_SELF_SELECTOR =
  [
    '#lector-ai-result', '#lector-ai-toolbar', '#lector-ai-loading', '#lector-ai-fab',
    '.lector-fab-menu', '.lector-tstatus',
    '[data-lector-no-translate]',
    // A successfully translated host is done; a FAILED host (.lector-translation-error)
    // must stay eligible so a later run (or Retry) can retranslate it.
    '.lector-bilingual-host:not(.lector-translation-error)', '.lector-bi-source',
    '.lector-bilingual', '.lector-bi-actions',
  ].join(',')

function buildBlockCandidate(el: HTMLElement) {
  const text = (el.textContent || '').trim()
  // textRatio is only consulted for SHORT blocks — shouldTranslateBlock accepts
  // anything at/above ABSOLUTE_TEXT_LEN_FLOOR before touching the ratio — so
  // skip serializing the entire subtree's HTML (outerHTML) for every long
  // paragraph; it was the single most expensive per-candidate call.
  const needsRatio = text.length < ABSOLUTE_TEXT_LEN_FLOOR
  return {
    text,
    tag: el.tagName,
    isInsideExcluded: !!el.closest(EXCLUDED_SELECTOR),
    // An error chunk is NOT a translation — its host must stay retryable.
    isAlreadyTranslated: !!el.querySelector('.lector-bilingual:not(.is-error)'),
    textRatio: needsRatio ? text.length / ((el.outerHTML || '').length || text.length || 1) : 1,
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

function directTextOf(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Content after a closed <details> summary is present in the DOM but not
 * rendered. GitHub's three language/date filters contain more than a thousand
 * such labels, which previously became hundreds of pointless API requests. */
function isInsideClosedDetailsContent(el: Element): boolean {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (!parent.matches('details:not([open])')) continue
    // querySelector returns the first match directly (no array alloc); the
    // :scope > summary selector is valid so the try/catch wrapper isn't needed.
    const summary = parent.querySelector(':scope > summary')
    if (!summary?.contains(el)) return true
  }
  return false
}

function createVisibilityChecker(scopeRoot: Element): (el: HTMLElement) => boolean {
  const doc = scopeRoot.ownerDocument
  const win = doc.defaultView
  const viewportRect = doc.documentElement.getBoundingClientRect()
  // jsdom intentionally has no layout and returns zero rects for every node;
  // only use client rects when a real rendering engine is present.
  const hasLayout = viewportRect.width > 0 || viewportRect.height > 0
  const hiddenByStyle = new WeakMap<Element, boolean>()

  const styleHides = (el: Element): boolean => {
    const cached = hiddenByStyle.get(el)
    if (cached !== undefined) return cached
    if (!win || !(el instanceof win.HTMLElement)) {
      hiddenByStyle.set(el, false)
      return false
    }
    const style = win.getComputedStyle(el)
    const hidden = style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    hiddenByStyle.set(el, hidden)
    return hidden
  }

  return (el: HTMLElement) => {
    if (isInsideClosedDetailsContent(el)) return false
    for (let current: Element | null = el; current; current = current.parentElement) {
      if (styleHides(current)) return false
      if (current === scopeRoot) break
    }
    if (!hasLayout || el.getClientRects().length > 0) return true
    // `display: contents` has no element box even though its text/children are
    // rendered. A Range observes those rendered contents without accepting
    // genuinely hidden elements.
    try {
      const range = doc.createRange()
      range.selectNodeContents(el)
      return range.getClientRects().length > 0
    } catch {
      return false
    }
  }
}

function isStructurallyExcluded(el: HTMLElement): boolean {
  if (
    closestSafe(el, EXCLUDED_SELECTOR) ||
    closestSafe(el, TRANSLATION_NOISE_SELECTOR) ||
    closestSafe(el, TRANSLATION_SELF_SELECTOR)
  ) return true
  const chrome = closestSafe(el, TRANSLATION_CHROME_SELECTOR)
  return !!chrome && !isChromeWorthyBlock(el)
}

/** DOM semantics that text alone cannot classify. Keep programming-language
 * badges, icon-backed counters and contributor/avatar metadata verbatim. */
function isNonProseMetadata(el: HTMLElement, text: string): boolean {
  if (closestSafe(el, '[itemprop="programmingLanguage"]')) return true
  const compact = directTextOf(el) || text.replace(/\s+/g, ' ').trim()
  if (compact.length < 24 && el.querySelector('a img[alt^="@"]')) return true
  if (
    el.querySelector('svg, [role="img"]') &&
    /^[\d\s.,+%-]*(?:stars?|forks?|views?|likes?|comments?|downloads?|watchers?|issues?|votes?|points?)(?:\s+\p{L}+){0,3}$/iu.test(compact)
  ) return true
  if (el.querySelector('input, button, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"]')) {
    return true
  }
  // GitHub repository identity headings are navigation identifiers, including
  // mixed-case slugs that cannot be classified from text alone.
  if (
    /^H[1-6]$/u.test(el.tagName) &&
    el.closest('article.Box-row') &&
    el.querySelector('a[href^="/"]') &&
    compact.includes('/')
  ) return true
  return false
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
  const isVisible = createVisibilityChecker(scopeRoot)
  // Per-collection memoization: the leaf pass and the eligibility pass used to
  // redo the same closest()-chain walks (4 ancestor traversals per element),
  // computed-style walks and textContent subtree traversals for the same
  // elements. The function is synchronous — the DOM cannot change mid-way —
  // so results are safely reusable within one collection.
  const excludedMemo = new Map<HTMLElement, boolean>()
  const isExcludedOnce = (el: HTMLElement): boolean => {
    let v = excludedMemo.get(el)
    if (v === undefined) {
      v = isStructurallyExcluded(el)
      excludedMemo.set(el, v)
    }
    return v
  }
  const visibleMemo = new Map<HTMLElement, boolean>()
  const isVisibleOnce = (el: HTMLElement): boolean => {
    let v = visibleMemo.get(el)
    if (v === undefined) {
      v = isVisible(el)
      visibleMemo.set(el, v)
    }
    return v
  }
  const textMemo = new Map<HTMLElement, string>()
  const fullTextOnce = (el: HTMLElement): string => {
    let v = textMemo.get(el)
    if (v === undefined) {
      v = (el.textContent || '').trim()
      textMemo.set(el, v)
    }
    return v
  }
  const validExtra = extraSelectors.map((s) => s.trim()).filter(Boolean)
  const extraRoots = new Set<HTMLElement>()
  for (const selector of validExtra) {
    for (const el of queryAllSafe(scopeRoot, selector)) {
      if (!isExcludedOnce(el) && isVisibleOnce(el)) extraRoots.add(el)
    }
    if (
      closestSafe(scopeRoot, selector) === scopeRoot &&
      !isExcludedOnce(scopeRoot as HTMLElement) &&
      isVisibleOnce(scopeRoot as HTMLElement)
    ) extraRoots.add(scopeRoot as HTMLElement)
  }

  const standardRoots = new Set<HTMLElement>()
  if (
    closestSafe(scopeRoot, BASE_TRANSLATABLE_SELECTOR) === scopeRoot &&
    !isExcludedOnce(scopeRoot as HTMLElement) &&
    isVisibleOnce(scopeRoot as HTMLElement)
  ) {
    standardRoots.add(scopeRoot as HTMLElement)
  }
  for (const el of queryAllSafe(scopeRoot, BASE_TRANSLATABLE_SELECTOR)) {
    if (!isExcludedOnce(el) && isVisibleOnce(el)) standardRoots.add(el)
  }
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

  // `a` is included so link-card layouts (`<div><a>long prose…</a></div>`)
  // get their prose translated; links inside p/li are still skipped by
  // hasStandardAncestor below, and button-wrapped links by EXCLUDED_SELECTOR.
  const textLeaves = queryAllSafe(scopeRoot, 'div, span, strong, em, b, i, small, a').filter((el) => {
    if (isExcludedOnce(el)) return false
    if (!standardRoots.has(el) && hasStandardAncestor(el)) return false
    if (hasStandardDescendant.has(el)) return false
    const directText = directTextOf(el)
    if (isNonProseMetadata(el, directText)) return false
    if (!isLikelyProseLeafText(directText)) return false
    // Defer synchronous style/layout reads until cheap semantic filters pass.
    return isVisibleOnce(el)
  })

  const unique = [...new Set<HTMLElement>([...standardRoots, ...textLeaves])]
  const textLeafSet = new Set(textLeaves)
  const eligible = unique.filter((el) => {
    if (isExcludedOnce(el) || !isVisibleOnce(el)) return false
    const text = fullTextOnce(el)
    if (isNonProseMetadata(el, text)) return false
    const allowAnyTag = textLeafSet.has(el) || extraRoots.has(el)
    if (!shouldTranslateBlock(buildBlockCandidate(el), allowAnyTag)) return false
    return !excludeSelectors.some((selector) => Boolean(closestSafe(el, selector)))
  })

  const eligibleSet = new Set(eligible)
  const rejectedForOverlap = new Set<HTMLElement>()
  const hasMeaningfulDirectText = new Set(
    eligible.filter((el) => isLikelyProseLeafText(directTextOf(el)))
  )
  for (const el of eligible) {
    let parent = el.parentElement
    while (parent) {
      if (eligibleSet.has(parent)) {
        if (hasMeaningfulDirectText.has(parent)) {
          // The ancestor owns prose outside this descendant. Translate the
          // ancestor once so its direct text is not silently lost.
          rejectedForOverlap.add(el)
        } else {
          rejectedForOverlap.add(parent)
        }
      }
      if (parent === scopeRoot) break
      parent = parent.parentElement
    }
  }

  const nonOverlapping = eligible.filter((el) => !rejectedForOverlap.has(el))
  // Read layout once per candidate. The old sort comparator forced O(n log n)
  // layout reads and became expensive on large application pages.
  const vh = window.innerHeight
  const positions = new Map<HTMLElement, { bucket: number; top: number }>()
  for (const el of nonOverlapping) {
    const rect = el.getBoundingClientRect()
    positions.set(el, {
      bucket: rect.top < vh && rect.bottom > 0 ? 0 : 1,
      top: rect.top,
    })
  }
  return nonOverlapping.sort((a, b) => {
    const pa = positions.get(a)!
    const pb = positions.get(b)!
    return pa.bucket - pb.bucket || pa.top - pb.top
  })
}

/** Live display-mode mirror so the FAB menu / status toast can label and cycle
 *  the mode without a settings round-trip. Kept in sync by applyDisplayMode. */
let currentDisplayMode: DisplayMode = 'bilingual'

function displayModeLabel(mode: DisplayMode): string {
  return tr(('settings.translation.displayMode.' + mode) as StringKey)
}

/** Cycle bilingual → translationOnly → hover, apply immediately (CSS body
 *  class), persist via the background relay, and confirm with a transient
 *  toast. Page-level counterpart of the Settings segmented control. */
const DISPLAY_MODE_ORDER: DisplayMode[] = ['bilingual', 'translationOnly', 'hover']
async function cycleDisplayMode(): Promise<void> {
  const next = DISPLAY_MODE_ORDER[
    (DISPLAY_MODE_ORDER.indexOf(currentDisplayMode) + 1) % DISPLAY_MODE_ORDER.length
  ]
  applyDisplayMode(next)
  safeRuntimeSend({ action: 'lector-set-translation-display-mode', mode: next })
  showTranslationNotice(tr('fab.menu.displayMode').replace('{mode}', displayModeLabel(next)))
}

function applyDisplayMode(mode: DisplayMode) {
  currentDisplayMode = mode
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

/** Build the per-chunk hover action cluster (retry + speak + copy). Shared by
 *  the streaming path and the cache-hit fast-path so a cached translation gets
 *  the same per-chunk controls. `onRetry` re-runs just this chunk. `lang` (the
 *  run's target language) enables the read-aloud button. On an error chunk
 *  speak/copy are hidden (there is no valid translation) while Retry stays —
 *  the whole point of the error state is retryability. */
function makeChunkActions(
  span: HTMLElement,
  onRetry: () => void,
  opts: { hideCopy?: boolean; lang?: TargetLangCode } = {}
): HTMLElement {
  const actions = document.createElement('span')
  actions.className = 'lector-bi-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'lector-bi-retry'
  retry.textContent = tr('bilingual.retry')
  retry.onclick = (ev) => { ev.stopPropagation(); onRetry() }
  actions.appendChild(retry)
  if (opts.lang) {
    const speakBtn = document.createElement('button')
    speakBtn.type = 'button'
    speakBtn.className = 'lector-bi-speak'
    speakBtn.textContent = tr('popup.result.speak')
    if (opts.hideCopy) speakBtn.style.display = 'none'
    speakBtn.onclick = (ev) => {
      ev.stopPropagation()
      speak(readChunkTranslation(span), getLanguage(opts.lang!).speechCode)
    }
    actions.appendChild(speakBtn)
  }
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'lector-bi-copy'
  copy.textContent = tr('bilingual.copyTranslation')
  if (opts.hideCopy) copy.style.display = 'none'
  copy.onclick = (ev) => {
    ev.stopPropagation()
    navigator.clipboard.writeText(readChunkTranslation(span)).catch(() => {})
  }
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
    keyPrefix: cache.keyPrefix,
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

/** Persist the cache to chrome.storage.local (best-effort, fire-and-forget).
 *
 * Merge-aware: `snapshot` was captured at run start, so blindly overwriting
 * `lectorCache` would drop entries another tab (or a manual retry) wrote in
 * the meantime. mergeCacheStores keeps the newest entry per key and trims to
 * the LRU cap. */
async function saveCache(store: CacheStore): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    const r = await chrome.storage.local.get('lectorCache')
    const raw = (r as Record<string, unknown>).lectorCache
    const latest = raw ? (typeof raw === 'string' ? parseStoreFromString(raw) : parseStore(raw)) : {}
    await chrome.storage.local.set({ lectorCache: mergeCacheStores(latest, store) })
  } catch {
    /* storage unavailable — caching is best-effort */
  }
}

/** Cache context threaded through the chunk workers. `keyPrefix` is the
 *  hash of everything that affects output except the chunk text (glossary +
 *  persona blocks can be several KB — hashing them once per run instead of
 *  twice per chunk keeps the per-chunk key O(source)); the caller owns the
 *  store + persist so a run shares one store and writes once. */
interface CacheCtx {
  enabled: boolean
  ttlDays: number
  store: CacheStore
  /** Hashed run-level key prefix; source is folded in per chunk. */
  keyPrefix: string
  persist: (next: CacheStore) => void
}

class TranslationQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslationQualityError'
  }
}

/** chrome.i18n.detectLanguage wrapper. Returns the top reliable language code
 *  (base form, e.g. "zh-CN" → "zh") or null when the API is missing/failed.
 *  Used where the sync script-based checks are blind: Latin-script language
 *  pairs (Spanish vs English share a script, so character coverage and even
 *  text similarity cannot tell a real translation from a paraphrase). */
async function detectLanguageBase(text: string): Promise<string | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.i18n?.detectLanguage) return null
    const result = await chrome.i18n.detectLanguage(text)
    const top = result?.languages?.[0]
    if (!top?.language || result.isReliable === false) return null
    return top.language.split('-')[0].toLowerCase()
  } catch {
    return null
  }
}

/** Async-augmented output quality gate for a finished stream. Extends the pure
 *  isTranslationLikelyUnchanged with the browser language detector for
 *  same-script pairs (its own comment defers exactly this case). A late cancel
 *  during the detection await surfaces as AbortError so the caller skips all
 *  DOM/cache writes. */
async function outputLooksUntranslated(
  source: string,
  output: string,
  targetLang: TargetLangCode,
  signal?: AbortSignal
): Promise<boolean> {
  if (isTranslationLikelyUnchanged(source, output, targetLang)) return true
  if (scriptOfLang(targetLang) !== detectScript(source)) return false
  const detected = await detectLanguageBase(output)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (detected === null) return false
  return detected !== targetLang.split('-')[0].toLowerCase()
}

/** Input-side twin of outputLooksUntranslated: should this block be skipped
 *  because it is already written in the (same-script) target language? */
async function textLooksLikeTargetLanguage(text: string, targetLang: TargetLangCode): Promise<boolean> {
  const detected = await detectLanguageBase(text)
  if (detected === null) return false
  return detected === targetLang.split('-')[0].toLowerCase()
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
 *  Output-language guard (English→English regression): if the model echoes or
 *  paraphrases in the source language, we retry ONCE with a forceful target
 *  instruction. `attempt` tracks the depth so we never loop; a second invalid
 *  result becomes an explicit quality error and is never cached. */
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
  if (attempt === 0 && cache?.enabled) {
    const key = cacheKeyWithPrefix(cache.keyPrefix, chunkText)
    const { value, store: touched } = getEntry(cache.store, key, cache.ttlDays)
    if (value !== null) {
      // Old versions could cache an English echo as a successful Chinese
      // translation. Validate every hit and evict it immediately when it no
      // longer satisfies the current target-language quality policy.
      if (isTranslationLikelyUnchanged(chunkText, value, targetLang)) {
        const cleaned = { ...touched }
        delete cleaned[key]
        cache.store = cleaned
        cache.persist(cleaned)
      } else {
        block.classList.remove('lector-translation-error')
        cache.store = touched
        cache.persist(touched)
        const span = document.createElement('span')
        span.className = 'lector-bilingual'
        span.textContent = value
        const actions = makeChunkActions(span, () => {
          span.remove()
          void translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 0, undefined, cache ? cacheDisabled(cache) : undefined).catch(() => {})
        }, { lang: targetLang })
        span.appendChild(actions)
        block.appendChild(span)
        return value
      }
    }
  }

  // Insert placeholder container immediately so the user sees progress.
  // Always use a span styled as a block: a div is invalid inside p/h*/span/a
  // hosts and used to break GitHub card/control layout. Children are fixed
  // for the whole stream — [textNode, caret] — so a delta only ever appends
  // to textNode (appendData) instead of rebuilding the span's contents.
  const span = document.createElement('span')
  span.className = 'lector-bilingual is-loading'
  const textNode = document.createTextNode('')
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  span.appendChild(textNode)
  span.appendChild(caret)
  let loadingStyleCleared = false
  // Manual retry re-runs ONLY this chunk (used by both the normal actions row
  // and the error-state row rebuilt below).
  const onManualRetry = () => {
    span.remove()
    // A page-level cancel aborts `signal`; reusing that dead signal would make
    // the visible Retry control permanently inert.
    void translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 0, undefined, cache ? cacheDisabled(cache) : undefined).catch(() => {})
  }
  // Per-chunk hover actions: retry re-runs ONLY this chunk.
  const actions = makeChunkActions(span, onManualRetry, { lang: targetLang })
  block.appendChild(span)

  // On the forced retry, prepend an imperative instruction so the model stops
  // echoing the source. The base system prompt already requires the target
  // language, but some models need the per-turn nudge on stubborn blocks.
  const effectiveSystem = attempt > 0
    ? systemPrompt + `\n\nIMPORTANT: The previous response failed the target-language check. Translate every natural-language phrase into ${getLanguage(targetLang).en} now. The result must visibly use ${getLanguage(targetLang).en} writing. Keep only proper names, code, URLs, email addresses, numbers, and technical identifiers verbatim. Do not paraphrase in the source language.`
    : systemPrompt

  let acc = ''
  try {
    await streamChat(
      settings,
      [
        { role: 'system', content: effectiveSystem },
        // Structured user turn: repeats the target language (some compatible
        // endpoints weaken the system role) and wraps the page text as a JSON
        // string literal so page content can never smuggle instructions.
        { role: 'user', content: buildTranslateUserPrompt(chunkText, targetLang, attempt > 0) },
      ],
      { maxTokens: maxTokensForChunk(chunkText.length), temperature: attempt > 0 ? 0 : 0.2 },
      (delta) => {
        acc += delta
        // Append-only streaming: `span.textContent = acc` per delta rebuilt the
        // whole text node (and destroyed caret/actions) on EVERY token —
        // O(tokens × text) DOM churn × the number of concurrent chunks.
        // appendData mutates the one text node in place; the caret stays alive
        // next to it, and the loading style flips exactly once.
        if (!loadingStyleCleared) {
          span.classList.remove('is-loading')
          loadingStyleCleared = true
        }
        textNode.appendData(delta)
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
    block.classList.add('lector-translation-error')
    span.textContent = tr('bilingual.blockError')
    span.appendChild(makeChunkActions(span, onManualRetry, { hideCopy: true, lang: targetLang }))
    throw e
  }

  // Output-language guard: an echo, source-language paraphrase, substantially
  // untranslated result, or empty response gets one stricter retry. Cache
  // lookup is disabled by `attempt`, while a successful retry may safely write
  // the newly validated output.
  if (await outputLooksUntranslated(chunkText, acc, targetLang, signal)) {
    if (attempt === 0) {
      span.remove()
      return translateOneChunk(settings, systemPrompt, block, chunkText, targetLang, 1, signal, cache)
    }
    // A second source-language/empty result is not a translation. Do not show
    // or cache it as if it succeeded; keep the original above and surface a
    // retryable, localized quality error instead.
    const message = tr('bilingual.qualityError')
    span.classList.remove('is-loading')
    span.classList.add('is-error')
    block.classList.add('lector-translation-error')
    span.textContent = message
    span.appendChild(makeChunkActions(span, onManualRetry, { hideCopy: true, lang: targetLang }))
    throw new TranslationQualityError(message)
  }

  // A late cancel (e.g. while the same-script language detector above was
  // pending) must not write the final DOM state or cache the result.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const rendered = acc
  block.classList.remove('lector-translation-error')
  // textNode already holds the full streamed text; just retire the caret.
  caret.remove()
  span.appendChild(actions)

  // Cache the successful translation (only the genuine model output, not the
  // source-fallback, so we don't cache "nothing to translate").
  if (cache?.enabled && acc) {
    const key = cacheKeyWithPrefix(cache.keyPrefix, chunkText)
    cache.store = putEntry(cache.store, key, acc, chunkText.length)
    cache.persist(cache.store)
  }
  return rendered
}

function sourceNodesFor(block: HTMLElement): Element[] {
  return Array.from(block.querySelectorAll(':scope > .lector-bi-source-node'))
}

/** Mark original direct children without moving element nodes. Bare text nodes
 * need a tiny span wrapper so translation-only mode can hide them, while
 * existing LI/TD/div children retain their parent and direct-child CSS. */
function ensureSourceNodes(block: HTMLElement): Element[] {
  const existing = sourceNodesFor(block)
  if (existing.length > 0) return existing

  // Tolerate a wrapper left on a live page by an older content-script version.
  const legacy = block.querySelector(':scope > .lector-bi-source')
  if (legacy) {
    legacy.classList.add('lector-bi-source-node')
    return [legacy]
  }

  for (const node of Array.from(block.childNodes)) {
    if (node instanceof Element && node.classList.contains('lector-bilingual')) continue
    if (node.nodeType === Node.TEXT_NODE) {
      const wrapper = document.createElement('span')
      wrapper.className = 'lector-bi-source lector-bi-source-node'
      wrapper.dataset.lectorSourceText = 'true'
      node.replaceWith(wrapper)
      wrapper.appendChild(node)
    } else if (node instanceof Element) {
      node.classList.add('lector-bi-source', 'lector-bi-source-node')
    }
  }
  return sourceNodesFor(block)
}

function readBlockSourceText(block: HTMLElement): string {
  return sourceNodesFor(block).map((node) => node.textContent || '').join('').trim()
}

/** Fully undo this run's DOM marks on a block: remove injected translation
 *  chunks, unwrap source-node markers (restoring bare text nodes), drop host
 *  classes. Used by page-cancel cleanup and stale-error revalidation — the
 *  block must read exactly as it did before Lector touched it. */
function restoreBlockSource(block: HTMLElement): void {
  block.querySelectorAll(':scope > .lector-bilingual').forEach((n) => n.remove())
  for (const node of Array.from(block.querySelectorAll(':scope > .lector-bi-source-node'))) {
    node.classList.remove('lector-bi-source', 'lector-bi-source-node')
    if ((node as HTMLElement).dataset?.lectorSourceText === 'true') {
      node.replaceWith(...Array.from(node.childNodes))
    }
  }
  block.classList.remove('lector-bilingual-host', 'lector-translation-error')
}

/** Translate a DOM block, splitting long text into chunks first so nothing is
 *  silently dropped. Marks original direct children in place, then appends one
 *  `.lector-bilingual` per chunk in order. `signal` aborts every chunk's
 *  request. `touched` (when provided) records blocks this run made into hosts
 *  so a cancel can restore them wholesale. Returns the concatenation of chunk
 *  translations. */
async function translateBlockChunks(
  settings: ByokSettings,
  systemPrompt: string,
  block: HTMLElement,
  targetLang: TargetLangCode,
  signal?: AbortSignal,
  cache?: CacheCtx,
  touched?: Set<HTMLElement>
): Promise<string> {
  // Mark the host so display-mode CSS (translationOnly / hover) can target it.
  // Source element children stay exactly where they are; only bare text nodes
  // receive a span wrapper for CSS visibility control.
  block.classList.add('lector-bilingual-host')
  block.classList.remove('lector-translation-error')
  touched?.add(block)
  ensureSourceNodes(block)
  // Read only marked source nodes: block.textContent also includes translations
  // from a previous retry and would pollute the next request.
  const original = readBlockSourceText(block)
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

/**
 * Send the terminal bilingual-progress (done:0/total:0/complete:true) +
 * bilingual-error pair. Centralizes the 4 identical sites (no-key,
 * no-candidates ×2, toggleBilingual catch) that each hand-wrote both
 * sendMessage calls. Fire-and-forget side-channels to the side panel.
 */
/** Shared candidate language filter. Same-script pairs (e.g. Spanish page →
 *  English target) cannot be judged by script coverage, so they also consult
 *  the browser language detector; cross-script pairs use the sync check only.
 *  Used by both the whole-page run and the incremental (MutationObserver)
 *  pass so the two paths never drift apart.
 *
 *  `sampleText` lets a caller that already joined the candidate texts (the
 *  whole-page run builds a truncated sample for direction detection) reuse it
 *  instead of re-traversing/re-joining every candidate here. Same-script
 *  detector calls run through a small worker pool: awaiting them serially put
 *  300 candidates ≈ 300 back-to-back IPC round-trips between the user's first
 *  toggle and the first translated block. */
async function filterCandidatesByTargetLanguage(
  candidates: HTMLElement[],
  target: TargetLangCode,
  signal?: AbortSignal,
  sampleText?: string
): Promise<HTMLElement[]> {
  const sample = sampleText ??
    candidates
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 20000)
  if (scriptOfLang(target) === detectScript(sample)) {
    const infos = candidates.map((el) => {
      const text = (el.textContent || '').trim()
      return { el, text, skip: !text || isTextAlreadyInTargetLanguage(text, target) }
    })
    const verdicts = await runConcurrent(
      infos,
      async (c) => c.skip || await textLooksLikeTargetLanguage(c.text, target),
      { concurrency: 8, signal }
    )
    const kept: HTMLElement[] = []
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]
      if (info.skip) continue
      const v = verdicts[i]
      if (v.ok && !v.value) kept.push(info.el)
    }
    return kept
  }
  return candidates.filter((el) => {
    const text = (el.textContent || '').trim()
    return text.length > 0 && !isTextAlreadyInTargetLanguage(text, target)
  })
}

/**
 * Collect translatable blocks from subtrees that appeared AFTER a finished
 * translation run (infinite scroll, lazy-loaded comments, SPA route changes).
 * Pure collection + language filter — no observer, no provider calls — so it
 * is unit-testable. Already-translated hosts self-exclude via
 * TRANSLATION_SELF_SELECTOR inside collectTranslationCandidates.
 */
export async function collectIncrementalCandidates(
  roots: Element[],
  target: TargetLangCode,
  signal?: AbortSignal
): Promise<HTMLElement[]> {
  const seen = new Set<HTMLElement>()
  const all: HTMLElement[] = []
  for (const root of roots) {
    if (!(root instanceof Element)) continue
    // Never react to Lector's own injected UI.
    if (root.closest(TRANSLATION_SELF_SELECTOR) || isLectorUiTarget(root as HTMLElement)) continue
    for (const el of collectTranslationCandidates(root)) {
      if (seen.has(el)) continue
      seen.add(el)
      all.push(el)
    }
    if (signal?.aborted) return []
  }
  return filterCandidatesByTargetLanguage(all, target, signal)
}

/** Terminal report to the side panel (run failed / stopped). Orphan-safe: an
 *  orphaned content script (extension reloaded mid-run) used to let the
 *  synchronous "Extension context invalidated" throw escape here — through
 *  toggleBilingual's catch, as an uncaught promise rejection.
 *  Exported for tests. */
export function reportBilingualTerminal(message: string): void {
  safeRuntimeSend({
    action: 'lector-bilingual-progress',
    done: 0,
    total: 0,
    complete: true,
  })
  safeRuntimeSend({
    action: 'lector-bilingual-error',
    message,
  })
  // Page-level twin so a closed side panel still sees WHY the run stopped.
  showTranslationError(message)
}

/** Monotonic run id: only the CURRENT run may remove the body run-active
 *  class. A re-entering run bumps the serial so the aborted run's finally
 *  doesn't clear the marker of the run that replaced it. */
let bilingualRunSerial = 0

// ---------------------------------------------------------------------------
// On-page translation status toast — the page-level twin of the sidepanel's
// progress readout (Immersive/Google-style). The sidepanel is often CLOSED
// when the user triggers translation from the FAB or Alt+A; without this the
// run is a black box: no progress, no cancel, no failure attribution. States:
//   progress  — "Translating 12/48" + progress bar + Cancel + dismiss
//   done      — "Translated N blocks" + Show original + mode cycle (auto-hide)
//   error     — "Translation stopped: <reason>" (auto-hide, slower)
//   notice    — small transient confirmation (mode switch / restored)
// A same-kind progress update mutates the live nodes in place so the 250ms
// report cadence never restarts the entrance animation.
// ---------------------------------------------------------------------------
let tstatusEl: HTMLElement | null = null
let tstatusKind: 'progress' | 'done' | 'error' | 'notice' | null = null
let tstatusTimer: ReturnType<typeof setTimeout> | null = null

function tstatusDark(): boolean {
  try {
    return isDarkPage(document.body)
  } catch {
    return false
  }
}

function killTstatusTimer(): void {
  if (tstatusTimer !== null) {
    clearTimeout(tstatusTimer)
    tstatusTimer = null
  }
}

function hideTranslationStatus(): void {
  killTstatusTimer()
  tstatusEl?.remove()
  tstatusEl = null
  tstatusKind = null
}

/** Shared toast scaffold: root + text row; callers append their own controls. */
function buildTstatus(kind: 'progress' | 'done' | 'error' | 'notice'): { root: HTMLElement; text: HTMLElement } {
  hideTranslationStatus()
  const root = document.createElement('div')
  root.className = 'lector-tstatus' + (tstatusDark() ? ' lector-tstatus-dark' : '')
  const text = document.createElement('span')
  text.className = 'ts-text'
  if (kind === 'error') text.classList.add('is-error')
  root.appendChild(text)
  tstatusEl = root
  tstatusKind = kind
  return { root, text }
}

function finishTstatus(root: HTMLElement, autoHideMs: number | null): void {
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ts-close'
  close.setAttribute('aria-label', tr('popup.close'))
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  close.onclick = hideTranslationStatus
  root.appendChild(close)
  document.body.appendChild(root)
  if (autoHideMs !== null) tstatusTimer = setTimeout(hideTranslationStatus, autoHideMs)
}

/** Progress state. Passing total=0 renders the indeterminate "Translating…"
 *  form used while the run is still probing/collecting candidates. */
function showTranslationProgress(done: number, total: number): void {
  if (tstatusKind === 'progress' && tstatusEl?.isConnected) {
    // In-place update: keep the entrance animation out of the 250ms cadence.
    const text = tstatusEl.querySelector<HTMLElement>('.ts-text')
    if (text) text.textContent = total > 0
      ? tr('bilingual.status.translating')
          .replace('{done}', String(done))
          .replace('{total}', String(total))
      : tr('bilingual.status.probing')
    const fill = tstatusEl.querySelector<HTMLElement>('.ts-bar-fill')
    if (fill) fill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'
    return
  }
  const { root, text } = buildTstatus('progress')
  text.textContent = total > 0
    ? tr('bilingual.status.translating')
        .replace('{done}', String(done))
        .replace('{total}', String(total))
    : tr('bilingual.status.probing')
  const bar = document.createElement('span')
  bar.className = 'ts-bar'
  const fill = document.createElement('span')
  fill.className = 'ts-bar-fill'
  fill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'
  bar.appendChild(fill)
  root.appendChild(bar)
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'ts-btn'
  cancel.textContent = tr('bilingual.cancel')
  cancel.onclick = () => cancelBilingual()
  root.appendChild(cancel)
  finishTstatus(root, null)
}

/** Done state: result count + quick actions (show original / cycle mode).
 *  Auto-hides — the FAB menu keeps both actions available afterwards. */
function showTranslationDone(count: number): void {
  const { root, text } = buildTstatus('done')
  text.textContent = '✓ ' + tr('bilingual.status.done').replace('{n}', String(count))
  const showOriginal = document.createElement('button')
  showOriginal.type = 'button'
  showOriginal.className = 'ts-btn'
  showOriginal.textContent = tr('bilingual.status.showOriginal')
  showOriginal.onclick = () => restorePageTranslations()
  const mode = document.createElement('button')
  mode.type = 'button'
  mode.className = 'ts-btn'
  mode.textContent = displayModeLabel(currentDisplayMode)
  mode.title = tr('settings.translation.displayMode')
  mode.onclick = () => { void cycleDisplayMode(); mode.textContent = displayModeLabel(currentDisplayMode) }
  root.appendChild(showOriginal)
  root.appendChild(mode)
  finishTstatus(root, 6000)
}

/** Error state: keeps the provider's own message (auth/quota/probe failure)
 *  so the user can attribute the stop, like Immersive's failed indicator. */
function showTranslationError(message: string): void {
  const { root, text } = buildTstatus('error')
  text.textContent = '⚠ ' + tr('bilingual.status.error').replace('{msg}', message)
  finishTstatus(root, 9000)
}

/** Small transient confirmation pill (mode switched / original restored). */
function showTranslationNotice(message: string): void {
  const { root, text } = buildTstatus('notice')
  text.textContent = message
  finishTstatus(root, 2500)
}

// ---------------------------------------------------------------------------
// Restore-original (toggle semantics). Immersive-style: the SAME gesture that
// starts translation also takes it away — Alt+A / FAB primary item become a
// true toggle. Restores every host this page holds (whole-page runs, manual
// retries and Shift+hover injections all share .lector-bilingual markup).
// ---------------------------------------------------------------------------
export function pageHasTranslations(): boolean {
  return !!document.querySelector('.lector-bilingual:not(.is-error)')
}

export function restorePageTranslations(): void {
  stopIncrementalTranslation()
  if (bilingualAbort) {
    bilingualAbort.abort()
    bilingualAbort = null
    fab?.classList.remove('is-translating')
  }
  // Thorough GLOBAL cleanup, not a per-host :scope > walk: pages legitimately
  // re-parent our spans after injection (the user's own highlight <mark>, site
  // scripts, framework re-renders), and a re-parented translation would
  // otherwise survive the restore — leaving stray text AND keeping
  // pageHasTranslations() true, which would turn every later toggle into a
  // no-op restore instead of a fresh run.
  document.querySelectorAll('.lector-bilingual').forEach((el) => el.remove())
  document.querySelectorAll('.lector-bi-source-node').forEach((node) => {
    node.classList.remove('lector-bi-source', 'lector-bi-source-node')
    if ((node as HTMLElement).dataset?.lectorSourceText === 'true') {
      node.replaceWith(...Array.from(node.childNodes))
    }
  })
  document.querySelectorAll('.lector-bilingual-host').forEach((el) => {
    el.classList.remove('lector-bilingual-host', 'lector-translation-error')
  })
  // Drop every presentation class this feature put on <body>; a new run
  // re-applies them from settings. Without this, translationOnly would keep
  // hiding source nodes whose host classes were just stripped.
  document.body.classList.remove('lector-bilingual-run-active')
  document.body.classList.remove('lector-dm-bilingual', 'lector-dm-translationOnly', 'lector-dm-hover')
  document.body.classList.remove('lector-focus-on')
  document.body.classList.remove(...TRANSLATION_THEMES.map((t) => `lector-theme-${t.id}`))
  hideTranslationStatus()
  // Release the side panel's busy/progress state (it keys off complete:true).
  safeRuntimeSend({ action: 'lector-bilingual-progress', done: 0, total: 0, complete: true })
  showTranslationNotice(tr('bilingual.restored'))
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
  // The previous run's incremental observer must not keep translating with a
  // superseded direction/prompt while this run re-resolves them; a successful
  // run installs a fresh observer at its end.
  stopIncrementalTranslation()
  // Cancel the prior run's pending debounced cache write so a stale snapshot
  // can't land after this new run starts (the prior run's persister captured
  // its own `snapshot`; letting it fire would overwrite newer writes).
  runCachePersister?.cancel()
  runCachePersister = null
  // Own the cancellation controller SYNCHRONOUSLY, before the first await: a
  // cancel that arrives while settings are still loading must already reach
  // this run, or it would proceed to send provider requests after the UI
  // reported it canceled.
  const controller = new AbortController()
  bilingualAbort = controller
  const serial = ++bilingualRunSerial
  document.body.classList.add('lector-bilingual-run-active')
  // Page-level status twin: FAB spinner + progress toast (indeterminate until
  // the candidate count resolves). Both are cleared in the finally below.
  fab?.classList.add('is-translating')
  showTranslationProgress(0, 0)
  // Blocks this run turned into hosts — restored wholesale if the run aborts.
  const touched = new Set<HTMLElement>()

  try {
    const settings = await getSettingsCached()
    if (controller.signal.aborted) return
    cachedPref = settings.locale ?? 'auto'
    if (!settings.apiKey) {
      tryOpenSidePanel()
      reportBilingualTerminal(tr('err.addKey'))
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
    // 'whole' (default) → translate every eligible prose block in the document.
    // 'smart' → use the detected main-content root. If no root exists we already
    // use body; if a real root exists but contains no prose, do not fall back to
    // translating the site's UI chrome.
    const smartRoot = effectiveScope === 'smart' ? extractPageRoot() : null
    const scopeRoot: Element = (effectiveScope === 'whole' || !smartRoot) ? document.body : smartRoot

    // Stale-error revalidation: a host that failed in an earlier run may since
    // have become untranslatable (moved under no-translate UI, or recognized
    // as repository/metadata markup). Dead error markers are removed WITHOUT
    // provider calls so they can't linger on the page forever.
    scopeRoot.querySelectorAll('.lector-bilingual-host.lector-translation-error').forEach((el) => {
      const failedHost = el as HTMLElement
      const text = (failedHost.textContent || '').trim()
      if (isStructurallyExcluded(failedHost) || isNonProseMetadata(failedHost, text)) {
        restoreBlockSource(failedHost)
      }
    })

    const excludeExtra = siteRule?.excludeSelectors?.length
      ? siteRule.excludeSelectors.map((s) => s.trim()).filter(Boolean)
      : []
    let candidates = collectTranslationCandidates(
      scopeRoot,
      siteRule?.selectors || [],
      excludeExtra
    )
    if (candidates.length === 0) {
      reportBilingualTerminal(tr('bilingual.noContent'))
      return
    }

    // Resolve auto direction from the same visible, filtered candidates that
    // will actually be translated. Hidden menus and navigation text must not
    // decide the direction of the real page prose.
    const candidateText = candidates
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 20000)
    // Detect the source language from the same candidate text (was previously
    // read off extractPage().lang, which re-traversed h1-h6/p/li/etc. just to
    // get a lang tag — candidateText is already built and is the visible prose).
    const pageLang = detectSourceLang(candidateText)
    const target = resolveTargetLang(tSettings.targetLanguage, candidateText || 'Hello world')
    // Same-script pairs (e.g. Spanish page → English target) additionally
    // consult the browser language detector inside the shared helper. The
    // already-joined candidateText doubles as its script sample (no re-join).
    candidates = await filterCandidatesByTargetLanguage(candidates, target, controller.signal, candidateText)
    if (controller.signal.aborted) return
    if (candidates.length === 0) {
      reportBilingualTerminal(tr('bilingual.noContent'))
      return
    }
    const { systemPrompt, glossaryBlock, persona } = await buildTranslationPromptBundle(tSettings, target)
    if (controller.signal.aborted) return

    // Translation cache (Phase 5): load once per run, persist after. A hit skips
    // the provider call entirely; a miss streams + writes back. ttlDays 0 = off.
    const cacheOn = tSettings.cacheTtlDays > 0
    let cache: CacheStore = cacheOn ? await loadCache() : {}
    if (controller.signal.aborted) return
    // Hash the (possibly multi-KB) glossary/persona key inputs once per run;
    // per-chunk keys then only hash the chunk's own source text.
    const runKeyPrefix = cacheOn
      ? cacheKeyPrefix(target, settings.model, glossaryBlock, persona)
      : ''
    const cachePersister = createCachePersister()
    runCachePersister = cachePersister
    const persistCache = cachePersister.persist

    const total = candidates.length
    let done = 0
    // Throttle progress reports: on a 200-block page this fired ~200 messages in
    // bursts, each waking the MV3 service worker. Send at most every 250ms during
    // the run, plus always on the final complete:true.
    let lastReportAt = 0
    const report = (complete = false) => {
      const now = Date.now()
      if (!complete && now - lastReportAt < 250) return
      lastReportAt = now
      safeRuntimeSend({ action: 'lector-bilingual-progress', done, total, complete })
      // Page-level twin, same cadence as the sidepanel message.
      showTranslationProgress(done, total)
    }
    report()

    // Deterministic provider rejections (bad key / no permission) are the same
    // for every remaining block: retrying just duplicates paid requests, and
    // letting the run continue fails all N blocks one request at a time. Stop
    // the whole page with the provider's own message instead. Reported once —
    // concurrent workers can hit the same 401 within milliseconds.
    let fatalProviderErrorReported = false
    const stopForFatalProviderError = (message: string): void => {
      if (!fatalProviderErrorReported) {
        fatalProviderErrorReported = true
        reportBilingualTerminal(message)
      }
      controller.abort()
    }

    const runBlock = async (block: HTMLElement): Promise<void> => {
      // Build the cache context fresh per worker so it reads the latest shared
      // `cache` store (workers run concurrently and each may add entries). The
      // store field is a getter so a worker always sees sibling writes.
      const cacheCtx: CacheCtx | undefined = cacheOn
        ? {
            enabled: true,
            ttlDays: tSettings.cacheTtlDays,
            get store() { return cache },
            set store(v) { cache = v },
            keyPrefix: runKeyPrefix,
            persist: persistCache,
          }
        : undefined
      try {
        await translateBlockChunks(settings, systemPrompt, block, target, controller.signal, cacheCtx, touched)
      } catch (e) {
        // Don't retry (or count) once the user has cancelled.
        if (controller.signal.aborted) throw e
        // Semantic retry already happened inside translateOneChunk. Retrying
        // the whole block would make two more identical paid requests.
        if (e instanceof TranslationQualityError) throw e
        // Auth/permission failures are deterministic for every block — stop
        // the page instead of doubling the paid requests on a guaranteed miss.
        if (e instanceof ProviderHttpError && (e.status === 401 || e.status === 403)) {
          stopForFatalProviderError(e.message)
          return
        }
        // Retry once with a short backoff (still abortable).
        await new Promise((r) => setTimeout(r, 500))
        if (controller.signal.aborted) throw e
        try {
          await translateBlockChunks(settings, systemPrompt, block, target, controller.signal, cacheCtx, touched)
        } catch (e2) {
          // A rate limit that survived its one retry (or auth failing on the
          // retry) is fatal for the rest of the page too.
          if (
            e2 instanceof ProviderHttpError &&
            (e2.status === 401 || e2.status === 403 || e2.status === 429)
          ) {
            stopForFatalProviderError(e2.message)
            return
          }
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
    }

    // Probe-first: translate ONE candidate before touching the rest. A provider
    // that echoes the source language (the English→English regression) fails
    // here after its single semantic retry, and we stop the whole page with one
    // message instead of N identical paid failures. A successful probe already
    // leaves that block translated — no duplicate formal request for it.
    try {
      await runBlock(candidates[0])
    } catch (e) {
      if (e instanceof TranslationQualityError) {
        safeRuntimeSend({ action: 'lector-bilingual-error', message: tr('bilingual.probeFailed') })
        showTranslationError(tr('bilingual.probeFailed'))
        report(true)
        return
      }
      throw e
    }

    const results = await runConcurrent(
      candidates.slice(1),
      runBlock,
      { concurrency: tSettings.concurrency, signal: controller.signal }
    )
    if (controller.signal.aborted) return

    // Relay one history entry for the page (sample = first successfully translated block).
    const firstRestOkIdx = results.findIndex((r) => r.ok)
    const firstOkIdx = firstRestOkIdx >= 0 ? firstRestOkIdx + 1 : 0
    const sample = candidates[firstOkIdx]
    if (sample) {
      const source = readBlockSourceText(sample)
      const tgt = Array.from(sample.querySelectorAll(':scope > .lector-bilingual'))
        .map(readChunkTranslation)
        .join('')
        .slice(0, 200)
      if (source && tgt) {
        safeRuntimeSend({
          action: 'lector-translation-history',
          entry: {
            source: source.slice(0, 200),
            target: tgt,
            sourceLang: pageLang || 'auto',
            targetLang: target,
            kind: 'page',
            url: location.href,
            createdAt: Date.now(),
          },
        })
      }
    }

    // First non-abort error surfaces to side panel (preserve existing UX). A
    // canceled run reports nothing extra — cancelBilingual already sent the
    // canceled notice, and a late provider error must not overwrite it.
    const firstErr = results.find(
      (r) => !r.ok && !(r.error instanceof DOMException && (r.error as DOMException).name === 'AbortError')
    )
    if (firstErr && !firstErr.ok && !controller.signal.aborted) {
      const msg = firstErr.error instanceof Error ? firstErr.error.message : tr('err.requestFailed')
      safeRuntimeSend({ action: 'lector-bilingual-error', message: msg })
    }
    // The run completed (possibly with some per-block errors): watch for
    // dynamically added content so infinite scroll / lazy loads / SPA route
    // changes are translated with the SAME direction, prompt and cache as
    // this run. Aborted runs never get here (finally restores the DOM).
    installIncrementalTranslation({
      settings,
      systemPrompt,
      glossaryBlock,
      persona,
      target,
      concurrency: tSettings.concurrency,
      cacheTtlDays: tSettings.cacheTtlDays,
    })
    report(true)
    // Success terminal: swap the progress toast for the result row (count +
    // show-original + mode cycle, auto-hide). Errors below take the error form.
    showTranslationDone(done)
  } catch (e) {
    // Aborts were user-initiated (cancel / replacement run) — cancelBilingual
    // already reported. Anything else propagates to toggleBilingual's terminal
    // reporting. DOM restoration for aborts happens in finally below.
    if (!controller.signal.aborted) throw e
  } finally {
    // A canceled/replaced run restores every block it had marked, so partial
    // output never lingers and the page reads exactly as before. Completed
    // (non-aborted) runs keep their translations and error markers.
    if (controller.signal.aborted) {
      for (const block of touched) restoreBlockSource(block)
    }
    if (bilingualRunSerial === serial) {
      document.body.classList.remove('lector-bilingual-run-active')
      // Only the current run may retire the FAB spinner; a replacement run
      // already re-added it for itself.
      if (bilingualAbort === controller) fab?.classList.remove('is-translating')
    }
    // Release the controller only if it is still ours. If a newer run already
    // reassigned bilingualAbort (re-entrancy), leave it alone — nulling it
    // would orphan that newer run and make IT uncancellable.
    if (bilingualAbort === controller) bilingualAbort = null
  }
}

// ---------------------------------------------------------------------------
// Incremental translation of dynamically added content (infinite scroll,
// lazy-loaded comments, SPA route changes). The whole-page run collects
// candidates ONCE; anything the page renders afterwards used to stay in the
// source language forever — the classic "some English is still untranslated"
// report on feed/lazy pages. A finished run installs a MutationObserver that
// debounces added subtrees into the same chunk pipeline. Stopped by cancel,
// a re-run, or a translation-settings change (stale prompt/target must not
// keep serving).
// ---------------------------------------------------------------------------
interface IncrementalCtx {
  settings: ByokSettings
  systemPrompt: string
  glossaryBlock: string
  persona: string
  target: TargetLangCode
  concurrency: number
  controller: AbortController
  observer: MutationObserver
  pendingRoots: Set<Element>
  timer: ReturnType<typeof setTimeout> | null
  cache: CacheCtx | null
  /** A flush is in flight: new mutations must not start an overlapping
   *  runConcurrent — each carries its own `concurrency` paid-request budget,
   *  and overlapping flushes multiply the in-flight request count beyond the
   *  configured cap while racing to mutate the same DOM. */
  flushing: boolean
  /** A mutation arrived while a flush was in flight; the finally block
   *  reschedules one follow-up flush for the roots left in pendingRoots. */
  flushQueued: boolean
}
let incrementalCtx: IncrementalCtx | null = null
const INCREMENTAL_DEBOUNCE_MS = 500
/** Per-batch cap: a malicious/destroyed DOM must not be able to queue an
 *  unbounded number of paid requests between user-visible cancellations. */
const INCREMENTAL_BATCH_MAX = 60

function stopIncrementalTranslation(): void {
  const ctx = incrementalCtx
  incrementalCtx = null
  if (!ctx) return
  ctx.controller.abort()
  ctx.observer.disconnect()
  if (ctx.timer) clearTimeout(ctx.timer)
  ctx.timer = null
  // Drop this context's pending debounced cache write with it (its snapshot
  // belongs to a superseded prompt/target).
  incrementalCachePersister?.cancel()
  incrementalCachePersister = null
}

async function flushIncremental(ctx: IncrementalCtx): Promise<void> {
  // A newer context (re-run / cancel + new run) superseded this one.
  if (ctx !== incrementalCtx) return
  // A flush is already running: remember to run once more afterwards instead
  // of overlapping a second worker pool onto the first.
  if (ctx.flushing) {
    ctx.flushQueued = true
    return
  }
  ctx.flushing = true
  try {
    const roots = Array.from(ctx.pendingRoots)
    ctx.pendingRoots.clear()
    ctx.timer = null
    if (roots.length === 0) return
    let batch: HTMLElement[]
    try {
      batch = await collectIncrementalCandidates(roots, ctx.target, ctx.controller.signal)
    } catch {
      return
    }
    if (ctx !== incrementalCtx || ctx.controller.signal.aborted) return
    if (batch.length === 0) return
    batch = batch.slice(0, INCREMENTAL_BATCH_MAX)
    // Per-worker view sharing ctx.cache's store via getter/setter so concurrent
    // workers read each other's writes (same pattern as the whole-page run).
    const cacheView: CacheCtx | undefined = ctx.cache
      ? {
          enabled: true,
          ttlDays: ctx.cache.ttlDays,
          get store() { return ctx.cache!.store },
          set store(v) { ctx.cache!.store = v },
          keyPrefix: ctx.cache.keyPrefix,
          persist: ctx.cache.persist,
        }
      : undefined
    await runConcurrent(
      batch,
      (block) => translateBlockChunks(
        ctx.settings, ctx.systemPrompt, block, ctx.target, ctx.controller.signal, cacheView
      ),
      { concurrency: ctx.concurrency, signal: ctx.controller.signal }
    )
  } finally {
    ctx.flushing = false
    // Roots queued while we were busy get exactly one follow-up flush (the
    // observer only schedules on NEW mutations, so without this the queued
    // roots would sit untranslated until the next page change).
    if (ctx.flushQueued && ctx === incrementalCtx && !ctx.controller.signal.aborted) {
      ctx.flushQueued = false
      if (ctx.timer) clearTimeout(ctx.timer)
      ctx.timer = setTimeout(() => { void flushIncremental(ctx) }, INCREMENTAL_DEBOUNCE_MS)
    }
  }
}

function installIncrementalTranslation(init: {
  settings: ByokSettings
  systemPrompt: string
  glossaryBlock: string
  persona: string
  target: TargetLangCode
  concurrency: number
  cacheTtlDays: number
}): void {
  stopIncrementalTranslation()
  const controller = new AbortController()
  const ctx: IncrementalCtx = {
    ...init,
    controller,
    observer: null as unknown as MutationObserver,
    pendingRoots: new Set(),
    timer: null,
    cache: null,
    flushing: false,
    flushQueued: false,
  }
  if (init.cacheTtlDays > 0) {
    // Same debounced-persist pattern as the whole-page run, but on its own
    // timer slot (they used to share one handle and orphan each other's
    // timers — the orphan still fired and wrote its older snapshot).
    const persister = createCachePersister()
    incrementalCachePersister = persister
    ctx.cache = {
      enabled: true,
      ttlDays: init.cacheTtlDays,
      store: {},
      keyPrefix: cacheKeyPrefix(init.target, init.settings.model, init.glossaryBlock, init.persona),
      persist: persister.persist,
    }
  }
  const observer = new MutationObserver((records) => {
    if (ctx !== incrementalCtx) return
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as Element
        // Skip our own injected nodes (bilingual spans, source wrappers) right
        // here: a whole-page run injects hundreds of them, and queueing each
        // meant one extra full candidate-collection pass over roots that all
        // self-excluded — right when the page is hottest after a run.
        if (el.closest(TRANSLATION_SELF_SELECTOR) || isLectorUiTarget(el as HTMLElement)) continue
        ctx.pendingRoots.add(el)
      }
    }
    if (ctx.pendingRoots.size === 0) return
    if (ctx.timer) clearTimeout(ctx.timer)
    ctx.timer = setTimeout(() => { void flushIncremental(ctx) }, INCREMENTAL_DEBOUNCE_MS)
  })
  ctx.observer = observer
  incrementalCtx = ctx
  observer.observe(document.body, { childList: true, subtree: true })
  // The incremental cache shares the run's storage; preload it now so the
  // first flush can hit entries the run just wrote.
  if (ctx.cache) {
    void loadCache().then((store) => {
      if (ctx === incrementalCtx && ctx.cache) ctx.cache.store = store
    })
  }
}

function cancelBilingual() {
  // Cancel also halts the incremental observer: the user asked translation to
  // STOP on this page, and later lazy-loaded content must not restart it.
  stopIncrementalTranslation()
  if (bilingualAbort) {
    bilingualAbort.abort()
    bilingualAbort = null
  }
  // The aborted run's finally sees bilingualAbort already reassigned/cleared,
  // so the FAB spinner + toast must be retired here, not only there.
  fab?.classList.remove('is-translating')
  hideTranslationStatus()
  // `canceled: true` lets the panel distinguish an intentional stop from a
  // provider failure; the run suppresses any late ordinary error after it.
  safeRuntimeSend({ action: 'lector-bilingual-error', message: tr('bilingual.canceled'), canceled: true })
}

/** When set, overrides the configured pageScope for the next bilingual run.
 *  Used by the Alt+W "whole page" shortcut (and Alt+A "smart" shortcut) so the
 *  same toggleBilingual path can target either scope without a settings write.
 *  Cleared after each run. */
let bilingualScopeOverride: 'smart' | 'whole' | null = null

/** Backwards-compat entry point; the side panel / command send lector-toggle-bilingual.
 *  Toggle semantics (Immersive-style Alt+A): translations already on the page
 *  and no run in flight → restore the original instead of re-running. */
async function toggleBilingual() {
  if (!bilingualAbort && pageHasTranslations()) {
    restorePageTranslations()
    return
  }
  try {
    await runBilingualTranslation()
  } catch (e) {
    const message = e instanceof Error ? e.message : tr('err.requestFailed')
    reportBilingualTerminal(message)
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
  // A whole-page run (or its post-run incremental observer) owns block
  // translation: the run's translateBlockChunks strips foreign .lector-bilingual
  // spans, so a hover translation started mid-run gets ripped out in flight and
  // can even double-charge the provider. Let the run/incremental pass do it.
  if (bilingualAbort || incrementalCtx) return
  const settings = await getSettingsCached()
  if (!settings.apiKey) return
  const tSettings = normalizeTranslationSettings(settings.translation)
  const text = (block.textContent || '').trim()
  if (text.length < 3) return
  const target = resolveTargetLang(tSettings.targetLanguage, text)
  const { systemPrompt } = await buildTranslationPromptBundle(tSettings, target)
  hoverAbort?.abort()
  const controller = new AbortController()
  hoverAbort = controller
  try {
    await translateBlockChunks(settings, systemPrompt, block, target, controller.signal)
  } catch (e) {
    // Abort (re-hover / hold-key release) is intentional — leave whatever
    // streamed. A genuine provider error (auth/quota/network) is logged so it
    // isn't silently indistinguishable from an abort; the user can re-hover.
    const aborted = controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')
    if (!aborted) console.warn('[Lector] hover-translate failed:', e instanceof Error ? e.message : e)
  } finally {
    if (hoverAbort === controller) hoverAbort = null
  }
}

let hoverMouseMoveAt = 0
// passive: the handler never calls preventDefault, and declaring it lets the
// browser dispatch mousemove off the main input path where supported.
document.addEventListener('mousemove', (e) => {
  if (!hoverCfg.enabled) return
  // Only trigger when the configured hold key is currently pressed.
  const held =
    (hoverCfg.holdKey === 'Shift' && e.shiftKey) ||
    (hoverCfg.holdKey === 'Control' && e.ctrlKey) ||
    (hoverCfg.holdKey === 'Alt' && e.altKey)
  if (!held) return
  // Throttle the closest('p, li, ...') ancestor walk — it fires on every
  // mousemove (60-1000Hz) and is the hot-path cost while holding Shift over
  // the page. 40ms (~25Hz) is well below the debounceMs translation gate and
  // imperceptible for hover intent.
  const now = Date.now()
  if (now - hoverMouseMoveAt < 40) return
  hoverMouseMoveAt = now
  const target = e.target as HTMLElement
  if (!target || !target.closest) return
  // Find the nearest translatable block ancestor.
  const block = target.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary') as HTMLElement | null
  if (!block || block === lastHoverBlock) return
  // Skip our own UI + already-excluded regions.
  if (isLectorUiTarget(block)) return
  lastHoverBlock = block
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    void translateBlockOnHover(block)
  }, hoverCfg.debounceMs)
}, { passive: true })

document.addEventListener('keyup', (e) => {
  // Cancel a pending hover-translation if the user releases the hold key early.
  // Only the hold key itself: releasing an unrelated key while the hold key is
  // still down (e.g. typing) must not abort an in-flight translation.
  if (e.key !== hoverCfg.holdKey) return
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
    // Rich editors (Gmail/Notion/LinkedIn compose boxes) keep their own model
    // of the DOM; a wholesale `el.textContent = value` flattens formatting,
    // signatures and quoted replies into one text node and can desync the
    // editor. Route the replacement through the editor's input pipeline
    // instead: select all + execCommand('insertText'). execCommand is
    // deprecated but remains the reliable cross-editor way to perform a
    // user-visible edit that frameworks observe; fall back to textContent
    // only when an editor blocks it.
    el.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    sel?.removeAllRanges()
    sel?.addRange(range)
    if (!document.execCommand('insertText', false, value)) {
      el.textContent = value
    }
    sel?.collapseToEnd()
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
}

/** Per-field generation counter: a second trigger on the same field supersedes
 *  the first, so two rapid translations can never write back out of order. */
const inputFieldGen = new WeakMap<EditableField, number>()

async function translateInputField(el: EditableField, targetOverride?: string) {
  const myGen = (inputFieldGen.get(el) || 0) + 1
  inputFieldGen.set(el, myGen)
  const settings = await getSettingsCached()
  if (!settings.apiKey) return
  const tSettings = normalizeTranslationSettings(settings.translation)
  const raw = readEditableField(el)
  if (!raw.trim()) return
  const target = (targetOverride && targetOverride !== 'auto'
    ? targetOverride
    : resolveTargetLang(tSettings.targetLanguage, raw))
  const { systemPrompt } = await buildTranslationPromptBundle(tSettings, target)
  try {
    const out = await completeOnce(
      settings,
      systemPrompt,
      raw.slice(0, 4000),
      { maxTokens: Math.min(2000, Math.max(200, raw.length * 2)), temperature: 0.2 }
    )
    if (!out) return
    // Staleness guards BEFORE the write: the user may have kept typing during
    // the multi-second provider call (unconditionally replacing the field
    // would silently destroy their input), and a newer trigger on the same
    // field must be the only writer.
    if (inputFieldGen.get(el) !== myGen) return
    if (readEditableField(el) !== raw) return
    if (inputCfg.mode === 'append') {
      writeEditableField(el, raw + '\n' + out)
    } else {
      writeEditableField(el, out)
    }
  } catch (e) {
    // Provider error (auth/quota/network) — leave the field unchanged, but
    // surface it so a real failure isn't silently indistinguishable from a
    // no-op (the field stays as-is either way; this only adds observability).
    console.warn('[Lector] input-field translate failed:', e instanceof Error ? e.message : e)
  }
}

/** Keydown listener for editable fields: detects the triple-space trigger,
 *  slash commands (`/xx `), and partial `//word`. Attached to the document so
 *  dynamically-added fields are covered; we filter to INPUT/TEXTAREA + contenteditable. */
document.addEventListener('keydown', (e) => {
  if (!inputCfg.enabled || inputBoxDisabledForHost(location.hostname)) return
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
  // Only the primary button ends a text selection. Right/middle mouseup (e.g.
  // releasing over an existing selection to open the context menu) must not
  // pop the toolbar under the native menu.
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (isLectorUiTarget(target)) {
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
    removeLoading()
    hideTranslationStatus()
  }
})

document.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement
  if (!isLectorUiTarget(target)) {
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
    // without re-translating. The incremental observer is stopped too: its
    // captured prompt/target/persona are now stale, and the user can re-run
    // translation to pick up the new settings.
    stopIncrementalTranslation()
    void (async () => {
      const s = await getSettingsCached()
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
    const settings = await getSettingsCached()
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
