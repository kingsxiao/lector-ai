// Reproduction: which blocks get translated vs. silently skipped on a
// technical-doc / code site? The user reports "some text is not translated,
// note the API segmentation". This script reports, per candidate element:
//   tag, textRatio, length, reason for skip (or TRANSLATED).
//
// Goal: confirm that textRatio<0.6 and MAX_BLOCK_LEN=2000 are silently
// dropping technical-doc blocks (inline <code>, long sections).
//
// Run: node tests/browser/repro-tech-doc-splitting.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// A realistic technical-doc / code-site page: prose mixed with inline <code>,
// long <li> blocks, tables, code blocks in <pre><code>, and a long section.
const TECHDOC = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>API Reference</title></head>
<body><main><article>
<h1>Getting Started with the SDK</h1>

<p>To install the SDK, run <code>npm install @acme/sdk</code> in your project directory. The <code>init()</code> function accepts a <code>Config</code> object with <code>apiKey</code>, <code>baseUrl</code>, and <code>timeout</code> fields. See <a href="/docs/config">the configuration guide</a> for details.</p>

<h2>Configuration</h2>

<p>The default <code>baseUrl</code> is <code>https://api.acme.io/v1</code>. You can override it for self-hosted deployments. The timeout is in milliseconds and defaults to 30000; set it to 0 to disable timeouts entirely. Retries follow an exponential backoff with a base of 100ms.</p>

<h3>Options Reference</h3>

<ul>
  <li><code>apiKey</code> (string, required) — Your secret API key from the dashboard. Never commit this to version control; use environment variables instead.</li>
  <li><code>baseUrl</code> (string, default <code>"https://api.acme.io/v1"</code>) — Override for self-hosted or EU-region deployments.</li>
  <li><code>timeout</code> (number, default <code>30000</code>) — Request timeout in milliseconds. Set to <code>0</code> to disable.</li>
  <li><code>retries</code> (number, default <code>3</code>) — Maximum number of automatic retries on transient failures.</li>
</ul>

<table>
  <thead><tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>apiKey</code></td><td>string</td><td><code>—</code></td><td>Your secret API key. Required for all requests.</td></tr>
    <tr><td><code>baseUrl</code></td><td>string</td><td><code>https://api.acme.io/v1</code></td><td>Override the API endpoint for self-hosted deployments or regional endpoints.</td></tr>
  </tbody>
</table>

<pre><code>import { AcmeClient } from '@acme/sdk';

const client = new AcmeClient({
  apiKey: process.env.ACME_API_KEY,
  baseUrl: 'https://api.acme.io/v1',
  timeout: 30000,
});

const result = await client.resources.create({ name: 'my-resource' });
console.log(result.id);</code></pre>

<h2>Long Section: Best Practices</h2>
<p>${'This is a very long paragraph that explores best practices in detail. '.repeat(45)}When you design your integration, consider error handling, retries, idempotency keys, and observability from the start rather than bolting them on later. The SDK exposes structured error objects with a code field you can switch on, and every request returns a correlation id in the response headers that you should log for support tickets.</p>

<p>Short tip: cache the client instance; constructing it repeatedly is wasteful.</p>

