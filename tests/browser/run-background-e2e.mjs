// Real browser E2E for the Lector AI BACKGROUND service worker (BYOK).
//
// Loads the REAL production dist/background.js into a page's main world with a
// chrome.* stub that records context-menu registrations, side-panel opens,
// storage writes, and message relays. window.fetch is stubbed to an OpenAI-
// shaped SSE stream so the BYOK save-word translation path (handleSaveWordRelay
// → completeOnce) runs end-to-end. We then fire contextMenus.onClicked and
// runtime.onMessage events and assert the real handler reaches the provider and
// writes the translated entry to chrome.storage.local.
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

// Serve dist/ (for background.js + the byok chunk ESM imports) + a shell that
// installs the chrome.* stub and loads background.js as an ES module.
function startServer() {
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }
  return http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    if (u === '/' || u === '/shell.html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
window.__menuItems = [];
window.__removedAll = false;
window.__ctxClickHandlers = [];
window.__cmdHandlers = [];
window.__onMessageListener = null;
window.__panelOpens = [];
window.__storageLocal = {};
window.__bgFetchCalls = [];

// Native OpenAI Responses stream so completeOnce → streamChat parses tokens.
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
const origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  try { window.__bgFetchCalls.push(typeof input === 'string' ? input : input.url); } catch {}
  // Official OpenAI calls use {baseUrl}/responses.
  return Promise.resolve({ ok: true, status: 200, body: sse(['[译文] hello']) });
};

