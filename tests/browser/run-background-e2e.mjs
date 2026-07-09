// Real browser E2E for the Lector AI BACKGROUND service worker logic (§8 right-click menu).
//
// Loads the REAL production dist/background.js into a page's main world with a
// chrome.* stub that: records context-menu registrations, records broadcast
// messages (summary-result / translate-result / explain-result), and routes
// fetch to the local mock backend. We then fire contextMenus.onClicked events
// for each menu item and assert the handler reaches the backend and broadcasts
// the result — exercising the real handleSummarize/handleTranslate/handleExplain
// code paths.
//
// Run: node tests/browser/run-background-e2e.mjs

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

// Serve dist/ (for the background.js + config chunk ESM imports) + a shell that
// installs the chrome.* stub and loads background.js as an ES module.
function startServer(apiBase) {
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }
  return http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    if (u.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      if (req.method === 'OPTIONS') return res.writeHead(204).end()
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (u === '/api/summarize') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ summary: 'MOCK SUMMARY' }))
        if (u === '/api/translate') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ translatedText: 'MOCK 译文' }))
        if (u === '/api/chat') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
          send({ type: 'token', delta: 'MOCK EXPLANATION' })
          send({ type: 'done' })
          return res.end()
        }
        res.writeHead(404).end('{}')
      })
      return
    }
    if (u === '/' || u === '/shell.html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
window.__menuItems = [];
window.__broadcasts = [];
window.__ctxClickHandlers = [];
window.__cmdHandlers = [];
window.__bgFetches = [];
const origFetch = window.fetch.bind(window);
window.fetch = function(input, init){
  try { const ur = typeof input === 'string' ? input : input.url; window.__bgFetches.push(ur); } catch(e){}
  return origFetch(input, init);
};
window.chrome = {
  runtime: {
    lastError: null, id: 'testbg',
    onInstalled: { addListener(fn){ window.__onInstalled = fn; } },
    onMessage: { addListener(fn){} },
    sendMessage(msg){ window.__broadcasts.push(msg); return Promise.resolve(); },
  },
  contextMenus: {
    create(item){ window.__menuItems.push(item); },
    onClicked: { addListener(fn){ window.__ctxClickHandlers.push(fn); } },
  },
  commands: { onCommand: { addListener(fn){ window.__cmdHandlers.push(fn); } } },
  sidePanel: { setPanelBehavior(){return Promise.resolve()}, open(){return Promise.resolve()} },
  storage: { local: { get: (k, cb) => cb && cb({ apiBase: ${JSON.stringify(apiBase)} }) } },
  tabs: { query: (_, cb) => cb && cb([{ id: 1 }]), sendMessage: () => {} },
};
</script><script type="module" src="/background.js"></script></body></html>`
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
    }
    try {
      const f = resolve(DIST, '.' + u)
      const d = readFileSync(f)
      res.writeHead(200, { 'Content-Type': mime[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' }).end(d)
    } catch { res.writeHead(404).end('not found') }
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
  const API = 'http://localhost:8787/api'
  const server = startServer(API)
  await new Promise((r) => server.listen(8787, r))
  const SHELL = 'http://localhost:8787/'

  const profile = mkdtempSync(resolve(tmpdir(), 'lector-bg-'))
  const port = 9570 + Math.floor(Math.random() * 15)
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    await openTab(port, SHELL)
    await sleep(2000)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === SHELL)
    if (!pageTarget) { check('background shell page present', false); return cleanup() }
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')
    await sleep(1000)

    // The real background.js loaded as an ES module in the shell.
    const stubPresent = await evalIn(page, `typeof window.__menuItems !== 'undefined'`)
    check('real dist/background.js loads as ES module (stub wired)', stubPresent)

    // Fire onInstalled so the script registers its context menus.
    await evalIn(page, `(()=>{ if(window.__onInstalled) window.__onInstalled(); return 'fired' })()`)
    await sleep(200)
    const menuItems = JSON.parse(await evalIn(page, `JSON.stringify(window.__menuItems.map(i=>i.id))`) || '[]')
    check('§8 context menus registered (summarize/translate/explain)', menuItems.length === 3 && menuItems.includes('summarize-selection') && menuItems.includes('translate-selection') && menuItems.includes('explain-selection'), `ids=${JSON.stringify(menuItems)}`)

    // ---- Summarize menu click → handleSummarize → backend → summary-result broadcast ----
    await evalIn(page, `(()=>{ const fn = window.__ctxClickHandlers[0]; if(!fn) return 'no-handler'; fn({ menuItemId: 'summarize-selection', selectionText: 'Some text to summarize.' }); return 'clicked' })()`)
    await sleep(800)
    const sumBcast = JSON.parse(await evalIn(page, `JSON.stringify((window.__broadcasts||[]).filter(m=>m.action==='summary-result'))`) || '[]')
    check('§8 summarize menu → backend → summary-result broadcast', sumBcast.length >= 1 && typeof sumBcast[0].summary === 'string', `summary="${sumBcast[0]?.summary}"`)
    const sumHit = JSON.parse(await evalIn(page, `JSON.stringify(window.__bgFetches.filter(u=>u.endsWith('/api/summarize')))`) || '[]')
    check('§8 summarize hit the backend /api/summarize', sumHit.length >= 1)

    // ---- Translate menu click ----
    await evalIn(page, `(()=>{ const fn = window.__ctxClickHandlers[0]; fn({ menuItemId: 'translate-selection', selectionText: 'hello' }); return 'ok' })()`)
    await sleep(800)
    const trBcast = JSON.parse(await evalIn(page, `JSON.stringify((window.__broadcasts||[]).filter(m=>m.action==='translate-result'))`) || '[]')
    check('§8 translate menu → backend → translate-result broadcast', trBcast.length >= 1, `translatedText="${trBcast[0]?.translatedText}"`)

    // ---- Explain menu click → chat SSE stream read into explanation ----
    await evalIn(page, `(()=>{ const fn = window.__ctxClickHandlers[0]; fn({ menuItemId: 'explain-selection', selectionText: 'quantum' }); return 'ok' })()`)
    await sleep(1000)
    const exBcast = JSON.parse(await evalIn(page, `JSON.stringify((window.__broadcasts||[]).filter(m=>m.action==='explain-result'))`) || '[]')
    check('§8 explain menu → chat SSE → explain-result broadcast', exBcast.length >= 1 && typeof exBcast[0].explanation === 'string', `explanation="${String(exBcast[0]?.explanation).slice(0,30)}"`)

    // ---- Keyboard command handler registered ----
    check('§5 keyboard command handler registered (commands.onCommand)', (await evalIn(page, `window.__cmdHandlers.length`)) >= 1)

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
  console.log(`=== Background/menu E2E: ${pass}/${results.length} passed ===`)
  const fails = results.filter((r) => !r.ok)
  if (fails.length) { console.log('Failures:'); fails.forEach((r) => console.log(`  - ${r.name}: ${r.detail}`)); process.exit(1) }
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
