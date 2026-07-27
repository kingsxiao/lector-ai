// Real browser end-to-end verification of the Lector AI CONTENT SCRIPT (BYOK).
//
// Approach: headless Chrome loads a fixture article; we inject the REAL
// production dist/content.js into the page's main world alongside a chrome.*
// stub tailored to the current BYOK architecture:
//   - chrome.storage.local.get returns BYOK settings WITH an apiKey so the
//     content script's translate / explain / summarize / bilingual paths run.
//   - chrome.runtime.sendMessage returns a real Promise (resolves {}), so
//     relayOrAlert() (highlight / save-word / open-side-panel) doesn't hang —
//     the messages are recorded for assertion.
//   - window.fetch is stubbed to return an OpenAI-shaped SSE stream so
//     streamChat/readSSE parses real tokens (no network, no key needed).
//
// This runs the actual shipped content.js — not a copy.
//
// Run: node tests/browser/run-browser-e2e.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const FIXTURE = resolve(import.meta.dirname, 'fixtures', 'article.html')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CONTENT_SRC = readFileSync(resolve(DIST, 'content.js'), 'utf8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// Serve the fixture article (the content script is injected via CDP, not via
// the manifest, because --load-extension doesn't reliably inject in headless).
function startServer() {
  const srv = http.createServer((req, res) =>
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(readFileSync(FIXTURE, 'utf8'))
  )
  return new Promise((r) => srv.listen(8788, () => r(srv)))
}

let msgId = 0
const openWS = async (url) => { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) }); return ws }
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => { const id = ++msgId; const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) } }; ws.on('message', h); ws.send(JSON.stringify({ id, method, params })) })
async function evalIn(ws, expression, awaitPromise = false) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 220))
  return r.result.value
}
const getTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
const openTab = async (port, url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json())

// chrome.* stub installed before content.js runs. Records relay messages and
// returns real Promises so relayOrAlert()'s `await chrome.runtime.sendMessage`
// resolves. window.fetch is stubbed to an OpenAI-shaped SSE stream so the BYOK
// translate / explain / bilingual paths produce real output.
const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
// Capture window.open so the FAB test can assert the reliable MV3 opener path
// (chrome.sidePanel.open can't be triggered from a content-script click; the
// FAB falls back to window.open(chrome.runtime.getURL('sidepanel/index.html'))).
window.__openCalls = [];
const __origOpen = window.open.bind(window);
window.open = (url, name) => { window.__openCalls.push({ url: String(url), name: String(name) }); return null; };

// Build a ReadableStream that emits OpenAI-style SSE frames:
//   data: {"choices":[{"delta":{"content":"..."}}]}
// …then a terminating data: [DONE].
function sseStream(tokens) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const t of tokens) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\\n\\n'));
      }
      controller.enqueue(enc.encode('data: [DONE]\\n\\n'));
      controller.close();
    }
  });
}

window.fetch = function (url, opts) {
  window.__fetchCalls.push(String(url));
  // Capture the request body so tests can assert translation direction (the
  // system prompt's target language) — guards against the English→English
  // regression caused by detectScript mis-classifying mixed-script pages.
  try { window.__fetchBodies = window.__fetchBodies || []; window.__fetchBodies.push(opts && opts.body ? JSON.parse(opts.body) : null); } catch (e) {}
  // Every BYOK call (translate/explain/summarize/bilingual/testConnection)
  // hits {baseUrl}/chat/completions with stream:true. Return a 200 SSE body.
  return Promise.resolve({
    ok: true,
    status: 200,
    body: sseStream(['[译文] ', 'mock-', 'translated']),
    json: () => Promise.resolve({ data: [{ id: 'mock-model' }] }),
    text: () => Promise.resolve(''),
  });
};

