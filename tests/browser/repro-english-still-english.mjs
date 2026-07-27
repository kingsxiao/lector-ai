// Reproduction of the user-reported bug:
//   "整页翻译：英文翻译了之后还是英文"
//   (whole-page translation: English stays English after translating)
//
// Root cause hypothesis: even when the system prompt correctly says "translate
// to Chinese", some models ECHO the English source verbatim on ambiguous /
// short / markup-heavy / code-laden blocks. The fix is two-layered:
//   1. A stronger system prompt that HARD-requires output in the target
//      language and scopes "leave untranslated" to actual code/URLs only.
//   2. A runtime guard (isTranslationLikelyUnchanged) that detects when the
//      model echoed the source and retries ONCE with a forceful "you must
//      translate" prefix.
//
// This script simulates a model that echoes the source on the FIRST call but
// translates on the second (forced-retry) call, and asserts:
//   - the FIRST request body's system prompt hard-requires Chinese,
//   - the forced retry fires (2nd fetch to the same chunk),
//   - the final rendered text is NOT identical to the source (translation
//     actually happened).

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
  return new Promise((r) => srv.listen(8790, () => r(srv)))
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

// The simulated model: the FIRST call for a given user-message echoes the
// source verbatim (the bug). The SECOND call (forced retry) returns Chinese.
// We key off the request body's system-prompt prefix to distinguish them: the
// retry's system prompt contains "IMPORTANT: The previous response".

const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
window.__fetchBodies = [];

window.__sseText = (text) => {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\\n\\n'));
      c.enqueue(enc.encode('data: [DONE]\\n\\n'));
      c.close();
    },
  });
};

window.fetch = (url, opts) => {
  window.__fetchCalls.push(url);
  let body = null;
  try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
  window.__fetchBodies.push(body);

  const sys = (body && body.messages && body.messages[0] && body.messages[0].content) || '';
  const user = (body && body.messages && body.messages[1] && body.messages[1].content) || '';
  const isRetry = /IMPORTANT: The previous response/i.test(sys);

  // BUG MODEL: first call echoes source verbatim; retry call translates.
  const out = isRetry ? ('【译文】' + user.slice(0, 20) + ' 的中文翻译。') : user;
  return Promise.resolve({
    ok: true, status: 200,
    body: window.__sseText(out),
    headers: { get: () => 'text/event-stream' },
    json: () => Promise.resolve({ data: [{ id: 'm' }] }),
    text: () => Promise.resolve(''),
  });
};

window.chrome = {
  runtime: {
    sendMessage: (msg) => { window.__lectorMsgs.push(msg); return Promise.resolve({}); },
    lastError: null,
    onMessage: { addListener(fn) { window.__lectorMsgHandlers.onMessage = fn; } },
  },
  storage: {
    local: {
      get: (_keys, cb) => cb && cb({
        lector_byok_settings: {
          provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', baseUrl: '', locale: 'zh',
          translation: { targetLanguage: 'auto', displayMode: 'bilingual', autoTranslate: false, concurrency: 2 },
        }, lectorGlossary: [],
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
  const ARTICLE = 'http://localhost:8790/article.html'
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-eng-repro-'))
  const port = 9570
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

    // Capture the source text of the first article paragraph (before translate).
    const srcBefore = await evalIn(page, `document.querySelector('article p').textContent.trim()`)
    console.log(`source (before): "${srcBefore.slice(0, 60)}..."`)

    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    // Wait for translation to settle (concurrency=2, ~4 paragraphs, with one
    // retry each → a handful of round trips).
    await sleep(3000)

    // Sanity: no genuine provider errors should have fired (the stub is healthy).
    const errMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-bilingual-error'))`) || '[]')
    check('no genuine provider errors (stub healthy)', errMsgs.length === 0, `msgs=${JSON.stringify(errMsgs)}`)

    const fetchCount = await evalIn(page, `(window.__fetchCalls||[]).filter(u=>String(u).endsWith('/chat/completions')).length`)
    const bodies = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchBodies||[]).filter(b=>b&&b.messages))`) || '[]')

    // (1) The base system prompt HARD-requires output in the target language.
    const baseSys = (bodies[0] && bodies[0].messages[0] && bodies[0].messages[0].content) || ''
    check('base system prompt names the target language (Chinese)', /chinese/i.test(baseSys), `sys="${baseSys.slice(0, 70)}"`)
    check('base system prompt hard-requires target-language output', /must/i.test(baseSys), `sys="${baseSys.slice(0, 70)}"`)

    // (2) At least one forced-retry request fired (the safety net kicked in).
    const retryCount = bodies.filter((b) => /IMPORTANT: The previous response/i.test(b.messages[0].content || '')).length
    check('forced retry fired for echoed chunks (>0 retries)', retryCount > 0, `retries=${retryCount} of ${bodies.length} requests`)

    // (3) Final rendered translation is NOT identical to the source for the
    //     first block (the bug would leave English text under the paragraph).
    const hosts = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const firstBiText = await evalIn(page, `(() => { const b = document.querySelector('.lector-bilingual-host .lector-bilingual'); return b ? b.textContent.replace(/Retry|Copy translation/g,'').trim() : ''; })()`)
    const unchanged = firstBiText.length > 0 && firstBiText.replace(/\s+/g, ' ').trim() === srcBefore.replace(/\s+/g, ' ').trim()
    check('bilingual blocks were injected', hosts > 0, `hosts=${hosts}`)
    check('final rendered translation differs from source (NOT English→English)', !unchanged && firstBiText.length > 0, `bi="${firstBiText.slice(0, 50)}"`)
    check('final rendered text contains Chinese', /[\u4e00-\u9fff]/.test(firstBiText), `bi="${firstBiText.slice(0, 50)}"`)

    console.log(`\ntotal chat/completions requests: ${fetchCount} (echo + forced retry per block)`)
  } finally {
    try { server.close() } catch {}
    try { proc.kill('SIGTERM') } catch {}
    try { proc.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('repro error:', e); process.exit(1) })
