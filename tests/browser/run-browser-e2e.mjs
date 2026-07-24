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
    const resp = await fireContentMessage(page, { action: 'lector-get-page' })
    const pg = JSON.parse(resp || 'null')
    check('§extract lector-get-page returns parsed page', !!pg?.page, `title="${pg?.page?.title}"`)
    check('§extract detected language en', pg?.page?.lang === 'en', `lang=${pg?.page?.lang}`)
    check('§extract blocks stable b0/b1 ids', pg?.page?.blocks?.length >= 3 && pg.page.blocks[0].id === 'b0', `blocks=${pg?.page?.blocks?.length}`)
    check('§extract tags live DOM nodes with data-lector-id', (await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)) >= 3, `count=${await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)}`)

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

    // ---- §1.2 FAB click → open-side-panel message relayed ----
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(200)
    const openMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='open-side-panel'))`) || '[]')
    check('§1.2 FAB click → open-side-panel relayed', openMsgs.length >= 1)

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
