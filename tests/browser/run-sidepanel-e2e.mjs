// Real browser E2E for the Lector AI SIDE PANEL React app (BYOK).
//
// Loads the REAL production bundles (sidepanel.js + css) by serving dist/ over
// http and injecting an HTML shell that: (1) creates #root, (2) installs a
// chrome.* stub wired to BYOK settings (apiKey present), (3) stubs window.fetch
// to return an OpenAI-shaped SSE stream so streamChat/readSSE parse real tokens
// (no network, no key). React mounts the real App; we then drive it: chat send
// → SSE stream render → citation chip; 🌐 button click → tabs.sendMessage
// captured; header buttons render.
//
// Run: node tests/browser/run-sidepanel-e2e.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const SIDE_PANEL_INDEX_HTML = readFileSync(
  resolve(import.meta.dirname, '..', '..', 'src', 'sidepanel', 'index.html'),
  'utf8',
)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Production ships the panel CSS INLINED in dist/sidepanel/index.html (the
// build deletes /assets/*.css — a stalled stylesheet fetch must not be able
// to blank the panel; see scripts/build-extension.mjs). Mirror production:
// lift the inlined <style> blocks into the shell. Legacy layouts that still
// emitted /assets/sidepanel-*.css fall back to a link.
const PANEL_HTML = readFileSync(resolve(DIST, 'sidepanel', 'index.html'), 'utf8')
const INLINE_STYLE = [...PANEL_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((m) => m[1])
  .join('\n')
let CSS_HREF = ''
try {
  const cssFile = readdirSync(resolve(DIST, 'assets')).find((f) => /^sidepanel-.*\.css$/.test(f))
  CSS_HREF = cssFile ? `/assets/${cssFile}` : ''
} catch { CSS_HREF = '' }
const SHELL_CSS = INLINE_STYLE
  ? `<style>${INLINE_STYLE}</style>`
  : `<link rel="stylesheet" href="${CSS_HREF}">`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// Serve dist/ as static files + an in-memory shell HTML that wires up the stub.
function startServer() {
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
  return http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    // Serve the production source HTML unchanged. Its module request is held at
    // a dependency-free stub below so the browser can inspect the synchronous
    // boot shell before the application bundle or React has mounted.
    if (u === '/boot-shell.html') {
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SIDE_PANEL_INDEX_HTML)
    }
    if (u === '/src/sidepanel/main.tsx') {
      return res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(
        'window.__sidepanelEntryRequested = true; await new Promise(() => {});',
      )
    }
    // Shell page: stubs chrome.* + fetch, then loads the real sidepanel bundle.
    if (u === '/' || u === '/shell.html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SP</title>
${SHELL_CSS}</head>
<body><div id="root"></div>
<script>
window.__tabsSent = [];
window.__lectorMsgs = [];
window.__runtimeListeners = [];

// BYOK settings WITH an apiKey so chat (streamChat) and bilingual run.
const BYOK = {
  provider: 'openai',
  apiKey: 'sk-test-sidepanel',
  model: 'gpt-4o-mini',
  baseUrl: '',
  locale: 'en',
  // Deliberately differs from the English UI locale. Context-menu translation
  // must follow this setting rather than hard-code "中文" from the interface.
  translation: { targetLanguage: 'fr' }
};

// Native OpenAI Responses SSE stream so streamChat parses real tokens.
function sse(tokens) {
  const e = new TextEncoder();
  return new ReadableStream({ start(c) {
    for (const t of tokens) c.enqueue(e.encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: t }) + '\\n\\n'));
    c.enqueue(e.encode('data: ' + JSON.stringify({
      type: 'response.completed',
      response: { status: 'completed', output: [] }
    }) + '\\n\\n'));
    c.close();
  }});
}
window.__fetchCalls = [];
window.__fetchBodies = [];
window.fetch = function (url, opts) {
  window.__fetchCalls.push(String(url));
  try { window.__fetchBodies.push(JSON.parse(opts && opts.body || '{}')); } catch {}
  // Official OpenAI streamChat posts to {baseUrl}/responses.
  return Promise.resolve({ ok: true, status: 200, body: sse(['Trust matters [0].']) });
};

