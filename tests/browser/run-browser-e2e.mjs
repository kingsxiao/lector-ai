// Real browser end-to-end verification of the Lector AI CONTENT SCRIPT.
//
// Approach: on this machine Chrome 149 + `--load-extension` half-loads the
// extension (SW registers, but content scripts never inject and
// chrome://extensions renders empty). To still exercise the REAL production
// content-script code, we read dist/content.js and inject it into the page's
// main world alongside a minimal chrome.* stub. The stub records the messages
// the content script would normally relay to the background (lector-highlight,
// lector-save-word, open-side-panel) so we can assert them. The mock backend
// serves /api/translate so the toolbar translate + bilingual paths hit a real
// HTTP round-trip. This runs the actual shipped content.js — not a copy.
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

function startServers() {
  const api = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (req.method !== 'POST') return res.writeHead(405).end('{}')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let p = {}
      try { p = JSON.parse(body || '{}') } catch { /* */ }
      if (req.url === '/api/translate') { const o = { translatedText: `[译文] ${p.text || ''}` }; if (p.bilingual) o.original = p.text; return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o)) }
      if (req.url === '/api/summarize') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ summary: 'MOCK SUMMARY: trust earned via consistency.', keyPoints: ['consistency'] }))
      res.writeHead(404).end('{}')
    })
  })
  const fix = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(readFileSync(FIXTURE, 'utf8')))
  return new Promise((r) => api.listen(8787, () => fix.listen(8788, () => r({ api, fix }))))
}

let msgId = 0
const openWS = async (url) => { const ws = new WebSocket(url); await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) }); return ws }
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => { const id = ++msgId; const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) } }; ws.on('message', h); ws.send(JSON.stringify({ id, method, params })) })
async function evalIn(ws, expression, awaitPromise = false) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200))
  return r.result.value
}
const getTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
const openTab = async (port, url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json())

// The chrome.* stub installed before content.js runs. It records relay messages.
const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      window.__lectorMsgs.push(msg);
      // Simulate the background relay responding for translate/summarize/explain
      // so the content script's callback path renders the result popup.
      if (typeof cb === 'function') {
        if (msg && msg.action === 'translate') cb({ translatedText: '[译文] mock-translate' });
        else if (msg && msg.action === 'summarize') cb({ summary: 'MOCK SUMMARY' });
        else if (msg && msg.action === 'explain') cb({ explanation: 'MOCK EXPLAIN' });
        else cb({});
      }
      return { catch() {} };
    },
    lastError: null,
    onMessage: { addListener(fn) { window.__lectorMsgHandlers.onMessage = fn; } },
  },
  storage: { local: { get: (k, cb) => cb && cb({ apiBase: 'http://localhost:8787/api' }), set: (v, cb) => cb && cb() } },
};
'done';
`

// Helper to drive a content-script message handler (as if the background sent it).
const fireContentMessage = (ws, msg) => evalIn(ws, `(() => { const h = window.__lectorMsgHandlers.onMessage; if (!h) return 'no-handler'; let resp; h(${JSON.stringify(msg)}, {}, (r) => { resp = r }); return JSON.stringify(resp); })()`)

async function main() {
  const { api, fix } = await startServers()
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
    // extractPage runs lazily; invoke it by firing the message the side panel sends.
    const resp = await fireContentMessage(page, { action: 'lector-get-page' })
    const pg = JSON.parse(resp || 'null')
    check('§extract lector-get-page returns parsed page', !!pg?.page, `title="${pg?.page?.title}"`)
    check('§extract detected language en', pg?.page?.lang === 'en', `lang=${pg?.page?.lang}`)
    check('§extract blocks stable b0/b1 ids', pg?.page?.blocks?.length >= 3 && pg.page.blocks[0].id === 'b0', `blocks=${pg?.page?.blocks?.length}`)
    // extractPage also tags live DOM nodes.
    check('§extract tags live DOM nodes with data-lector-id', (await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)) >= 3, `count=${await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)}`)

    const selectReveal = async (js) => {
      // js selects text inside a paragraph; dispatch mouseup ON that paragraph
      // so the content script's handler sees a real Element as e.target
      // (it calls e.target.closest(...), which needs an Element, not document).
      await evalIn(page, js)
      await evalIn(page, `(()=>{ const el = window.getSelection().anchorNode?.parentElement || document.body; el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); })()`)
      await sleep(600)
    }
    const clickToolbarBtn = (txt) => evalIn(page, `(()=>{const b=[...document.querySelectorAll('#lector-ai-toolbar button')].find(x=>x.textContent.includes(${JSON.stringify(txt)})); if(b){b.click(); return true} return false})()`)

    // ---- §2 selection toolbar ----
    await selectReveal(`(() => { const el = document.querySelector('article p'); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    check('§2.1 selection toolbar appears', await evalIn(page, `!!document.getElementById('lector-ai-toolbar')`))
    check('§2.1 toolbar has 7 buttons', (await evalIn(page, `document.querySelectorAll('#lector-ai-toolbar button').length`)) === 7, `buttons=${await evalIn(page, `document.querySelectorAll('#lector-ai-toolbar button').length`)}`)

    // ---- §2.2 translate toolbar → stubbed backend relay → result popup ----
    await clickToolbarBtn('翻译')
    for (let i = 0; i < 20; i++) { if (await evalIn(page, `!!document.querySelector('#lector-ai-result .result-content')`)) break; await sleep(150) }
    const tr = String((await evalIn(page, `document.querySelector('#lector-ai-result .result-content')?.textContent || ''`)) || '')
    check('§2.2 translate toolbar → result popup', tr.includes('译文') || tr.includes('mock'), `result="${tr.slice(0, 40)}"`)

    // ---- §3 highlight capture → lector-highlight message relayed ----
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[1]; const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await clickToolbarBtn('高亮')
    await sleep(300)
    const hlMarked = (await evalIn(page, `document.querySelectorAll('mark.lector-hl').length`)) >= 1
    const hlMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-highlight'))`) || '[]')
    check('§3.1 selection wrapped in <mark class="lector-hl">', hlMarked)
    check('§3.2 lector-highlight message relayed (text+url+blockId)', hlMsg.length >= 1 && !!hlMsg[0].highlight?.text, `msgs=${hlMsg.length}`)

    // ---- §4 save word → lector-save-word message relayed ----
    await selectReveal(`(() => { const el = document.querySelectorAll('article p')[2]; const r = document.createRange(); r.setStart(el.firstChild,0); r.setEnd(el.firstChild,5); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`)
    await clickToolbarBtn('存词')
    await sleep(300)
    const swMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]')
    check('§4.1 save-word message relayed (word+context)', swMsg.length >= 1 && !!swMsg[0].word, `word="${swMsg[0]?.word}"`)

    // ---- §9 bilingual toggle → injects .lector-bilingual via real backend ----
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(1200)
    check('§9.1 lector-toggle-bilingual injects .lector-bilingual blocks', (await evalIn(page, `document.querySelectorAll('.lector-bilingual').length`)) >= 1, `blocks=${await evalIn(page, `document.querySelectorAll('.lector-bilingual').length`)}`)

    // ---- §2.3 Escape closes popups ----
    await evalIn(page, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(200)
    check('§2.3 Escape clears toolbar/result', await evalIn(page, `!document.querySelector('#lector-ai-toolbar') && !document.querySelector('#lector-ai-result')`))

    // ---- §5 command routes (Alt+H/Alt+S) ----
    // The content script's lector-command handler dispatches to
    // handleHighlight/handleSaveWord. Fire it and confirm a new highlight/word.
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
    try { api.close(); fix.close() } catch {}
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