window.chrome = {
  runtime: {
    // Return a real Promise (resolved) so relayOrAlert()'s await completes.
    sendMessage: (msg) => {
      window.__lectorMsgs.push(msg);
      return Promise.resolve({});
    },
    // The FAB's reliable opener builds the panel URL via getURL.
    getURL: (p) => 'chrome-extension://testid/' + p.replace(/^\\//, ''),
    lastError: null,
    onMessage: { addListener(fn) { window.__lectorMsgHandlers.onMessage = fn; } },
  },
  storage: {
    local: {
      // BYOK settings WITH an apiKey so the content script's AI paths run.
      // locale:'zh' makes the toolbar buttons render Chinese labels
      // deterministically (headless Chrome's navigator.language is en-US, so
      // 'auto' would resolve to 'en' and the 翻译/高亮/存词 selectors miss).
      get: (_keys, cb) => cb && cb({
        lector_byok_settings: {
          provider: 'openai',
          apiKey: 'sk-test-mock-key',
          model: 'gpt-4o-mini',
          baseUrl: '',
          locale: 'zh',
          translation: { targetLanguage: 'auto', displayMode: 'bilingual', autoTranslate: false, concurrency: 5 },
        },
        lectorGlossary: [],
      }),
      set: (_v, cb) => cb && cb(),
    },
  },
};
'done';
`

// Helper to drive a content-script message handler (as if the background sent it).
const fireContentMessage = (ws, msg) => evalIn(ws, `(() => { const h = window.__lectorMsgHandlers.onMessage; if (!h) return 'no-handler'; let resp; h(${JSON.stringify(msg)}, {}, (r) => { resp = r }); return JSON.stringify(resp); })()`)

async function main() {
  const server = await startServer()
  const ARTICLE = 'http://localhost:8788/article.html'

  const profile = mkdtempSync(resolve(tmpdir(), 'lector-e2e-'))
  const port = 9530 + Math.floor(Math.random() * 15)
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    check('Chrome (headless=new) launches with remote debugging', true, `port ${port}`)

    await openTab(port, ARTICLE)
    await sleep(1500)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === ARTICLE)
    check('article page target present', !!pageTarget)
    if (!pageTarget) return cleanup()
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')

    // Install the chrome.* stub, then inject the REAL production content.js.
    await evalIn(page, CHROME_STUB)
    const inj = await cdpCall(page, 'Runtime.evaluate', { expression: CONTENT_SRC, awaitPromise: false, returnByValue: true })
    check('real dist/content.js injects without error', !inj.exceptionDetails, inj.exceptionDetails ? (inj.exceptionDetails.exception?.description || inj.exceptionDetails.text).slice(0, 120) : 'ran')
    await sleep(500)

    // ---- §1 content script + FAB + styles ----
    check('§1.1 FAB injected (text "L")', (await evalIn(page, `document.querySelector('#lector-ai-fab')?.textContent`)) === 'L')
    check('§1 content styles injected', await evalIn(page, `!!document.getElementById('lector-ai-styles')`))

    // ---- extractPage via the content script's lector-get-page handler ----
    // Run BEFORE the FAB menu tests: the "translate page" menu item injects
    // .lector-bilingual blocks (Chinese translations) which would otherwise
    // pollute extractPage's language detection.
    const resp = await fireContentMessage(page, { action: 'lector-get-page' })
    const pg = JSON.parse(resp || 'null')
    check('§extract lector-get-page returns parsed page', !!pg?.page, `title="${pg?.page?.title}"`)
    check('§extract detected language en', pg?.page?.lang === 'en', `lang=${pg?.page?.lang}`)
    check('§extract blocks stable b0/b1 ids', pg?.page?.blocks?.length >= 3 && pg.page.blocks[0].id === 'b0', `blocks=${pg?.page?.blocks?.length}`)
    check('§extract tags live DOM nodes with data-lector-id', (await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)) >= 3, `count=${await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)}`)

    // ---- §1.2 FAB opens a radial quick-action menu ----
    // The FAB no longer opens a window directly; it pops a radial menu of
    // page-level actions. Verify: click FAB → menu appears with 4 items;
    // each item is a menuitem; clicking "open in new window" triggers
    // window.open with the cached sidepanel URL; clicking "translate page"
    // triggers the bilingual message; clicking FAB again closes the menu.
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; window.__lectorMsgs.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    const menuState = JSON.parse(await evalIn(page, `(()=>{ const m = document.querySelector('.lector-fab-menu'); const items = m ? m.querySelectorAll('.lector-fab-item') : []; return JSON.stringify({ open: !!m, itemCount: items.length, aria: document.querySelector('#lector-ai-fab').getAttribute('aria-expanded'), labels: [...items].map(i=>i.getAttribute('aria-label')) }); })()`) || '{}')
    check('§1.2 FAB click → radial menu opens', menuState.open, `open=${menuState.open}`)
    check('§1.2 menu has 4 items (translate/summarize/panel/standalone)', menuState.itemCount === 4, `count=${menuState.itemCount}`)
    check('§1.2 FAB aria-expanded reflects open state', menuState.aria === 'true', `aria=${menuState.aria}`)
    check('§1.2 menu items are role=menuitem with labels', menuState.labels && menuState.labels.length === 4 && menuState.labels.every((l) => typeof l === 'string' && l.length > 0), `labels=${JSON.stringify(menuState.labels)}`)

    // Click the "open in new window" menu item → window.open(cached URL).
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /new window|单独打开/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(350)
    const fabOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.2 "open in new window" item → window.open(sidepanel URL)', fabOpenCalls.length >= 1 && fabOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(fabOpenCalls)}`)
    check('§1.2 reuses named window lector-ai-panel', fabOpenCalls.length === 0 || fabOpenCalls[0].name === 'lector-ai-panel', `name="${fabOpenCalls[0]?.name}"`)
    // Menu auto-closes after an item is picked (closeFabMenu removes the DOM
    // after its collapse animation; wait past the 280ms timeout).
    const closedAfterPick = !(await evalIn(page, `!!document.querySelector('.lector-fab-menu')`))
    check('§1.2 menu closes after picking an item', closedAfterPick, closedAfterPick ? 'ok' : 'still open')

    // Reopen → "translate page" item runs the page bilingual translation
    // directly (it does NOT re-send lector-toggle-bilingual — that's the
    // inbound message from the side panel). Observable effect: the bilingual
    // loop injects .lector-bilingual-host blocks + sends progress messages.
    await evalIn(page, `(()=>{ window.__lectorMsgs.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /translate page|翻译整页/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(400)
    const hostsAfter = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const progressMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-bilingual-progress'))`) || '[]')
    check('§1.2 "translate page" item runs bilingual translation (hosts injected + progress)', hostsAfter > 0 && progressMsgs.length > 0, `hosts=${hostsAfter} progress=${progressMsgs.length}`)
    // Translation DIRECTION regression: an English page (the article fixture)
    // must translate to Chinese, not English. The old detectScript returned
    // 'cjk' whenever any CJK char was present, flipping direction so English
    // pages came back untranslated. Assert the captured request body's system
    // prompt asks for Chinese.
    const firstSys = await evalIn(page, `(()=>{ const b=(window.__fetchBodies||[])[0]; return (b && b.messages && b.messages[0] && b.messages[0].content) ? b.messages[0].content.slice(0,120) : ''; })()`)
    check('§1.2 English page → bilingual prompt asks for Chinese (direction bug)', /to Chinese/i.test(firstSys), `sys="${firstSys.slice(0,80)}"`)
    // "open side panel" item → open-side-panel message (best-effort) AND a
    // window.open fallback (MV3 forbids sidePanel.open from a content-script
    // click, so the item must also open the standalone window so the user
    // always sees Lector open — never a silent no-op).
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /side panel|侧边栏/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(200)
    const panelMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='open-side-panel'))`) || '[]')
    const panelOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.2 "open side panel" item → open-side-panel sent (best-effort)', panelMsgs.length >= 1, `count=${panelMsgs.length}`)
    check('§1.2 "open side panel" item → window.open fallback (reliable opener)', panelOpenCalls.length >= 1 && panelOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(panelOpenCalls)}`)
    // Toggle close: clicking FAB while open closes the menu without firing actions.
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    const openCount = await evalIn(page, `document.querySelectorAll('.lector-fab-item').length`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(350)
    const closedCount = await evalIn(page, `document.querySelectorAll('.lector-fab-item').length`)
    check('§1.2 clicking FAB again closes the menu', openCount === 4 && closedCount === 0, `open=${openCount} closed=${closedCount}`)

    // ---- §1.3 FAB menu survives "Extension context invalidated" ----
    // The orphaned-content-script regression: after ext reload / SW destroyed,
    // chrome.runtime.getURL/sendMessage throw synchronously. The URL is cached
    // at load and runtime calls are try/caught, so the menu still opens and the
    // "open in new window" item still window.opens the cached URL.
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; })()`)
    await evalIn(page, `(()=>{ const r = window.chrome.runtime; r.getURL = () => { throw new Error('Extension context invalidated.'); }; r.sendMessage = () => { throw new Error('Extension context invalidated.'); }; })()`)
    let invalidatedThrew = false
    try {
      await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
      await sleep(300)
      // Menu should still open even with invalidated runtime.
      const stillOpen = await evalIn(page, `!!document.querySelector('.lector-fab-menu')`)
      check('§1.3 FAB menu opens even when context invalidated', stillOpen, `open=${stillOpen}`)
      // "open in new window" still works via cached URL.
      await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /new window|单独打开/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
      await sleep(200)
    } catch (e) {
      invalidatedThrew = true
    }
    const invOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.3 FAB click does NOT throw on invalidated context', !invalidatedThrew, invalidatedThrew ? 'threw' : 'ok')
    check('§1.3 "open in new window" still works via cached URL when invalidated', invOpenCalls.length >= 1 && invOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(invOpenCalls)}`)
    // Restore a working runtime so later tests still pass.
    await evalIn(page, `(()=>{ const r = window.chrome.runtime; r.getURL = (p) => 'chrome-extension://testid/' + p.replace(/^\\//, ''); r.sendMessage = (m) => { window.__lectorMsgs.push(m); return Promise.resolve({}); }; })()`)

    const selectReveal = async (js) => {
      await evalIn(page, js)
      await evalIn(page, `(()=>{ const el = window.getSelection().anchorNode?.parentElement || document.body; el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); })()`)
      await sleep(600)
    }
    const clickToolbarBtn = (txt) => evalIn(page, `(()=>{const t=${JSON.stringify(txt)};const b=[...document.querySelectorAll('#lector-ai-toolbar button')].find(x=>x.textContent.includes(t)||x.title.includes(t)||(x.getAttribute('aria-label')||'').includes(t)); if(b){b.click(); return true} return false})()`)

    // ---- §2 selection toolbar ----
    await selectReveal(`(() => { const el = document.querySelector('article p'); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    check('§2.1 selection toolbar appears', await evalIn(page, `!!document.getElementById('lector-ai-toolbar')`))
    check('§2.1 toolbar has 7 buttons', (await evalIn(page, `document.querySelectorAll('#lector-ai-toolbar button').length`)) === 7, `buttons=${await evalIn(page, `document.querySelectorAll('#lector-ai-toolbar button').length`)}`)

    // ---- §2.2 translate toolbar → BYOK streamChat → result popup ----
    await clickToolbarBtn('翻译')
    for (let i = 0; i < 30; i++) { if (await evalIn(page, `!!document.querySelector('#lector-ai-result .result-content')`)) break; await sleep(150) }
    const tr = String((await evalIn(page, `document.querySelector('#lector-ai-result .result-content')?.textContent || ''`)) || '')
    check('§2.2 translate toolbar → BYOK result popup', tr.length > 0, `result="${tr.slice(0, 40)}"`)
    const fetchHits = JSON.parse(await evalIn(page, `JSON.stringify(window.__fetchCalls||[])`) || '[]')
    check('§2.2 translate hit provider /chat/completions (BYOK)', fetchHits.some((u) => u.endsWith('/chat/completions')), `calls=${fetchHits.length}`)
    // §2.2b the streaming popup also exposes a target-language selector + TTS buttons.
    check('§2.2b streaming popup has target-language selector', await evalIn(page, `!!document.querySelector('#lector-ai-result select')`))
    check('§2.2b streaming popup has read-aloud buttons', (await evalIn(page, `document.querySelectorAll('#lector-ai-result button.copy-btn').length`)) >= 1, `btns=${await evalIn(page, `document.querySelectorAll('#lector-ai-result button.copy-btn').length`)}`)

    // close the result popup so it doesn't block later selections
    await evalIn(page, `document.querySelector('#lector-ai-result')?.remove()`)

    // ---- §3 highlight capture → lector-highlight message relayed ----
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[1]; const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await clickToolbarBtn('高亮')
    await sleep(400)
    const hlMarked = (await evalIn(page, `document.querySelectorAll('mark.lector-hl').length`)) >= 1
    const hlMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-highlight'))`) || '[]')
    check('§3.1 selection wrapped in <mark class="lector-hl">', hlMarked, `marks=${await evalIn(page, `document.querySelectorAll('mark.lector-hl').length`)}`)
    check('§3.2 lector-highlight message relayed (text+url+blockId)', hlMsg.length >= 1 && !!hlMsg[0].highlight?.text, `msgs=${hlMsg.length}`)

    // ---- §4 save word → lector-save-word message relayed ----
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[2]; const r = document.createRange(); r.setStart(el.firstChild,0); r.setEnd(el.firstChild,5); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await clickToolbarBtn('存词')
    await sleep(300)
    const swMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]')
    check('§4.1 save-word message relayed (word+context)', swMsg.length >= 1 && !!swMsg[0].word, `word="${swMsg[0]?.word}"`)

    // ---- §9 bilingual toggle → injects .lector-bilingual via BYOK streamChat ----
    // Reset the fetch counter so we can measure how many requests the
    // concurrent bilingual pass fires (concurrency default = 5).
    await evalIn(page, `window.__fetchCalls = []`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(2000)
    const bilingualBlocks = await evalIn(page, `document.querySelectorAll('.lector-bilingual').length`)
    check('§9.1 lector-toggle-bilingual injects .lector-bilingual blocks', bilingualBlocks >= 1, `blocks=${bilingualBlocks}`)
    const bilingualFetches = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchCalls||[]).filter(u=>String(u).endsWith('/chat/completions')))`) || '[]')
    check('§9.2 bilingual fires concurrent requests (>1 in flight)', bilingualFetches.length >= 2, `chatCalls=${bilingualFetches.length}`)

    // §9.3 display modes: each translated block is marked a host so the
    // translationOnly / hover CSS can target it, and the original text is
    // wrapped in a .lector-bi-source span so translationOnly can hide it.
    const hostCount = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    check('§9.3a translated blocks are marked .lector-bilingual-host', hostCount === bilingualBlocks, `hosts=${hostCount} blocks=${bilingualBlocks}`)
    await evalIn(page, `document.body.classList.remove('lector-dm-bilingual'); document.body.classList.add('lector-dm-translationOnly')`)
    const origHiddenInTranslationOnly = await evalIn(page, `(() => { const s = document.querySelector('.lector-bilingual-host .lector-bi-source'); return !!s && getComputedStyle(s).display === 'none' })()`)
    check('§9.3b translationOnly hides the original text', origHiddenInTranslationOnly === true)
    const trVisibleInTranslationOnly = await evalIn(page, `(() => { const h = document.querySelector('.lector-bilingual-host .lector-bilingual'); return !!h && getComputedStyle(h).display !== 'none' })()`)
    check('§9.3c translationOnly keeps the translation visible', trVisibleInTranslationOnly === true)
    // restore default mode for any later checks
    await evalIn(page, `document.body.classList.remove('lector-dm-translationOnly'); document.body.classList.add('lector-dm-bilingual')`)

    // ---- §2.3 Escape closes popups ----
    await evalIn(page, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(200)
    check('§2.3 Escape clears toolbar/result', await evalIn(page, `!document.querySelector('#lector-ai-toolbar') && !document.querySelector('#lector-ai-result')`))

    // ---- §5 command routes (Alt+H/Alt+S) ----
    const hlBefore = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-highlight'))`) || '[]').length
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[3]; const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await fireContentMessage(page, { action: 'lector-command', command: 'highlight-selection' })
    await sleep(300)
    const hlAfter = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-highlight'))`) || '[]').length
    check('§5 Alt+H command route → highlight', hlAfter > hlBefore, `${hlBefore}→${hlAfter}`)

    const swBefore = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]').length
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[2]; const r = document.createRange(); r.setStart(el.firstChild,6); r.setEnd(el.firstChild,12); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await fireContentMessage(page, { action: 'lector-command', command: 'save-word' })
    await sleep(300)
    const swAfter = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]').length
    check('§5 Alt+S command route → save word', swAfter > swBefore, `${swBefore}→${swAfter}`)

    // ---- §A4 blockId whitelist (selector injection guard) ----
    const badId = await fireContentMessage(page, { action: 'lector-jump-to', blockId: 'b0"],.evil[x' })
    check('§A4 malicious blockId rejected (bad-id)', /bad-id/.test(badId), `resp="${String(badId).slice(0, 40)}"`)
    const goodId = await fireContentMessage(page, { action: 'lector-jump-to', blockId: 'b0' })
    check('§A4 valid blockId accepted (ok)', /"ok":true/.test(goodId), `resp="${String(goodId).slice(0, 40)}"`)

    await cleanup()
  } catch (e) {
    console.error('E2E error:', e.stack || e.message)
    await cleanup()
  }

  async function cleanup() {
    try { page && page.close() } catch {}
    try { server.close() } catch {}
    try { process.kill(-proc.pid) } catch {}
    printSummary()
  }
}

function printSummary() {
  const pass = results.filter((r) => r.ok).length
  console.log('')
  console.log(`=== Browser content-script E2E: ${pass}/${results.length} passed ===`)
  const fails = results.filter((r) => !r.ok)
  if (fails.length) { console.log('Failures:'); fails.forEach((r) => console.log(`  - ${r.name}: ${r.detail}`)); process.exit(1) }
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