window.chrome = {
  runtime: {
    lastError: null,
    id: 'testextid',
    onMessage: {
      addListener(fn) { window.__runtimeListeners.push(fn); },
      removeListener(fn) {
        window.__runtimeListeners = window.__runtimeListeners.filter((listener) => listener !== fn);
      },
    },
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {
          lector_byok_settings: BYOK,
          lectorSeed: {
            kind: 'translate',
            text: 'A skill to stop your coding agent from burying the answer.'
          }
        };
        // The on-mount sync reads settings + drains the highlight/vocab relay
        // queues; return empty arrays so nothing interferes.
        out.lectorHighlights = [{
          id: 'queued-highlight',
          text: 'Captured while the panel was closed.',
          note: '',
          quote: 'Captured while the panel was closed.',
          url: 'http://localhost/article.html',
          title: 'Queued item',
          createdAt: 1,
          color: 'yellow'
        }];
        out.lectorVocab = [];
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set: (obj, cb) => { if (cb) cb(); return Promise.resolve() },
      remove: (_keys, cb) => { if (cb) cb(); return Promise.resolve() },
    },
    // chrome.storage.onChanged is a sibling of .local, not nested under it.
    onChanged: { addListener(){}, removeListener(){} },
  },
  tabs: {
    query: (_q, cb) => {
      const tabs = [{ id: 1, url: 'http://localhost/article.html', windowId: 1 }];
      if (cb) cb(tabs);
      return Promise.resolve(tabs);
    },
    sendMessage: (tabId, msg, cb) => {
      window.__lectorMsgs.push({ tabId, ...msg });
      // Simulate the content script replying with an extracted page so the
      // panel picks up page context (title/blocks) for citation grounding.
      if (msg && msg.action === 'lector-get-page') {
        cb && cb({ page: { title: 'Trust in Software', url: 'http://localhost/article.html', text: 'Trust matters. Consistency builds confidence.', lang: 'en', blocks: [{ id: 'b0', text: 'Trust matters.', domSelector: '' }, { id: 'b1', text: 'Consistency builds confidence.', domSelector: '' }] } });
      } else if (msg && (msg.action === 'lector-jump-to' || msg.action === 'lector-toggle-bilingual' || msg.action === 'lector-get-selection')) {
        cb && cb({ ok: true, selection: '' });
      } else { cb && cb({}); }
    },
  },
  sidePanel: { open: () => Promise.resolve() },
};
</script>
<script type="module" src="/sidepanel.js"></script>
</body></html>`
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
    }
    // Static file from dist.
    let filePath
    try { filePath = resolve(DIST, '.' + u) } catch { return res.writeHead(404).end() }
    try {
      const data = readFileSync(filePath)
      const ext = filePath.slice(filePath.lastIndexOf('.'))
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' }).end(data)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
}

let msgId = 0
const openWS = async (url) => { const ws = new WebSocket(url); await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) }); return ws }
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => { const id = ++msgId; const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) } }; ws.on('message', h); ws.send(JSON.stringify({ id, method, params })) })
async function evalIn(ws, expression, awaitPromise = false) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 220))
  return r.result.value
}
const getTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
const openTab = async (port, url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json())

async function main() {
  const server = startServer()
  await new Promise((r) => server.listen(8790, r))
  const SHELL = 'http://localhost:8790/'
  const BOOT_SHELL = 'http://localhost:8790/boot-shell.html'

  const profile = mkdtempSync(resolve(tmpdir(), 'lector-sp-'))
  const port = 9550 + Math.floor(Math.random() * 20)
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  let bootPage
  // Kill the detached Chrome + drop the temp profile on Ctrl-C / SIGTERM too —
  // the normal cleanup() only runs when main() completes, so an interrupted
  // run would otherwise leak a headless Chrome process group.
  process.on('SIGINT', () => { void cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { void cleanup(); process.exit(143) })
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }

    // ---- Synchronous production boot shell (before bundle/React) ----
    await openTab(port, BOOT_SHELL)
    let bootTarget
    for (let i = 0; i < 20; i++) {
      bootTarget = (await getTargets(port)).find((t) => t.type === 'page' && t.url === BOOT_SHELL)
      if (bootTarget) break
      await sleep(25)
    }
    if (bootTarget) {
      bootPage = await openWS(bootTarget.webSocketDebuggerUrl)
      await cdpCall(bootPage, 'Runtime.enable')
      const bootFrame = await evalIn(bootPage, `(()=>{
        const root = document.querySelector('#root');
        const shell = root?.querySelector(':scope > .lector-boot');
        const rect = shell?.getBoundingClientRect();
        return {
          entryRequested: window.__sidepanelEntryRequested === true,
          hasReactApp: !!document.querySelector('header'),
          text: root?.textContent?.trim() || '',
          visible: !!rect && rect.width > 0 && rect.height > 0,
        };
      })()`)
      check(
        '§first paint uses production synchronous boot shell before React mounts',
        bootFrame.entryRequested && !bootFrame.hasReactApp && bootFrame.visible && /Lector AI/.test(bootFrame.text) && /Loading|正在加载/.test(bootFrame.text),
        `visible=${bootFrame.visible}, react=${bootFrame.hasReactApp}, text="${bootFrame.text.slice(0, 45)}"`,
      )
    } else {
      check('§first paint uses production synchronous boot shell before React mounts', false, 'boot-shell target missing')
    }

    await openTab(port, SHELL)
    await sleep(3500)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === SHELL)
    if (!pageTarget) { check('sidepanel shell page present', false); return cleanup() }
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')
    // Surface page-side errors for diagnosis.
    page.on('message', (data) => {
      try {
        const m = JSON.parse(data)
        if (m.method === 'Runtime.exceptionThrown') {
          const e = m.params.exceptionDetails
          console.error('PAGE-EXC:', (e.exception?.description || e.text || '').slice(0, 500))
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          console.error('PAGE-CONSOLE-ERR:', m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300))
        }
      } catch {}
    })

    // ---- React app mounts ----
    const headerPresent = await evalIn(page, `!!document.querySelector('header')`)
    check('§sidepanel React app mounts (header)', headerPresent)
    // Header holds: Bilingual + Open-in-new-window + Settings (3). Tabs
    // (Chat/Sentences/Highlights/Vocab/More) live in the .tab-bar nav below.
    const headerBtns = await evalIn(page, `document.querySelectorAll('header button').length`)
    check('§sidepanel header buttons render (Bilingual/Expand/Settings)', headerBtns >= 3, `buttons=${headerBtns}`)
    const tabBtns = await evalIn(page, `document.querySelectorAll('.tab-bar button').length`)
    check('§sidepanel tab-bar renders (Chat/Sentences/Highlights/Vocab/More)', tabBtns >= 5, `tabs=${tabBtns}`)

    // The bilingual toggle button (🌐 / "Translate page paragraphs").
    const biBtn = await evalIn(page, `document.querySelectorAll('header button[title*="bilingual" i], header button[title*="paragraphs" i]').length`)
    check('§9 bilingual toggle button present in header', biBtn === 1, `found=${biBtn}`)

    // The title pulled from the (stubbed) content-script page.
    const titleShown = await evalIn(page, `document.querySelector('header')?.innerText || ''`)
    check('§sidepanel shows page title from content script', /Trust in Software/i.test(titleShown), `title="${titleShown.slice(0, 40)}"`)

    // Provider config line shows the configured provider (no "no key" prompt).
    const providerLine = await evalIn(page, `[...document.querySelectorAll('header div')].map(d=>d.textContent).find(t=>/OpenAI|model/i.test(t)) || ''`)
    check('§sidepanel shows configured provider (BYOK)', /OpenAI/i.test(providerLine), `line="${providerLine.slice(0, 40)}"`)

    const seededTranslation = await evalIn(page, `document.querySelector('textarea')?.value || ''`)
    check(
      '§translate seed follows translation target instead of UI locale',
      /Translate this to French/i.test(seededTranslation) && !/Translate this to 中文/i.test(seededTranslation),
      `seed="${seededTranslation.slice(0, 80)}"`
    )

    // Content-script cancellation and genuine failures share the same action.
    // Only the explicit structural flag may suppress UI; English words such as
    // "stopped" are valid error text and must remain visible.
    const runtimeListenerCount = await evalIn(page, `(window.__runtimeListeners || []).length`)
    check('§sidepanel registers bilingual runtime error listener', runtimeListenerCount >= 1, `listeners=${runtimeListenerCount}`)

    await evalIn(page, `(()=>{
      const message = { action: 'lector-bilingual-error', message: 'hidden stopped cancellation sentinel', canceled: true };
      for (const listener of window.__runtimeListeners || []) listener(message, {}, () => {});
    })()`)
    await sleep(100)
    check(
      '§bilingual error with canceled:true is not displayed',
      !(await evalIn(page, `document.body.innerText.includes('hidden stopped cancellation sentinel')`)),
    )

    await evalIn(page, `(()=>{
      const message = { action: 'lector-bilingual-error', message: 'requests stopped after provider failures', canceled: false };
      for (const listener of window.__runtimeListeners || []) listener(message, {}, () => {});
    })()`)
    await sleep(100)
    check(
      '§genuine stopped error with canceled:false is displayed',
      await evalIn(page, `document.body.innerText.includes('requests stopped after provider failures')`),
    )

    await evalIn(page, `(()=>{
      const message = { action: 'lector-bilingual-error', message: 'translation stopped because the circuit opened' };
      for (const listener of window.__runtimeListeners || []) listener(message, {}, () => {});
    })()`)
    await sleep(100)
    check(
      '§genuine stopped error without canceled field is displayed',
      await evalIn(page, `document.body.innerText.includes('translation stopped because the circuit opened')`),
    )

    // Relay queues written while the panel was closed must be drained on mount;
    // onChanged only observes future writes and cannot recover this snapshot.
    await evalIn(page, `document.querySelector('.tab-bar button[aria-label="Highlights"]')?.click()`)
    await sleep(200)
    check(
      '§sidepanel drains pre-existing relay queues on first open',
      await evalIn(page, `document.body.innerText.includes('Captured while the panel was closed.')`)
    )
    await evalIn(page, `document.querySelector('.tab-bar button[aria-label="Chat"]')?.click()`)
    await sleep(100)

    // ---- §6 chat: type + Enter, watch SSE tokens stream into the bubble ----
    await evalIn(page, `(()=>{const ta=document.querySelector('textarea'); if(!ta) return 'no-textarea'; const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(ta,'Why does trust matter?'); ta.dispatchEvent(new Event('input',{bubbles:true})); return ta.value})()`)
    await evalIn(page, `(()=>{const ta=document.querySelector('textarea'); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 'sent'})()`)
    // Wait for the assistant bubble to stream tokens.
    let assistant = ''
    for (let i = 0; i < 30; i++) {
      assistant = String((await evalIn(page, `document.querySelector('.lector-prose')?.textContent || ''`)) || '')
      if (/Trust/.test(assistant)) break
      await sleep(250)
    }
    check('§6 chat streams tokens into assistant bubble (BYOK SSE)', /Trust/.test(assistant), `text="${assistant.slice(0, 50)}"`)
    const chatFetch = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchCalls||[]).filter(u=>u.endsWith('/responses')))`) || '[]')
    check('§6 chat hit provider /responses (BYOK)', chatFetch.length >= 1, `calls=${chatFetch.length}`)
    const userPromptCount = await evalIn(page, `(()=>{
      const body=(window.__fetchBodies||[]).find(b=>Array.isArray(b.input));
      return body ? body.input.filter(m=>m.role==='user' && m.content==='Why does trust matter?').length : 0;
    })()`)
    check('§6 current user prompt is sent exactly once', userPromptCount === 1, `count=${userPromptCount}`)

    // Citation chip rendered from the [0] marker (validCiteIds = page blocks b0/b1).
    const chip = await evalIn(page, `document.querySelectorAll('.lector-cite[data-cite="b0"]').length`)
    check('§6 citation chip rendered ([0] → b0)', chip >= 1, `chips=${chip}`)

    // Clicking the chip fires lector-jump-to (captured by our tabs.sendMessage stub).
    await evalIn(page, `(()=>{const c=document.querySelector('.lector-cite[data-cite="b0"]'); if(!c) return 'no-chip'; c.click(); return 'clicked'})()`)
    await sleep(200)
    const jumpMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-jump-to'))`) || '[]')
    check('§6 citation chip click → lector-jump-to dispatched', jumpMsg.length >= 1, `msgs=${jumpMsg.length}`)

    // ---- §9 bilingual button click → lector-toggle-bilingual dispatched ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('header button')].find(x=>/bilingual|paragraphs/i.test(x.title||'')); if(!b) return 'no-btn'; b.click(); return 'clicked'})()`)
    await sleep(400)
    const biMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-toggle-bilingual'))`) || '[]')
    check('§9 bilingual button click → lector-toggle-bilingual dispatched', biMsg.length >= 1, `msgs=${biMsg.length}`)

    // ---- §7 session library: open via More menu → Library (flat view) ----
    await evalIn(page, `(()=>{const more=[...document.querySelectorAll('.tab-bar button')].find(b=>/more/i.test(b.getAttribute('aria-label')||'')); if(!more) return 'no-more'; more.click(); return 'opened-more'})()`)
    await sleep(200)
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Library'); if(b){b.click(); return 'opened'} return 'no-btn'})()`)
    await sleep(400)
    check('§7 library view opens after a chat', await evalIn(page, `document.body.innerText.includes('Library')`))

    // ---- tab switching is mutually exclusive (flat views) ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('.tab-bar button')].find(x=>(x.getAttribute('aria-label')||'')==='Sentences'); if(b){b.click(); return 'clicked'} return 'no-btn'})()`)
    await sleep(200)
    const sentencesActive = await evalIn(page, `!!document.querySelector('.tab-bar button[aria-label="Sentences"].tab-item-active')`)
    check('§tab: clicking Sentences activates its tab (flat, no overlay)', sentencesActive)
    // ---- §tab: no absolute inset-0 overlay present (stacking eliminated) ----
    const overlayGone = await evalIn(page, `document.querySelectorAll('.absolute.inset-0').length === 0`)
    check('§tab: no absolute inset-0 overlay present (stacking eliminated)', overlayGone)

    // ---- §theme: palette switching (paper tint + accent family) ----
    // Settings lives behind the header gear (aria-label = settings.title).
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('header button')].find(x=>(x.getAttribute('aria-label')||'')==='Bring Your Own Key'); if(b){b.click(); return 'opened'} return 'no-btn'})()`)
    await sleep(500)

    // Default palette is paper and its injected stylesheet is live before React.
    const paperBg = await evalIn(page, `getComputedStyle(document.body).backgroundColor`)
    check(
      '§theme: default palette is paper (body bg = #F5EFE3)',
      (await evalIn(page, `document.documentElement.dataset.palette || ''`)) === 'paper' && paperBg === 'rgb(245, 239, 227)',
      `palette=${await evalIn(page, `document.documentElement.dataset.palette || ''`)} bg=${paperBg}`,
    )
    // textContent (not cssRules): Chrome re-serializes selectorText and drops
    // the quotes from [data-palette='ink'], so match the raw sheet text.
    const paletteSheet = await evalIn(
      page,
      `[...document.querySelectorAll('style')].some(s => (s.textContent||'').includes("data-palette='ink'"))`,
    )
    check('§theme: palette override stylesheet injected', paletteSheet)

    // Theme picker renders one card per catalog theme.
    const themeCards = await evalIn(page, `document.querySelectorAll('[role="radiogroup"][aria-label="Theme color"] [role="radio"]').length`)
    check('§theme: picker renders a card per theme (5)', themeCards === 5, `cards=${themeCards}`)

    // Cards lay out as readable 2-column tiles (no zero-size/clipped renders)
    // and each mini preview shows its OWN theme's paper color, not the
    // current palette's CSS vars.
    const cardGeometry = JSON.parse(await evalIn(page, `JSON.stringify(
      [...document.querySelectorAll('[role="radiogroup"][aria-label="Theme color"] [role="radio"]')].map(b => {
        const r = b.getBoundingClientRect()
        const preview = b.querySelector('div')
        return { w: Math.round(r.width), h: Math.round(r.height), preview: preview ? getComputedStyle(preview).backgroundColor : '' }
      })
    )`) || '[]')
    const geometryOk =
      cardGeometry.length === 5 &&
      cardGeometry.every((c) => c.w >= 100 && c.h >= 70) &&
      cardGeometry[0].preview === 'rgb(245, 239, 227)' &&
      cardGeometry[1].preview === 'rgb(238, 241, 246)'
    check(
      '§theme: preview cards are sized tiles showing their own theme colors',
      geometryOk,
      `cards=${JSON.stringify(cardGeometry.map((c) => `${c.w}x${c.h} ${c.preview}`))}`,
    )

    // Click Indigo Ink → data-palette flips and real token colors change.
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('[role="radiogroup"][aria-label="Theme color"] [role="radio"]')].find(x=>/Indigo Ink/.test(x.textContent||'')); if(b){b.click(); return 'clicked'} return 'no-card'})()`)
    await sleep(300)
    const inkBg = await evalIn(page, `getComputedStyle(document.body).backgroundColor`)
    const inkAccent = await evalIn(page, `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)
    // Persistence is debounced (400ms trailing) — wait out the flush window
    // before reading localStorage, or the pre-click value is still there.
    await sleep(700)
    const inkSaved = await evalIn(page, `(JSON.parse(localStorage.getItem('lector-ai-storage')||'{}').state?.byok?.palette) || ''`)
    check(
      '§theme: selecting 靛墨 flips tokens + persists (bg #EEF1F6, accent #3D5488)',
      (await evalIn(page, `document.documentElement.dataset.palette || ''`)) === 'ink' &&
        inkBg === 'rgb(238, 241, 246)' &&
        inkAccent.toLowerCase() === '#3d5488' &&
        inkSaved === 'ink',
      `bg=${inkBg} accent=${inkAccent} saved=${inkSaved}`,
    )

    // Pin Dark → the same palette swaps to its dark variant without a reload.
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Dark'); if(b){b.click(); return 'clicked'} return 'no-btn'})()`)
    await sleep(300)
    const inkDarkBg = await evalIn(page, `getComputedStyle(document.body).backgroundColor`)
    check(
      '§theme: dark scheme swaps palette variant live (bg #141822)',
      (await evalIn(page, `document.documentElement.classList.contains('dark')`)) && inkDarkBg === 'rgb(20, 24, 34)',
      `bg=${inkDarkBg}`,
    )

    // Restore paper + light so later manual inspection starts from the default.
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('[role="radiogroup"][aria-label="Theme color"] [role="radio"]')].find(x=>/Warm Paper/.test(x.textContent||'')); if(b) b.click(); return 'ok'})()`)
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Light'); if(b) b.click(); return 'ok'})()`)
    await sleep(300)

    await cleanup()
  } catch (e) {
    console.error('E2E error:', e.stack || e.message)
    // Never let an exception truncate the suite and still report success —
    // mark it failed explicitly (mirrors run-browser-e2e.mjs).
    check('sidepanel E2E completed without uncaught error', false, e instanceof Error ? e.message : String(e))
    await cleanup()
  }

  async function cleanup() {
    try { page && page.close() } catch {}
    try { bootPage && bootPage.close() } catch {}
    try { server.close() } catch {}
    try { process.kill(-proc.pid) } catch {}
    printSummary()
  }
}

function printSummary() {
  const pass = results.filter((r) => r.ok).length
  console.log('')
  console.log(`=== Side panel React E2E: ${pass}/${results.length} passed ===`)
  const fails = results.filter((r) => !r.ok)
  if (fails.length) { console.log('Failures:'); fails.forEach((r) => console.log(`  - ${r.name}: ${r.detail}`)); process.exit(1) }
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