window.chrome = {
  runtime: {
    lastError: null, id: 'testbg',
    onInstalled: { addListener(fn){ window.__onInstalled = fn; } },
    onMessage: { addListener(fn){ window.__onMessageListener = fn; } },
    // background uses sendMessage only incidentally; return resolved promise.
    sendMessage: () => Promise.resolve({}),
  },
  contextMenus: {
    create(item){ window.__menuItems.push(item); },
    removeAll(cb){ window.__removedAll = true; cb && cb(); },
    onClicked: { addListener(fn){ window.__ctxClickHandlers.push(fn); } },
  },
  commands: { onCommand: { addListener(fn){ window.__cmdHandlers.push(fn); } } },
  sidePanel: {
    setPanelBehavior(){ return Promise.resolve(); },
    open(opts){ window.__panelOpens.push(opts); return Promise.resolve(); },
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        const want = Array.isArray(keys) ? keys : [keys];
        for (const k of want) if (k in window.__storageLocal) out[k] = window.__storageLocal[k];
        // getSettings() reads lector_byok_settings — return a configured BYOK
        // so handleSaveWordRelay's translation path runs.
        if (want.includes('lector_byok_settings')) out.lector_byok_settings = { provider:'openai', apiKey:'sk-test-bg', model:'gpt-4o-mini', baseUrl:'', locale:'auto' };
        cb && cb(out);
        return Promise.resolve(out);
      },
      set: (obj, cb) => { Object.assign(window.__storageLocal, obj); cb && cb(); return Promise.resolve(); },
    },
  },
  tabs: {
    query: (_, cb) => { const t = [{ id: 1, windowId: 1 }]; cb && cb(t); return Promise.resolve(t); },
    sendMessage: () => {},
  },
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
  const server = startServer()
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
  // Kill the detached Chrome + drop the temp profile on Ctrl-C / SIGTERM too —
  // the normal cleanup() only runs when main() completes, so an interrupted
  // run would otherwise leak a headless Chrome process group.
  process.on('SIGINT', () => { void cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { void cleanup(); process.exit(143) })
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
    check('real dist/background.js loads as ES module (stub wired)', await evalIn(page, `typeof window.__onInstalled !== 'undefined'`))

    // Fire onInstalled so the script registers its context menus. setupMenus is
    // async (reads settings, then removeAll + create); wait for the creates.
    await evalIn(page, `(()=>{ if(window.__onInstalled) window.__onInstalled(); return 'fired' })()`)
    await sleep(500)
    const menuIds = JSON.parse(await evalIn(page, `JSON.stringify(window.__menuItems.map(i=>i.id))`) || '[]')
    check('§8 context menus registered (lector-summarize/translate/explain/ask)', menuIds.length === 4 && menuIds.includes('lector-summarize') && menuIds.includes('lector-translate') && menuIds.includes('lector-explain') && menuIds.includes('lector-ask'), `ids=${JSON.stringify(menuIds)}`)
    check('§8 menus removeAll ran before create', await evalIn(page, `window.__removedAll === true`))

    // ---- context-menu click → openSidePanel({kind, text}) → sidePanel.open ----
    await evalIn(page, `(()=>{ const fn = window.__ctxClickHandlers[0]; if(!fn) return 'no-handler'; fn({ menuItemId: 'lector-summarize', selectionText: 'Some text.' }); return 'clicked' })()`)
    await sleep(400)
    const panelOpens = JSON.parse(await evalIn(page, `JSON.stringify(window.__panelOpens)`) || '[]')
    check('§8 summarize menu → sidePanel.open({windowId})', panelOpens.length >= 1, `opens=${panelOpens.length}`)
    const seedSet = JSON.parse(await evalIn(page, `JSON.stringify(window.__storageLocal.lectorSeed || null)`) || 'null')
    check('§8 summarize menu seeds side panel (kind=summarize)', !!seedSet && seedSet.kind === 'summarize' && /Some text/.test(seedSet.text), `seed=${JSON.stringify(seedSet).slice(0, 50)}`)

    // ---- runtime.onMessage: lector-highlight relay → storage.local write ----
    await evalIn(page, `(()=>{ const fn = window.__onMessageListener; if(!fn) return 'no-listener'; fn({ action:'lector-highlight', highlight:{ id:'h1', text:'hi', url:'http://x', title:'T', createdAt:1 } }, {}, ()=>{}); return 'sent' })()`)
    await sleep(300)
    const hlStored = JSON.parse(await evalIn(page, `JSON.stringify(window.__storageLocal.lectorHighlights || [])`) || '[]')
    check('§relay lector-highlight → storage.local.lectorHighlights', hlStored.length >= 1 && hlStored[0].id === 'h1', `stored=${hlStored.length}`)

    // ---- runtime.onMessage: lector-save-word → BYOK translate → storage write ----
    await evalIn(page, `(()=>{ const fn = window.__onMessageListener; if(!fn) return 'no-listener'; fn({ action:'lector-save-word', word:'hello', context:'hello world', url:'http://x', title:'T' }, {}, ()=>{}); return 'sent' })()`)
    // handleSaveWordRelay awaits a BYOK translate round-trip; wait for it.
    await sleep(1200)
    const vocabStored = JSON.parse(await evalIn(page, `JSON.stringify(window.__storageLocal.lectorVocab || [])`) || '[]')
    check('§relay lector-save-word → storage.local.lectorVocab (BYOK-translated)', vocabStored.length >= 1 && vocabStored[0].word === 'hello' && !!vocabStored[0].translation, `word="${vocabStored[0]?.word}" translation="${vocabStored[0]?.translation}"`)
    const bgFetches = JSON.parse(await evalIn(page, `JSON.stringify(window.__bgFetchCalls.filter(u=>u.endsWith('/responses')))`) || '[]')
    check('§relay save-word translation hit provider /responses (BYOK)', bgFetches.length >= 1, `calls=${bgFetches.length}`)

    // ---- keyboard command handler registered (forwards to content script) ----
    check('§5 keyboard command handler registered (commands.onCommand)', (await evalIn(page, `window.__cmdHandlers.length`)) >= 1)

    await cleanup()
  } catch (e) {
    console.error('E2E error:', e.stack || e.message)
    // Never let an exception truncate the suite and still report success —
    // mark it failed explicitly (mirrors run-browser-e2e.mjs).
    check('background E2E completed without uncaught error', false, e instanceof Error ? e.message : String(e))
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
