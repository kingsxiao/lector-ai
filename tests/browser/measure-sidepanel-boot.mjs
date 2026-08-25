// Measure side-panel first-open timing against the REAL production bundle.
//
// Modern Chrome removed --load-extension, so (like the other E2E harnesses) we
// serve dist/ over http and stub chrome.* via CDP BEFORE any script runs. The
// page that boots is the REAL built sidepanel/index.html (boot shell + module
// script /sidepanel.js), with an empty storage — the first-install condition.
//
// For each of N cold runs we spawn a FRESH Chrome + temp profile (first open
// ever), navigate once, and record: bundle responseEnd, DCL, FCP (shell paint),
// React first commit (boot shell replaced), and long tasks during boot.
// A final reload in the same tab gives the warm comparison.
//
// Run: node tests/browser/measure-sidepanel-boot.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const COLD_RUNS = Number(process.env.COLD_RUNS || 3)

const STUB = `
window.chrome = {
  runtime: {
    lastError: null,
    id: 'testextid',
    getURL: (p) => '/' + String(p).replace(/^\\//, ''),
    onMessage: { addListener() {}, removeListener() {} },
    sendMessage: () => Promise.resolve({}),
  },
  storage: {
    local: {
      get: (_keys, cb) => { const out = {}; if (cb) cb(out); return Promise.resolve(out) },
      set: (_o, cb) => { if (cb) cb(); return Promise.resolve() },
      remove: (_k, cb) => { if (cb) cb(); return Promise.resolve() },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  tabs: {
    query: (_q, cb) => { const t = []; if (cb) cb(t); return Promise.resolve(t) },
    sendMessage: (_id, _msg, cb) => { if (cb) cb(undefined); return Promise.resolve({}) },
  },
  sidePanel: { open: () => Promise.resolve() },
}
`

const PROBE = `
window.__boot = { longTasks: [] }
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) window.__boot.longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })
}).observe({ entryTypes: ['longtask'] })
function armRootWatch() {
  const root = document.getElementById('root')
  if (!root) return
  new MutationObserver(() => {
    if (!window.__boot.reactCommit && !document.querySelector('.lector-boot')) {
      window.__boot.reactCommit = Math.round(performance.now())
      window.__boot.rootChildren = root.children.length
    }
  }).observe(root, { childList: true })
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armRootWatch)
else armRootWatch()
'done'
`

const READ_METRICS = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
  const js = performance.getEntriesByType('resource').find((r) => r.name.endsWith('sidepanel.js'))
  return JSON.stringify({
    url: location.pathname,
    bundleResponseEndMs: js ? Math.round(js.responseEnd) : null,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadEventEndMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    reactCommitMs: window.__boot?.reactCommit ?? null,
    rootChildren: window.__boot?.rootChildren ?? null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    longTasks: (window.__boot?.longTasks || []).slice(0, 10),
  })
})()`

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' }
// DELAY_CSS_MS deliberately stalls the render-blocking stylesheet to reproduce
// the "white side panel until all resources load" failure mode (Chromium
// paints the panel only after render-blocking resources finish).
const DELAY_CSS_MS = Number(process.env.DELAY_CSS_MS || 0)
function startServer() {
  return http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    let filePath
    try { filePath = resolve(DIST, '.' + u) } catch { return res.writeHead(404).end() }
    const delay = DELAY_CSS_MS && filePath.endsWith('.css') ? DELAY_CSS_MS : 0
    setTimeout(() => {
      try {
        const data = readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': mime[filePath.slice(filePath.lastIndexOf('.'))] || 'application/octet-stream' }).end(data)
      } catch {
        res.writeHead(404).end('not found')
      }
    }, delay)
  })
}

let seq = 0
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  const h = (d) => {
    const m = JSON.parse(d)
    if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result) }
  }
  ws.on('message', h)
  ws.send(JSON.stringify({ id, method, params }))
})

async function readMetrics(ws) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression: READ_METRICS, returnByValue: true })
  return JSON.parse(r.result.value)
}

async function waitForCommit(ws, timeoutMs) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await readMetrics(ws)
    if (last.reactCommitMs != null) return last
    await sleep(120)
  }
  return last
}

function fmt(m) {
  if (!m) return '  (no metrics)'
  const s = `bundle=${m.bundleResponseEndMs}ms dcl=${m.domContentLoadedMs}ms fcp=${m.fcpMs}ms load=${m.loadEventEndMs}ms REACT_COMMIT=${m.reactCommitMs}ms (root children: ${m.rootChildren}, body bg: ${m.bodyBg})`
  const lt = m.longTasks?.length ? '\n    longTasks(start,dur): ' + m.longTasks.map((t) => `${t.start}+${t.dur}`).join(', ') : ''
  return '  ' + s + lt
}

async function main() {
  const server = startServer()
  const port = 8795
  await new Promise((r) => server.listen(port, r))
  const url = `http://127.0.0.1:${port}/sidepanel/index.html`
  console.log(`measuring ${url} (${COLD_RUNS} cold runs, fresh profile each)`)

  for (let run = 1; run <= COLD_RUNS; run++) {
    const profile = mkdtempSync(resolve(tmpdir(), 'lector-measure-'))
    const dbgPort = 9580 + Math.floor(Math.random() * 40)
    const proc = spawn(CHROME, [
      `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
      '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${dbgPort}`, 'about:blank',
    ], { stdio: 'ignore', detached: true })
    try {
      for (let i = 0; i < 80; i++) {
        try { if ((await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).ok) break } catch {}
        if (i === 79) throw new Error('Chrome did not start')
        await sleep(250)
      }
      await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' })
      await sleep(500)
      const targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith('about:'))
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
      const errors = []
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString())
        if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 160))
      })
      await cdpCall(ws, 'Runtime.enable')
      await cdpCall(ws, 'Page.enable')
      await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: STUB + PROBE })

      console.log(`\n=== run ${run}: COLD (first ever open in this profile) ===`)
      await cdpCall(ws, 'Page.navigate', { url })
      console.log(fmt(await waitForCommit(ws, 20000)))
      for (const e of errors) console.log('  exception:', e)

      if (run === COLD_RUNS) {
        console.log('\n=== WARM (reload same tab) ===')
        await cdpCall(ws, 'Page.reload', { ignoreCache: false })
        console.log(fmt(await waitForCommit(ws, 20000)))
      }
      ws.close()
    } finally {
      try { process.kill(-proc.pid, 'SIGTERM') } catch {}
    }
  }
  server.close()
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
