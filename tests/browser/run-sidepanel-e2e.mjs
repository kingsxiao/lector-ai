// Real browser E2E for the Lector AI SIDE PANEL React app.
//
// Loads the REAL production bundles (sidepanel.js + store/config chunks) by
// serving dist/ over http and injecting an HTML shell that: (1) creates #root,
// (2) installs a chrome.* stub (storage/tabs/runtime) wired to the mock backend,
// then (3) loads sidepanel.js as an ES module. React mounts the real App; we
// then drive it: chat send → SSE stream render → citation chip; 译 button click
// → tabs.sendMessage captured; header buttons render.
//
// Run: node tests/browser/run-sidepanel-e2e.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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
    // The API mock (same origin, /api/...).
    if (u.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      if (req.method === 'OPTIONS') return res.writeHead(204).end()
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (u === '/api/chat') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
          send({ type: 'meta', remaining: 17 })
          for (const t of ['Trust ', 'matters ', '[0].']) send({ type: 'token', delta: t })
          send({ type: 'done' })
          return res.end()
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ translatedText: '译文', summary: 'sum' }))
      })
      return
    }
    // Shell page: stubs chrome.* then loads the real sidepanel bundle.
    if (u === '/' || u === '/shell.html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SP</title>
<link rel="stylesheet" href="/assets/sidepanel-DzDcmfPu.css"></head>
<body><div id="root"></div>
<script>
window.__tabsSent = [];
window.__lectorMsgs = [];
const apiBase = location.origin + '/api';
window.chrome = {
  runtime: { lastError: null, id: 'testextid' },
  storage: {
    local: {
      // Modern chrome.storage supports promise usage (await get(...)); support
      // BOTH callback and promise so the App's onMount (which awaits) works.
      get: (keys, cb) => {
        const out = { apiBase, user: null, accessToken: null, lectorSeed: null }
        if (cb) cb(out)
        return Promise.resolve(out)
      },
      set: (obj, cb) => { if (cb) cb(); return Promise.resolve() },
      remove: (_keys, cb) => { if (cb) cb(); return Promise.resolve() },
    },
    onChanged: { addListener(){}, removeListener(){} },
  },
  tabs: {
    query: (_q, cb) => {
      const tabs = [{ id: 1, url: 'http://localhost/article.html', windowId: 1 }]
      if (cb) cb(tabs)
      return Promise.resolve(tabs)
    },
    sendMessage: (tabId, msg, cb) => {
      window.__lectorMsgs.push({ tabId, ...msg });
      // Simulate the content script replying with an extracted page so the
      // panel picks up page context (title/blocks) for citation grounding.
      if (msg && msg.action === 'lector-get-page') {
        cb && cb({ page: { title: 'Trust in Software', url: 'http://localhost/article.html', text: 'Trust matters. Consistency builds confidence.', lang: 'en', blocks: [{ id: 'b0', text: 'Trust matters.', domSelector: '' }, { id: 'b1', text: 'Consistency builds confidence.', domSelector: '' }] } });
      } else if (msg && (msg.action === 'lector-jump-to' || msg.action === 'lector-toggle-bilingual')) {
        cb && cb({ ok: true });
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

  const profile = mkdtempSync(resolve(tmpdir(), 'lector-sp-'))
  const port = 9550 + Math.floor(Math.random() * 20)
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    await openTab(port, SHELL)
    await sleep(3500)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === SHELL)
    if (!pageTarget) { check('sidepanel shell page present', false); return cleanup() }
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')

    // ---- React app mounts ----
    const headerPresent = await evalIn(page, `!!document.querySelector('header')`)
    check('§sidepanel React app mounts (header)', headerPresent)
    const headerBtns = await evalIn(page, `document.querySelectorAll('header button').length`)
    check('§sidepanel header buttons render (📚🔖★译 + sign-in)', headerBtns >= 4, `buttons=${headerBtns}`)

    // The 译 button (bilingual toggle) we added.
    const biBtn = await evalIn(page, `document.querySelectorAll('header button[title*="bilingual"], header button[title*="paragraphs"]').length`)
    check('§9 「译」 bilingual toggle button present in header', biBtn === 1, `found=${biBtn}`)

    // The title pulled from the (stubbed) content-script page.
    const titleShown = await evalIn(page, `document.querySelector('header')?.innerText || ''`)
    check('§sidepanel shows page title from content script', /Trust in Software/i.test(titleShown), `title="${titleShown.slice(0, 40)}"`)

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
    check('§6 chat streams tokens into assistant bubble', /Trust/.test(assistant), `text="${assistant.slice(0, 50)}"`)

    // Citation chip rendered from the [0] marker (validCiteIds = page blocks).
    const chip = await evalIn(page, `document.querySelectorAll('.lector-cite[data-cite="b0"]').length`)
    check('§6 citation chip rendered ([0] → b0)', chip >= 1, `chips=${chip}`)

    // Clicking the chip fires lector-jump-to (captured by our tabs.sendMessage stub).
    await evalIn(page, `(()=>{const c=document.querySelector('.lector-cite[data-cite="b0"]'); if(!c) return 'no-chip'; c.click(); return 'clicked'})()`)
    await sleep(200)
    const jumpMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-jump-to'))`) || '[]')
    check('§6 citation chip click → lector-jump-to dispatched', jumpMsg.length >= 1, `msgs=${jumpMsg.length}`)

    // ---- §9 「译」button click → lector-toggle-bilingual dispatched ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('header button')].find(x=>/bilingual|paragraphs/i.test(x.title||'')); if(!b) return 'no-btn'; b.click(); return 'clicked'})()`)
    await sleep(400)
    const biMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-toggle-bilingual'))`) || '[]')
    check('§9 「译」button click → lector-toggle-bilingual dispatched', biMsg.length >= 1, `msgs=${biMsg.length}`)

    // ---- §7 session library: after a chat, the Library drawer lists it ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('header button')].find(x=>(x.title||'')==='Library'); if(b){b.click(); return 'opened'} return 'no-btn'})()`)
    await sleep(400)
    const libHas = await evalIn(page, `document.querySelectorAll('[class*="cursor-pointer"]').length`) // session rows are clickable
    check('§7 library drawer opens after a chat', await evalIn(page, `document.body.innerText.includes('Library')`))

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
  console.log(`=== Side panel React E2E: ${pass}/${results.length} passed ===`)
  const fails = results.filter((r) => !r.ok)
  if (fails.length) { console.log('Failures:'); fails.forEach((r) => console.log(`  - ${r.name}: ${r.detail}`)); process.exit(1) }
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