</article></main></body></html>`

function startServer(body) {
  const srv = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body))
  return new Promise((r) => srv.listen(8789, () => r(srv)))
}

let msgId = 0
const openWS = async (url) => { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) }); return ws }
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => { const id = ++msgId; const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) } }; ws.on('message', h); ws.send(JSON.stringify({ id, method, params })) })
async function evalIn(ws, expression, awaitPromise = false) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400))
  return r.result.value
}
const getTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
const openTab = async (port, url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json())

const CHROME_STUB = `
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
window.__lectorMsgs = [];
window.fetch = (url) => { window.__fetchCalls.push(url); return Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c){ c.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({choices:[{delta:{content:'[译]'}}]}) + '\\n\\n')); c.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n')); c.close() } }), headers:{get:()=>null}, json:()=>Promise.resolve({}), text:()=>Promise.resolve('') }); };
window.chrome = {
  runtime: { sendMessage: (m)=>{window.__lectorMsgs.push(m); return Promise.resolve({})}, lastError:null, onMessage:{ addListener(fn){ window.__lectorMsgHandlers.onMessage=fn } } },
  storage: { local: { get:(_k,cb)=>cb&&cb({ lector_byok_settings:{ provider:'openai',apiKey:'sk',model:'gpt-4o-mini',baseUrl:'',locale:'zh', translation:{targetLanguage:'auto',displayMode:'bilingual',autoTranslate:false,concurrency:5} }, lectorGlossary:[] }), set:(_v,cb)=>cb&&cb() } },
};
'done';
`
const fireContentMessage = (ws, msg) => evalIn(ws, `(() => { const h = window.__lectorMsgHandlers.onMessage; if (!h) return 'no-handler'; let resp; h(${JSON.stringify(msg)}, {}, (r) => { resp = r }); return JSON.stringify(resp); })()`)

async function main() {
  const server = await startServer(TECHDOC)
  const URL_ = 'http://localhost:8789/techdoc.html'
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-tech-'))
  const port = 9570
  const proc = spawn(CHROME, [`--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', detached: true })

  let page
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(250) }
    await openTab(port, URL_)
    await sleep(1200)
    const targets = await getTargets(port)
    const pageTarget = targets.find((t) => t.type === 'page' && t.url === URL_)
    page = await openWS(pageTarget.webSocketDebuggerUrl)
    await cdpCall(page, 'Runtime.enable')
    await evalIn(page, CHROME_STUB)
    const src = (await import('node:fs')).readFileSync(resolve('dist/content.js'), 'utf8')
    await cdpCall(page, 'Runtime.evaluate', { expression: src, awaitPromise: false, returnByValue: true })
    await sleep(400)

    // Report on candidate blocks BEFORE translation: replicate the exact filter
    // logic the content script uses, so we can see which get dropped and why.
    const analysis = await evalIn(page, `(() => {
      const TRANSLATABLE = new Set(['P','LI','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','TD','TH','DT','DD','FIGCAPTION','SUMMARY']);
      const EXCLUDED = ['script','style','noscript','code','pre','textarea','input','select','option','button','svg','math'].join(',');
      const all = Array.from(document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary'));
      const rows = [];
      for (const el of all) {
        const text = (el.textContent || '').trim();
        const outerLen = (el.outerHTML || '').length || text.length || 1;
        const textRatio = text.length / outerLen;
        // Mirrors src/shared/translation.ts shouldTranslateBlock (post-fix):
        //   length is NOT a rejection reason (long blocks are split), and the
        //   textRatio threshold is 0.4 (relaxed from 0.6 for markup-heavy docs).
        let reason = 'TRANSLATED';
        if (!TRANSLATABLE.has(el.tagName.toUpperCase())) reason = 'tag-not-translatable';
        else if (text.length < 3) reason = 'too-short(<3)';
        else if (el.closest(EXCLUDED)) reason = 'inside-excluded('+el.closest(EXCLUDED).tagName+')';
        else if (!!el.querySelector('.lector-bilingual')) reason = 'already-translated';
        else if (textRatio < 0.4) reason = 'textRatio<0.4';
        else if (text.length > 2000) reason = 'SPLIT(long>2000)';
        rows.push({ tag: el.tagName, len: text.length, ratio: +textRatio.toFixed(2), reason, preview: text.slice(0, 50) });
      }
      return JSON.stringify(rows);
    })()`)
    const rows = JSON.parse(analysis)
    console.log('\n=== per-candidate block analysis (technical-doc fixture) ===')
    console.log('tag  len    ratio  reason              preview')
    console.log('---- -----  -----  ------------------  -------')
    for (const r of rows) {
      console.log(`${r.tag.padEnd(4)} ${String(r.len).padStart(5)}  ${String(r.ratio).padStart(5)}  ${r.reason.padEnd(18)}  ${JSON.stringify(r.preview)}`)
    }

    const counts = {}
    for (const r of rows) counts[r.reason] = (counts[r.reason] || 0) + 1
    console.log('\n=== summary ===')
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)

    // Now actually trigger translation and compare.
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(1500)
    const translated = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const fetchCalls = await evalIn(page, `(window.__fetchCalls||[]).length`)
    const totalBilingualDivs = await evalIn(page, `document.querySelectorAll('.lector-bilingual').length`)
    console.log(`\nblocks actually translated (hosts): ${translated}`)
    console.log(`.lector-bilingual divs rendered:     ${totalBilingualDivs}`)
    console.log(`API (fetch) calls made:              ${fetchCalls}`)
    console.log(`candidates total:                    ${rows.length}`)

    // The KEY new-behaviour assertion: the long (3489-char) block must now be
    // SPLIT into multiple .lector-bilingual children, not dropped.
    const longHostChildren = await evalIn(page, `(() => {
      // Find the long paragraph (the one with > 2000 chars of source text).
      const longP = [...document.querySelectorAll('.lector-bilingual-host')]
        .find(h => (h.querySelector('.lector-bi-source')?.textContent || '').length > 2000);
      if (!longP) return JSON.stringify({ found: false });
      return JSON.stringify({ found: true, sourceLen: (longP.querySelector('.lector-bi-source')?.textContent || '').length, bilingualDivs: longP.querySelectorAll('.lector-bilingual').length });
    })()`)
    const lh = JSON.parse(longHostChildren)
    console.log(`\nlong-block split check: ${lh.found ? `source ${lh.sourceLen} chars → ${lh.bilingualDivs} .lector-bilingual divs` : 'NO long block found'}`)

    // List the elements that should plausibly have been translated (have real
    // English prose) but were NOT marked as hosts.
    const untranslatedProse = await evalIn(page, `(() => {
      const out = [];
      for (const el of document.querySelectorAll('p, li, td')) {
        if (el.querySelector('.lector-bilingual')) continue;
        const t = (el.textContent || '').trim();
        if (t.length < 8) continue;
        // crude "has english words" check
        if (/[a-zA-Z]{3,}/.test(t) && !el.closest('pre,code')) out.push({ tag: el.tagName, len: t.length, preview: t.slice(0, 60) });
      }
      return JSON.stringify(out);
    })()`)
    console.log(`\n=== blocks with prose that were NOT translated ===`)
    for (const r of JSON.parse(untranslatedProse)) console.log(`  ${r.tag} (len ${r.len}): ${JSON.stringify(r.preview)}`)

  } finally {
    try { server.close() } catch {}
    try { proc.kill('SIGTERM') } catch {}
    try { proc.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('repro error:', e); process.exit(1) })
