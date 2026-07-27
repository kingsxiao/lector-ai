// Minimal reproduction: does bilingual translation render INCREMENTALLY when
// SSE tokens arrive in separate chunks (real-network behavior), or only at the
// very end?
//
// Hypothesis under test: with chunked/delayed SSE, the per-chunk DOM update in
// translateOneBlock's onToken DOES populate .lector-bilingual incrementally.
// If it does, the "nothing renders" user symptom is caused by something else
// (display mode / visibility). If it does NOT, the bug is in the render path.
//
// Run: node tests/browser/repro-streaming-display.mjs

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

const check = (name, ok, detail = '') => console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)

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
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300))
  return r.result.value
}
const getTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
const openTab = async (port, url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json())

// KEY DIFFERENCE from the passing E2E: this SSE stream emits tokens with
// real async delays between frames, mirroring how a live provider streams.
const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
window.__bilingualProgress = [];

// Emits tokens one per macrotask, with a delay, so the reader sees multiple
// separate .read() values (true streaming), not a single buffered flush.
function sseStreamChunked(tokens, delayMs) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const t of tokens) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\\n\\n'));
        await new Promise(r => setTimeout(r, delayMs));
      }
      controller.enqueue(enc.encode('data: [DONE]\\n\\n'));
      controller.close();
    }
  });
}

window.fetch = (url, opts) => {
  window.__fetchCalls.push(url);
  // Different per-call token text so we can see which block it is.
  const n = window.__fetchCalls.length;
  const tokens = ['[译' + n + '] ', '这是', '一个', '延迟', '流式', '测试', '。'];
  return Promise.resolve({
    ok: true,
    status: 200,
    body: sseStreamChunked(tokens, 40),
    headers: { get: () => 'text/event-stream' },
    json: () => Promise.resolve({ data: [{ id: 'm' }] }),
    text: () => Promise.resolve(''),
  });
};

window.chrome = {
  runtime: {
    sendMessage: (msg) => {
      window.__lectorMsgs.push(msg);
      if (msg && msg.action === 'lector-bilingual-progress') window.__bilingualProgress.push(msg);
      return Promise.resolve({});
    },
    lastError: null,
    onMessage: { addListener(fn) { window.__lectorMsgHandlers.onMessage = fn; } },
  },
  storage: {
    local: {
      get: (_keys, cb) => cb && cb({
        lector_byok_settings: {
          provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', baseUrl: '', locale: 'zh',
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

const fireContentMessage = (ws, msg) => evalIn(ws, `(() => { const h = window.__lectorMsgHandlers.onMessage; if (!h) return 'no-handler'; let resp; h(${JSON.stringify(msg)}, {}, (r) => { resp = r }); return JSON.stringify(resp); })()`)

async function main() {
  const server = await startServer()
  const ARTICLE = 'http://localhost:8788/article.html'
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-repro-'))
  const port = 9560
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    await openTab(port, ARTICLE)
    await sleep(1500)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === ARTICLE)
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')
    await evalIn(page, CHROME_STUB)
    await cdpCall(page, 'Runtime.evaluate', { expression: CONTENT_SRC, awaitPromise: false, returnByValue: true })
    await sleep(500)

    // Count candidate translatable paragraphs before triggering.
    const beforeCount = await evalIn(page, `document.querySelectorAll('article p').length`)
    console.log(`candidate <p> blocks: ${beforeCount}`)
    const bodyClass = await evalIn(page, `document.body.className`)
    console.log(`initial body.className: "${bodyClass}"`)

    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })

    // Snapshot the FIRST bilingual block's textContent over time to see if it
    // grows incrementally (streaming) or jumps from empty→full at the end.
    const samples = []
    for (let i = 0; i < 25; i++) {
      await sleep(60)
      const snap = await evalIn(page, `(() => {
        const blocks = [...document.querySelectorAll('.lector-bilingual')];
        if (blocks.length === 0) return JSON.stringify({ count: 0 });
        const b = blocks[0];
        const cs = getComputedStyle(b);
        return JSON.stringify({
          count: blocks.length,
          first: (b.textContent || '').slice(0, 30),
          firstLen: (b.textContent || '').length,
          isLoading: b.classList.contains('is-loading'),
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          rectW: b.getBoundingClientRect().width,
          rectH: b.getBoundingClientRect().height,
          bodyClass: document.body.className,
        });
      })()`)
      samples.push({ t: i, ...(JSON.parse(snap)) })
    }

    // Print the timeline compactly.
    console.log('\n=== incremental render timeline (first .lector-bilingual) ===')
    for (const s of samples) {
      if (s.count === 0) { console.log(`t=${String(s.t).padStart(2)}  (no blocks yet)`); continue }
      console.log(`t=${String(s.t).padStart(2)}  count=${s.count}  firstLen=${String(s.firstLen).padStart(3)}  loading=${s.isLoading}  display=${s.display}  vis=${s.visibility}  opacity=${s.opacity}  rect=${Math.round(s.rectW)}x${Math.round(s.rectH)}  bodyClass=${JSON.stringify(s.bodyClass)}  text="${s.first}"`)
    }

    const final = samples[samples.length - 1]
    console.log('\n=== verdict ===')
    check('bilingual blocks were injected', (final.count || 0) > 0, `count=${final.count}`)
    if (final.count) {
      check('translation text is non-empty (stream delivered)', final.firstLen > 0, `len=${final.firstLen}`)
      check('block is rendered visible (display!=none)', final.display !== 'none', `display=${final.display}`)
      check('block has non-zero size', final.rectW > 0 && final.rectH > 0, `${Math.round(final.rectW)}x${Math.round(final.rectH)}`)
      // Did text grow over time? (incremental streaming)
      const lens = samples.filter(s => s.count).map(s => s.firstLen)
      const grew = lens.length >= 2 && lens[lens.length - 1] > lens[0]
      check('textContent grew incrementally (streaming render)', grew, `lens=${JSON.stringify(lens)}`)
      check('body has lector-dm-bilingual class', (final.bodyClass || '').includes('lector-dm-bilingual'), `bodyClass=${final.bodyClass}`)
      const progressCount = await evalIn(page, `(window.__bilingualProgress||[]).length`)
      check('progress messages sent', progressCount > 0, `count=${progressCount}`)
    }

  } finally {
    try { server.close() } catch {}
    try { proc.kill('SIGTERM') } catch {}
    try { proc.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('repro error:', e); process.exit(1) })
