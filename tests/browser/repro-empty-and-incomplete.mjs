// Reproduction of the user-reported regressions AFTER the English→English fix:
//   1. "空响应" (empty response) — some chunks rendered as "(空响应)".
//   2. "翻译不全" (incomplete translation) — long chunks got truncated
//      mid-sentence because the per-chunk maxTokens was capped at 1000.
//
// What this script simulates:
//   - A model that returns EMPTY for short identifier-like blocks (a <td> with
//     just "—", or a heading that is a lone term). The fix should render the
//     SOURCE text, never "(空响应)".
//   - A model that would need >1000 tokens to translate a long block. We
//     verify the requested maxTokens for a long chunk is now large enough to
//     fit a full translation (>= MAX_BLOCK_LEN budget), so the provider does
//     not truncate.
//
// Run: node tests/browser/repro-empty-and-incomplete.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CONTENT_SRC = (await import('node:fs')).readFileSync(resolve(DIST, 'content.js'), 'utf8')

const check = (name, ok, detail = '') => console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)

// A page with: (a) a long paragraph that needs a big token budget to translate
// fully, and (b) table cells whose content the model returns EMPTY for (a lone
// URL/identifier the model deems "nothing to translate"). These cells MUST be
// ≥3 chars to survive the MIN_BLOCK_LEN filter and reach translateOneChunk,
// where the empty-output path used to render "(空响应)".
const FIXTURE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Doc</title></head>
<body><main><article>
<h1>API Reference</h1>
<p>${'This sentence discusses software engineering best practices in detail. '.repeat(40)}Finally it concludes.</p>
<table><tbody>
<tr><td>apiKey</td><td>https://api.example.com</td><td>Your secret key.</td></tr>
</tbody></table>
</article></main></body></html>`

function startServer() {
  const srv = http.createServer((req, res) =>
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(FIXTURE)
  )
  return new Promise((r) => srv.listen(8791, () => r(srv)))
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

const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
window.__fetchBodies = [];

window.__sse = (text) => {
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

  const user = (body && body.messages && body.messages[1] && body.messages[1].content) || '';
  const maxTokens = (body && body.max_tokens) || 0;

  // BUG-MODEL behavior:
  //  - For sources the model deems "nothing to translate" (URLs, lone
  //    identifiers, very short tokens), it returns EMPTY. This is the
  //    real-world cause of the "(空响应)" gap users saw.
  //  - Otherwise return a plausible Chinese translation.
  const trimmed = user.trim();
  // "Nothing to translate" heuristics without regex (regex in a templated eval
  // string is an escaping nightmare): starts with http/www, OR is very short.
  const looksUntranslatable = trimmed.toLowerCase().indexOf('http') === 0 || trimmed.toLowerCase().indexOf('www.') === 0 || trimmed.length <= 3;
  const out = looksUntranslatable ? '' : ('【译文】' + trimmed.slice(0, 30) + ' 的中文翻译。');
  return Promise.resolve({
    ok: true, status: 200,
    body: window.__sse(out),
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
  const URL_ = 'http://localhost:8791/doc.html'
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-empty-'))
  const port = 9580
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    await openTab(port, URL_)
    await sleep(1500)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === URL_)
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')
    await evalIn(page, CHROME_STUB)
    await cdpCall(page, 'Runtime.evaluate', { expression: CONTENT_SRC, awaitPromise: false, returnByValue: true })
    await sleep(500)

    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(3500)

    const bodies = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchBodies||[]).filter(b=>b&&b.messages))`) || '[]')

    // (1) 翻译不全 fix: the longest chunk's max_tokens must be >= 2000 so a full
    //     translation of a ~2000-char block is not truncated.
    const longBody = bodies
      .map((b) => ({ len: (b.messages[1].content || '').length, max: b.max_tokens || 0 }))
      .sort((a, b) => b.len - a.len)[0]
    check('long-chunk max_tokens >= 2000 (no truncation of 翻译)', longBody && longBody.max >= 2000, `chunkLen=${longBody?.len} max_tokens=${longBody?.max}`)

    // (2) 空响应 fix: NO .lector-bilingual block should render the "(空响应)"
    //     placeholder. (The em-dash cell will get an empty model response;
    //     the fix falls back to the source instead of the placeholder.)
    const biTexts = JSON.parse(await evalIn(page, `JSON.stringify([...document.querySelectorAll('.lector-bilingual')].map(b=>b.textContent.replace(/Retry|Copy translation/g,'').trim()))`) || '[]')
    const emptyPlaceholders = biTexts.filter((t) => /空响应|empty response/i.test(t))
    check('no "(空响应)" placeholder rendered on any block', emptyPlaceholders.length === 0, `offenders=${JSON.stringify(emptyPlaceholders)}`)

    // (3) Sanity: blocks were injected and at least one has Chinese.
    const hosts = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const hasChinese = biTexts.some((t) => /[\u4e00-\u9fff]/.test(t))
    check('bilingual blocks injected', hosts > 0, `hosts=${hosts}`)
    check('at least one block has Chinese', hasChinese, `samples=${JSON.stringify(biTexts.slice(0,3))}`)

    // (4) The URL cell's source was preserved (not blanked) — the empty-output
    //     fallback should render the source text rather than nothing.
    const urlPreserved = biTexts.some((t) => /api\.example\.com/.test(t))
    check('URL cell source preserved on empty model output', urlPreserved, `biTexts=${JSON.stringify(biTexts)}`)
  } finally {
    try { server.close() } catch {}
    try { proc.kill('SIGTERM') } catch {}
    try { proc.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('repro error:', e); process.exit(1) })
