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
// resolves. window.fetch is stubbed to an OpenAI Responses SSE stream so the BYOK
// translate / explain / bilingual paths produce real output.
const CHROME_STUB = `
window.__lectorMsgs = [];
window.__lectorMsgHandlers = {};
window.__fetchCalls = [];
window.__translationResponseMode = 'translated';
window.__storageDelayMs = 0;
window.__translationSettingsOverride = {};
window.__delayLanguageDetectionAfterProviderMs = 0;
window.__storageSets = [];
// Capture window.open so the FAB test can assert the reliable MV3 opener path
// (chrome.sidePanel.open can't be triggered from a content-script click; the
// FAB falls back to window.open(chrome.runtime.getURL('sidepanel/index.html'))).
window.__openCalls = [];
const __origOpen = window.open.bind(window);
window.open = (url, name) => { window.__openCalls.push({ url: String(url), name: String(name) }); return null; };

// Build a ReadableStream that emits native OpenAI Responses events. The hold
// simulates a provider that has emitted partial text but is still generating,
// so cancellation cleanup can be exercised in a real browser.
function sseStream(tokens, signal, hold = false) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const t of tokens) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: t }) + '\\n\\n'));
      }
      if (hold) {
        signal && signal.addEventListener('abort', () => {
          controller.error(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
        return;
      }
      controller.enqueue(enc.encode('data: ' + JSON.stringify({
        type: 'response.completed',
        response: { status: 'completed', output: [] }
      }) + '\\n\\n'));
      controller.close();
    }
  });
}

window.fetch = function (url, opts) {
  window.__fetchCalls.push(String(url));
  // Capture the request body so tests can assert translation direction (the
  // system prompt's target language) — guards against the English→English
  // regression caused by detectScript mis-classifying mixed-script pages.
  let parsedBody = null;
  try {
    parsedBody = opts && opts.body ? JSON.parse(opts.body) : null;
    window.__fetchBodies = window.__fetchBodies || [];
    window.__fetchBodies.push(parsedBody);
  } catch (e) {}
  const input = parsedBody && Array.isArray(parsedBody.input) ? parsedBody.input : [];
  const sourceText = input.length ? String(input[input.length - 1].content || '') : '';
  let sourceValue = sourceText;
  const sourceMarker = sourceText.lastIndexOf('SOURCE_JSON:');
  if (sourceMarker >= 0) {
    try { sourceValue = JSON.parse(sourceText.slice(sourceMarker + 'SOURCE_JSON:'.length).trim()); } catch (e) {}
  }
  const conditionalHang = window.__translationResponseMode === 'conditional-fail-hang' && /HANG BLOCK/.test(sourceValue);
  const tokens = window.__translationResponseMode === 'echo'
    ? [sourceValue]
    : window.__translationResponseMode === 'partial-hang'
      ? ['部分中文']
    : window.__translationResponseMode === 'partial-english'
      ? ['一项防止编码代理埋没答案的技能。ADHD-friendly output.']
    : window.__translationResponseMode === 'conditional-japanese-echo' && /[\u3040-\u30ff]/.test(sourceValue)
      ? [sourceValue]
    : window.__translationResponseMode === 'conditional-fail-hang' && /FAIL BLOCK/.test(sourceValue)
      ? [sourceValue]
    : conditionalHang
      ? ['部分中文']
    : window.__translationResponseMode === 'spanish-paraphrase'
      ? ['Esta respuesta permanece completamente en español y no es una traducción al inglés.']
    : window.__translationResponseMode === 'english-translated'
      ? ['This is a complete English translation for the browser regression test.']
    : ['这是完整的中文译文，', '用于浏览器回归测试。'];
  // Every official OpenAI BYOK call hits {baseUrl}/responses with stream:true.
  return Promise.resolve({
    ok: true,
    status: 200,
    body: sseStream(tokens, opts && opts.signal, window.__translationResponseMode === 'partial-hang' || conditionalHang),
    json: () => Promise.resolve({ data: [{ id: 'mock-model' }] }),
    text: () => Promise.resolve(''),
  });
};

window.chrome = {
  i18n: {
    detectLanguage: (text) => {
      const value = String(text || '');
      const language = /[\u3040-\u30ff]/.test(value)
        ? 'ja'
        : /[\u3400-\u9fff]/.test(value)
          ? 'zh'
          : /[áéíóúñ¿¡]|\b(?:esta|respuesta|traducci[oó]n|español)\b/i.test(value)
            ? 'es'
            : 'en';
      const result = { isReliable: true, languages: [{ language, percentage: 100 }] };
      const delay = (window.__fetchCalls || []).length > 0
        ? Number(window.__delayLanguageDetectionAfterProviderMs || 0)
        : 0;
      return delay > 0
        ? new Promise((resolve) => setTimeout(() => resolve(result), delay))
        : Promise.resolve(result);
    },
  },
  runtime: {
    // Return a real Promise (resolved) so relayOrAlert()'s await completes.
    sendMessage: (msg) => {
      window.__lectorMsgs.push(msg);
      return Promise.resolve({});
    },
    // The FAB's reliable opener builds the panel URL via getURL.
    getURL: (p) => 'chrome-extension://testid/' + p.replace(/^\\//, ''),
    lastError: null,
    onMessage: { addListener(fn) { window.__lectorMsgHandlers.onMessage = fn; } },
  },
  storage: {
    local: {
      // BYOK settings WITH an apiKey so the content script's AI paths run.
      // locale:'zh' makes the toolbar buttons render Chinese labels
      // deterministically (headless Chrome's navigator.language is en-US, so
      // 'auto' would resolve to 'en' and the 翻译/高亮/存词 selectors miss).
      get: (_keys, cb) => {
        const value = {
          lector_byok_settings: {
            provider: 'openai',
            apiKey: 'sk-test-mock-key',
            model: 'gpt-4o-mini',
            baseUrl: '',
            locale: 'zh',
            translation: Object.assign(
              { targetLanguage: 'auto', displayMode: 'bilingual', autoTranslate: false, concurrency: 5 },
              window.__translationSettingsOverride || {}
            ),
          },
          lectorGlossary: [],
        };
        if (!cb) return Promise.resolve(value);
        if (window.__storageDelayMs > 0) setTimeout(() => cb(value), window.__storageDelayMs);
        else cb(value);
      },
      set: (v, cb) => {
        window.__storageSets.push(v);
        cb && cb();
      },
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
  // Kill the detached Chrome + drop the temp profile on Ctrl-C / SIGTERM too —
  // the normal cleanup() only runs when main() completes, so an interrupted
  // run would otherwise leak a headless Chrome process group.
  process.on('SIGINT', () => { void cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { void cleanup(); process.exit(143) })
  try {
    let launched = false
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { launched = true; break } } catch {} await sleep(250) }
    check('Chrome (headless=new) launches with remote debugging', launched, `port ${port}`)

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
    // Run BEFORE the FAB menu tests: the "translate page" menu item injects
    // .lector-bilingual blocks (Chinese translations) which would otherwise
    // pollute extractPage's language detection.
    const resp = await fireContentMessage(page, { action: 'lector-get-page' })
    const pg = JSON.parse(resp || 'null')
    check('§extract lector-get-page returns parsed page', !!pg?.page, `title="${pg?.page?.title}"`)
    check('§extract detected language en', pg?.page?.lang === 'en', `lang=${pg?.page?.lang}`)
    check('§extract blocks stable b0/b1 ids', pg?.page?.blocks?.length >= 3 && pg.page.blocks[0].id === 'b0', `blocks=${pg?.page?.blocks?.length}`)
    check('§extract tags live DOM nodes with data-lector-id', (await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)) >= 3, `count=${await evalIn(page, `document.querySelectorAll('[data-lector-id]').length`)}`)

    // ---- §1.2 FAB opens a radial quick-action menu ----
    // The FAB no longer opens a window directly; it pops a radial menu of
    // page-level actions. Verify: click FAB → menu appears with 4 items;
    // each item is a menuitem; clicking "open in new window" triggers
    // window.open with the cached sidepanel URL; clicking "translate page"
    // triggers the bilingual message; clicking FAB again closes the menu.
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; window.__lectorMsgs.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    const menuState = JSON.parse(await evalIn(page, `(()=>{ const m = document.querySelector('.lector-fab-menu'); const items = m ? m.querySelectorAll('.lector-fab-item') : []; return JSON.stringify({ open: !!m, itemCount: items.length, aria: document.querySelector('#lector-ai-fab').getAttribute('aria-expanded'), labels: [...items].map(i=>i.getAttribute('aria-label')) }); })()`) || '{}')
    check('§1.2 FAB click → radial menu opens', menuState.open, `open=${menuState.open}`)
    check('§1.2 menu has 4 items (translate/summarize/panel/standalone)', menuState.itemCount === 4, `count=${menuState.itemCount}`)
    check('§1.2 FAB aria-expanded reflects open state', menuState.aria === 'true', `aria=${menuState.aria}`)
    check('§1.2 menu items are role=menuitem with labels', menuState.labels && menuState.labels.length === 4 && menuState.labels.every((l) => typeof l === 'string' && l.length > 0), `labels=${JSON.stringify(menuState.labels)}`)

    // Click the "open in new window" menu item → window.open(cached URL).
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /new window|单独打开/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(350)
    const fabOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.2 "open in new window" item → window.open(sidepanel URL)', fabOpenCalls.length >= 1 && fabOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(fabOpenCalls)}`)
    check('§1.2 reuses named window lector-ai-panel', fabOpenCalls.length === 0 || fabOpenCalls[0].name === 'lector-ai-panel', `name="${fabOpenCalls[0]?.name}"`)
    // Menu auto-closes after an item is picked (closeFabMenu removes the DOM
    // after its collapse animation; wait past the 280ms timeout).
    const closedAfterPick = !(await evalIn(page, `!!document.querySelector('.lector-fab-menu')`))
    check('§1.2 menu closes after picking an item', closedAfterPick, closedAfterPick ? 'ok' : 'still open')

    // Reopen → "translate page" item runs the page bilingual translation
    // directly (it does NOT re-send lector-toggle-bilingual — that's the
    // inbound message from the side panel). Observable effect: the bilingual
    // loop injects .lector-bilingual-host blocks + sends progress messages.
    await evalIn(page, `(()=>{ window.__lectorMsgs.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /translate page|翻译整页/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(400)
    const hostsAfter = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const progressMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-bilingual-progress'))`) || '[]')
    check('§1.2 "translate page" item runs bilingual translation (hosts injected + progress)', hostsAfter > 0 && progressMsgs.length > 0, `hosts=${hostsAfter} progress=${progressMsgs.length}`)
    // Translation DIRECTION regression: an English page (the article fixture)
    // must translate to Chinese, not English. The old detectScript returned
    // 'cjk' whenever any CJK char was present, flipping direction so English
    // pages came back untranslated. Assert the captured request body's
    // Responses `instructions` field
    // prompt asks for Chinese.
    const firstSys = await evalIn(page, `(()=>{ const b=(window.__fetchBodies||[])[0]; return b && b.instructions ? String(b.instructions).slice(0,120) : ''; })()`)
    check('§1.2 English page → bilingual prompt asks for Chinese (direction bug)', /to Chinese/i.test(firstSys), `sys="${firstSys.slice(0,80)}"`)
    // "open side panel" item → open-side-panel message (best-effort) AND a
    // window.open fallback (MV3 forbids sidePanel.open from a content-script
    // click, so the item must also open the standalone window so the user
    // always sees Lector open — never a silent no-op).
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; })()`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /side panel|侧边栏/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
    await sleep(200)
    const panelMsgs = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='open-side-panel'))`) || '[]')
    const panelOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.2 "open side panel" item → open-side-panel sent (best-effort)', panelMsgs.length >= 1, `count=${panelMsgs.length}`)
    check('§1.2 "open side panel" item → window.open fallback (reliable opener)', panelOpenCalls.length >= 1 && panelOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(panelOpenCalls)}`)
    // Toggle close: clicking FAB while open closes the menu without firing actions.
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(300)
    const openCount = await evalIn(page, `document.querySelectorAll('.lector-fab-item').length`)
    await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
    await sleep(350)
    const closedCount = await evalIn(page, `document.querySelectorAll('.lector-fab-item').length`)
    check('§1.2 clicking FAB again closes the menu', openCount === 4 && closedCount === 0, `open=${openCount} closed=${closedCount}`)

    // ---- §1.3 FAB menu survives "Extension context invalidated" ----
    // The orphaned-content-script regression: after ext reload / SW destroyed,
    // chrome.runtime.getURL/sendMessage throw synchronously. The URL is cached
    // at load and runtime calls are try/caught, so the menu still opens and the
    // "open in new window" item still window.opens the cached URL.
    await evalIn(page, `(()=>{ window.__openCalls.length = 0; })()`)
    await evalIn(page, `(()=>{ const r = window.chrome.runtime; r.getURL = () => { throw new Error('Extension context invalidated.'); }; r.sendMessage = () => { throw new Error('Extension context invalidated.'); }; })()`)
    let invalidatedThrew = false
    try {
      await evalIn(page, `document.querySelector('#lector-ai-fab').click()`)
      await sleep(300)
      // Menu should still open even with invalidated runtime.
      const stillOpen = await evalIn(page, `!!document.querySelector('.lector-fab-menu')`)
      check('§1.3 FAB menu opens even when context invalidated', stillOpen, `open=${stillOpen}`)
      // "open in new window" still works via cached URL.
      await evalIn(page, `(()=>{ const items = document.querySelectorAll('.lector-fab-item'); const t = [...items].find(i => i.getAttribute('aria-label') && /new window|单独打开/i.test(i.getAttribute('aria-label'))); if (t) t.click(); })()`)
      await sleep(200)
    } catch (e) {
      invalidatedThrew = true
    }
    const invOpenCalls = JSON.parse(await evalIn(page, `JSON.stringify(window.__openCalls||[])`) || '[]')
    check('§1.3 FAB click does NOT throw on invalidated context', !invalidatedThrew, invalidatedThrew ? 'threw' : 'ok')
    check('§1.3 "open in new window" still works via cached URL when invalidated', invOpenCalls.length >= 1 && invOpenCalls[0].url.includes('sidepanel/index.html'), `calls=${JSON.stringify(invOpenCalls)}`)
    // Restore a working runtime so later tests still pass.
    await evalIn(page, `(()=>{ const r = window.chrome.runtime; r.getURL = (p) => 'chrome-extension://testid/' + p.replace(/^\\//, ''); r.sendMessage = (m) => { window.__lectorMsgs.push(m); return Promise.resolve({}); }; })()`)

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
    check('§2.2 translate hit provider /responses (BYOK)', fetchHits.some((u) => u.endsWith('/responses')), `calls=${fetchHits.length}`)
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
    await selectReveal(`(() => {
      const el = document.querySelectorAll('article p')[2];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) throw new Error('save-word fixture has no text node');
      const r = document.createRange();
      r.setStart(text, 0);
      r.setEnd(text, Math.min(5, text.textContent.length));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    })()`)
    await clickToolbarBtn('存词')
    await sleep(300)
    const swMsg = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]')
    check('§4.1 save-word message relayed (word+context)', swMsg.length >= 1 && !!swMsg[0].word, `word="${swMsg[0]?.word}"`)

    // ---- §9 bilingual toggle → injects .lector-bilingual via BYOK streamChat ----
    // Reset the fetch counter so we can measure how many requests the
    // concurrent bilingual pass fires (concurrency default = 5).
    // An earlier FAB-menu assertion already translated the fixture. Restore
    // each host to its source DOM first; otherwise the second run correctly
    // finds no untranslated candidates and this concurrency check is vacuous.
    await evalIn(page, `(()=>{
      document.querySelectorAll('.lector-bilingual-host').forEach(host => {
        host.querySelectorAll(':scope > .lector-bilingual').forEach(n => n.remove());
        Array.from(host.querySelectorAll(':scope > .lector-bi-source-node')).forEach(node => {
          node.classList.remove('lector-bi-source', 'lector-bi-source-node');
          if (node.dataset.lectorSourceText === 'true') node.replaceWith(...Array.from(node.childNodes));
        });
        host.classList.remove('lector-bilingual-host', 'lector-translation-error');
      });
      const li = document.createElement('li');
      li.id = 'dom-structure-fixture';
      li.innerHTML = '<strong id="dom-direct-child">Read the detailed migration guidance before upgrading.</strong>';
      document.querySelector('article').appendChild(li);
      const alreadyTarget = document.createElement('p');
      alreadyTarget.id = 'already-target-fixture';
      alreadyTarget.textContent = '这段正文已经是中文，不应再追加重复译文。';
      document.querySelector('article').appendChild(alreadyTarget);
    })()`)
    await evalIn(page, `window.__fetchCalls = []; window.__fetchBodies = []`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(2000)
    const bilingualBlocks = await evalIn(page, `document.querySelectorAll('.lector-bilingual').length`)
    check('§9.1 lector-toggle-bilingual injects .lector-bilingual blocks', bilingualBlocks >= 1, `blocks=${bilingualBlocks}`)
    const bilingualFetches = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchCalls||[]).filter(u=>String(u).endsWith('/responses')))`) || '[]')
    check('§9.2 bilingual fires concurrent requests (>1 in flight)', bilingualFetches.length >= 2, `chatCalls=${bilingualFetches.length}`)
    const bilingualBodies = JSON.parse(await evalIn(page, `JSON.stringify(window.__fetchBodies || [])`) || '[]')
    const bilingualUserPrompts = bilingualBodies
      .map((body) => body?.input?.filter((message) => message.role === 'user').at(-1)?.content || '')
    check('§9.2 every bilingual user turn repeats the resolved target language',
      bilingualUserPrompts.length >= 2 && bilingualUserPrompts.every((prompt) => /Chinese \(Simplified\)/.test(prompt)),
      `prompts=${bilingualUserPrompts.length}`)
    check('§9.2 every bilingual user turn isolates page text as translation data',
      bilingualUserPrompts.length >= 2 && bilingualUserPrompts.every((prompt) => /SOURCE_JSON:\s*"[\s\S]*"\s*$/.test(prompt)),
      `prompts=${bilingualUserPrompts.length}`)

    // §9.3 display modes: each translated block is marked a host so the
    // translationOnly / hover CSS can target it, and the original text is
    // marked with .lector-bi-source-node so translationOnly can hide it
    // without reparenting existing element children.
    const hostCount = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host').length`)
    const hostedChunks = await evalIn(page, `document.querySelectorAll('.lector-bilingual-host .lector-bilingual').length`)
    check('§9.3a translated chunks belong to marked hosts', hostedChunks >= 1 && hostedChunks === bilingualFetches.length, `hosts=${hostCount} hostedChunks=${hostedChunks} requests=${bilingualFetches.length}`)
    const directChildPreserved = await evalIn(page, `!!document.querySelector('#dom-structure-fixture > #dom-direct-child')`)
    check('§9.3a translation preserves existing direct-child DOM structure', directChildPreserved === true)
    const alreadyTargetSkipped = await evalIn(page, `!document.querySelector('#already-target-fixture.lector-bilingual-host, #already-target-fixture > .lector-bilingual')`)
    check('§9.3a blocks already in the target language are skipped', alreadyTargetSkipped === true)
    await evalIn(page, `document.body.classList.remove('lector-dm-bilingual'); document.body.classList.add('lector-dm-translationOnly')`)
    const origHiddenInTranslationOnly = await evalIn(page, `(() => { const s = document.querySelector('.lector-bilingual-host > .lector-bi-source-node'); return !!s && getComputedStyle(s).display === 'none' })()`)
    check('§9.3b translationOnly hides the original text', origHiddenInTranslationOnly === true)
    const trVisibleInTranslationOnly = await evalIn(page, `(() => { const h = document.querySelector('.lector-bilingual-host .lector-bilingual'); return !!h && getComputedStyle(h).display !== 'none' })()`)
    check('§9.3c translationOnly keeps the translation visible', trVisibleInTranslationOnly === true)
    // restore default mode for any later checks
    await evalIn(page, `document.body.classList.remove('lector-dm-translationOnly'); document.body.classList.add('lector-dm-bilingual')`)

    // §9.4 Quality guard: a provider that returns different/source-language
    // English must not be rendered or cached as a successful Chinese
    // translation. The semantic retry happens exactly once, then a localized
    // error remains while the source stays readable.
    await evalIn(page, `(()=>{
      document.querySelectorAll('.lector-bilingual-host').forEach(host => {
        host.querySelectorAll(':scope > .lector-bilingual').forEach(n => n.remove());
        Array.from(host.querySelectorAll(':scope > .lector-bi-source-node')).forEach(node => {
          node.classList.remove('lector-bi-source', 'lector-bi-source-node');
          if (node.dataset.lectorSourceText === 'true') node.replaceWith(...Array.from(node.childNodes));
        });
        host.classList.remove('lector-bilingual-host', 'lector-translation-error');
      });
      document.querySelector('article').setAttribute('translate', 'no');
      const p = document.createElement('p');
      p.id = 'quality-echo-fixture';
      p.textContent = 'This provider response remains entirely in English after translation.';
      document.body.appendChild(p);
      for (let i = 2; i <= 4; i++) {
        const extra = document.createElement('p');
        extra.id = 'quality-echo-fixture-' + i;
        extra.textContent = 'This additional English paragraph must not trigger another request after the page probe fails number ' + i + '.';
        document.body.appendChild(extra);
      }
      window.__translationResponseMode = 'echo';
      window.__fetchCalls = [];
      window.__lectorMsgs = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(900)
    const qualityFetches = JSON.parse(await evalIn(page, `JSON.stringify((window.__fetchCalls||[]).filter(u=>String(u).endsWith('/responses')))`) || '[]')
    const qualityState = JSON.parse(await evalIn(page, `JSON.stringify((()=>{
      const host = document.querySelector('#quality-echo-fixture');
      const out = host && host.querySelector(':scope > .lector-bilingual');
      const source = host ? Array.from(host.querySelectorAll(':scope > .lector-bi-source-node')).map(n => n.textContent || '').join('') : '';
      return {
        isError: !!out && out.classList.contains('is-error'),
        output: out ? out.childNodes[0]?.textContent || '' : '',
        source,
      };
    })())`) || '{}')
    check('§9.4 source-language echo gets exactly one semantic retry', qualityFetches.length === 2, `calls=${qualityFetches.length}`)
    const probeCircuitState = JSON.parse(await evalIn(page, `JSON.stringify((() => ({
      errorHosts: document.querySelectorAll('[id^="quality-echo-fixture"].lector-translation-error').length,
      untouched: Array.from(document.querySelectorAll('[id^="quality-echo-fixture-"]')).filter((host) => !host.classList.contains('lector-bilingual-host')).length,
      errors: (window.__lectorMsgs || []).filter((message) => message.action === 'lector-bilingual-error').map((message) => message.message),
    }))())`) || '{}')
    check('§9.4 failed probe stops the rest of the page before an error storm',
      probeCircuitState.errorHosts === 1 && probeCircuitState.untouched === 3,
      `state=${JSON.stringify(probeCircuitState)}`)
    check('§9.4 failed probe reports one page-level stop reason',
      probeCircuitState.errors.length === 1 && /停止后续请求|remaining requests were stopped/i.test(probeCircuitState.errors[0]),
      `errors=${JSON.stringify(probeCircuitState.errors)}`)
    check('§9.4 second English echo is shown as quality error, not fake translation',
      qualityState.isError && /目标语言|target language/i.test(qualityState.output) && !/provider response remains/i.test(qualityState.output),
      `state=${JSON.stringify(qualityState)}`)
    check('§9.4 quality failure preserves readable source text',
      /provider response remains entirely in English/i.test(qualityState.source),
      `source="${qualityState.source}"`)
    await evalIn(page, `document.body.classList.remove('lector-dm-bilingual'); document.body.classList.add('lector-dm-translationOnly')`)
    const failedSourceVisible = await evalIn(page, `Array.from(document.querySelectorAll('#quality-echo-fixture > .lector-bi-source-node')).every(n => getComputedStyle(n).display !== 'none')`)
    check('§9.4 quality failure keeps source visible in translation-only mode', failedSourceVisible === true)
    const failedRetryVisible = await evalIn(page, `(() => {
      const actions = document.querySelector('#quality-echo-fixture > .lector-bilingual.is-error .lector-bi-actions');
      const copy = actions && actions.querySelector('.lector-bi-copy');
      return !!actions && getComputedStyle(actions).display !== 'none' && !!copy && getComputedStyle(copy).display === 'none';
    })()`)
    check('§9.4 failed chunks keep Retry visible and hide Copy', failedRetryVisible === true)
    await evalIn(page, `document.body.classList.remove('lector-dm-translationOnly'); document.body.classList.add('lector-dm-bilingual')`)
    await evalIn(page, `window.__translationResponseMode = 'translated'`)

    // A new whole-page run must revisit failed hosts. Previously the lingering
    // `.lector-bilingual-host` class excluded them forever.
    await evalIn(page, `window.__fetchCalls = []; window.__fetchBodies = []`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(900)
    const recoveredQualityState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#quality-echo-fixture');
      const output = host && host.querySelector(':scope > .lector-bilingual');
      return {
        isError: !!output && output.classList.contains('is-error'),
        text: output ? output.childNodes[0]?.textContent || '' : '',
      };
    })())`) || '{}')
    check('§9.4 a later whole-page run retries and recovers a failed paragraph',
      !recoveredQualityState.isError && /中文译文/.test(recoveredQualityState.text),
      `state=${JSON.stringify(recoveredQualityState)}`)
    const recoveredQualityCount = await evalIn(page, `document.querySelectorAll('[id^="quality-echo-fixture"] > .lector-bilingual:not(.is-error)').length`)
    check('§9.4 successful probe releases the remaining paragraphs',
      recoveredQualityCount === 4,
      `translated=${recoveredQualityCount}`)

    // A run-local memo must reuse the successful probe even when the user has
    // disabled persistent caching; one single-chunk paragraph means one paid
    // request, not probe + duplicate formal request.
    await evalIn(page, `(() => {
      document.querySelectorAll('[id^="quality-echo-fixture"]').forEach((node) => node.setAttribute('translate', 'no'));
      const p = document.createElement('p');
      p.id = 'cache-off-probe-fixture';
      p.textContent = 'A successful test paragraph must be reused inside the same run when persistent caching is disabled.';
      document.body.appendChild(p);
      window.__translationSettingsOverride = { cacheTtlDays: 0 };
      window.__translationResponseMode = 'translated';
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(700)
    const cacheOffProbeState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#cache-off-probe-fixture');
      return {
        fetches: (window.__fetchCalls || []).filter((url) => String(url).endsWith('/responses')).length,
        translated: !!host?.querySelector(':scope > .lector-bilingual:not(.is-error)'),
      };
    })())`) || '{}')
    check('§9.4 cache-off run reuses its successful probe without a duplicate request',
      cacheOffProbeState.fetches === 1 && cacheOffProbeState.translated === true,
      `state=${JSON.stringify(cacheOffProbeState)}`)
    await evalIn(page, `(() => {
      window.__translationSettingsOverride = {};
      document.querySelector('#cache-off-probe-fixture')?.setAttribute('translate', 'no');
    })()`)

    // §9.5a Cancel immediately while settings are still loading. The run must
    // already own a controller, otherwise it will send a probe after claiming
    // to be canceled.
    await evalIn(page, `(() => {
      const p = document.createElement('p');
      p.id = 'cancel-before-settings-fixture';
      p.textContent = 'This request must never reach the provider after an immediate cancellation.';
      document.body.appendChild(p);
      window.__storageDelayMs = 150;
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await fireContentMessage(page, { action: 'lector-cancel-bilingual' })
    await sleep(300)
    const earlyCancelState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#cancel-before-settings-fixture');
      return {
        fetches: (window.__fetchCalls || []).filter((url) => String(url).endsWith('/responses')).length,
        hostClass: !!host && host.classList.contains('lector-bilingual-host'),
        chunks: host ? host.querySelectorAll(':scope > .lector-bilingual').length : -1,
      };
    })())`) || '{}')
    check('§9.5 cancel before settings load sends no delayed provider request',
      earlyCancelState.fetches === 0 &&
        earlyCancelState.hostClass === false &&
        earlyCancelState.chunks === 0,
      `state=${JSON.stringify(earlyCancelState)}`)
    await evalIn(page, `window.__storageDelayMs = 0; document.querySelector('#cancel-before-settings-fixture')?.setAttribute('translate', 'no')`)

    // §9.5b Cancel after a partial token. Partial output must not be cached or
    // leave a loading host that hides the source in translation-only mode.
    await evalIn(page, `(() => {
      const p = document.createElement('p');
      p.id = 'cancel-partial-fixture';
      p.textContent = 'This paragraph remains readable when a streaming translation is canceled midway.';
      document.body.appendChild(p);
      window.__translationResponseMode = 'partial-hang';
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    for (let i = 0; i < 20; i++) {
      if (await evalIn(page, `!!document.querySelector('#cancel-partial-fixture > .lector-bilingual.is-loading, #cancel-partial-fixture > .lector-bilingual')`)) break
      await sleep(25)
    }
    await fireContentMessage(page, { action: 'lector-cancel-bilingual' })
    await sleep(250)
    const cancelState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#cancel-partial-fixture');
      return {
        hostClass: !!host && host.classList.contains('lector-bilingual-host'),
        chunkCount: host ? host.querySelectorAll(':scope > .lector-bilingual').length : -1,
        sourceMarkers: host ? host.querySelectorAll(':scope > .lector-bi-source-node').length : -1,
        text: host?.textContent || '',
      };
    })())`) || '{}')
    check('§9.5b cancel discards partial output and fully restores the source block',
      cancelState.hostClass === false &&
        cancelState.chunkCount === 0 &&
        cancelState.sourceMarkers === 0 &&
        /remains readable/.test(cancelState.text),
      `state=${JSON.stringify(cancelState)}`)
    await evalIn(page, `window.__translationResponseMode = 'translated'`)

    // §9.6 A half-Chinese/half-English response must fail the same quality
    // gate as a full echo. This is the exact GitHub Trending regression from
    // the user report, where "ADHD-friendly output." remained untranslated.
    await evalIn(page, `(() => {
      document.querySelector('#cancel-partial-fixture')?.setAttribute('translate', 'no');
      const p = document.createElement('p');
      p.id = 'partial-english-fixture';
      p.textContent = 'A skill to stop your coding agent from burying the answer. ADHD-friendly output.';
      document.body.appendChild(p);
      window.__translationResponseMode = 'partial-english';
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(900)
    const partialEnglishState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#partial-english-fixture');
      const output = host?.querySelector(':scope > .lector-bilingual');
      return {
        fetches: (window.__fetchCalls || []).filter((url) => String(url).endsWith('/responses')).length,
        failed: !!output?.classList.contains('is-error'),
        visibleEnglish: output?.textContent?.includes('ADHD-friendly output.') || false,
      };
    })())`) || '{}')
    check('§9.6 mixed Chinese + unchanged English clause is rejected and never accepted',
      partialEnglishState.fetches === 2 && partialEnglishState.failed === true && partialEnglishState.visibleEnglish === false,
      `state=${JSON.stringify(partialEnglishState)}`)
    await evalIn(page, `document.querySelector('#partial-english-fixture')?.setAttribute('translate', 'no'); window.__translationResponseMode = 'translated'`)

    // §9.7 Auto target belongs to the whole page. A failed Japanese chunk on
    // a mostly-English page must still retry into Chinese, not re-detect that
    // isolated chunk and flip the target to English.
    await evalIn(page, `(() => {
      const english = document.createElement('p');
      english.id = 'retry-target-english';
      english.textContent = 'This long English project description establishes Chinese as the automatic page target for every candidate in this mixed-language translation run.';
      const japanese = document.createElement('p');
      japanese.id = 'retry-target-japanese';
      japanese.textContent = 'この日本語の説明文は最初の翻訳で失敗し、手動で再試行されます。';
      document.body.append(english, japanese);
      window.__translationResponseMode = 'conditional-japanese-echo';
      window.__fetchCalls = [];
      window.__fetchBodies = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(1200)
    const retryReady = await evalIn(page, `!!document.querySelector('#retry-target-japanese > .lector-bilingual.is-error .lector-bi-retry')`)
    await evalIn(page, `window.__translationResponseMode = 'translated'; window.__fetchCalls = []; window.__fetchBodies = []; document.querySelector('#retry-target-japanese > .lector-bilingual.is-error .lector-bi-retry')?.click()`)
    await sleep(800)
    const manualRetryState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const bodies = window.__fetchBodies || [];
      const prompt = bodies.at(-1)?.input?.filter((message) => message.role === 'user').at(-1)?.content || '';
      return {
        wasRetryable: ${retryReady ? 'true' : 'false'},
        calls: (window.__fetchCalls || []).length,
        targetIsChinese: /Chinese \\(Simplified\\)/.test(prompt),
        recovered: !!document.querySelector('#retry-target-japanese > .lector-bilingual:not(.is-error)'),
      };
    })())`) || '{}')
    check('§9.7 manual Retry preserves the page-resolved auto target',
      manualRetryState.wasRetryable && manualRetryState.calls === 1 && manualRetryState.targetIsChinese && manualRetryState.recovered,
      `state=${JSON.stringify(manualRetryState)}`)
    await evalIn(page, `document.querySelector('#retry-target-english')?.setAttribute('translate', 'no'); document.querySelector('#retry-target-japanese')?.setAttribute('translate', 'no')`)

    // §9.8 Once the probe succeeds, one block can fail while a sibling is
    // still streaming. Retry controls stay hidden until the run settles, and
    // an external Cancel suppresses any already-collected late provider error.
    await evalIn(page, `(() => {
      const texts = [
        ['run-active-probe', 'A normal probe paragraph confirms the provider before concurrent work begins.'],
        ['run-active-fail', 'FAIL BLOCK remains in English and creates a retryable quality error.'],
        ['run-active-hang', 'HANG BLOCK keeps streaming so the page run remains active.'],
      ];
      for (const [id, text] of texts) { const p = document.createElement('p'); p.id = id; p.textContent = text; document.body.appendChild(p); }
      window.__translationResponseMode = 'conditional-fail-hang';
      window.__lectorMsgs = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    for (let i = 0; i < 60; i++) {
      const ready = await evalIn(page, `!!document.querySelector('#run-active-fail > .lector-bilingual.is-error') && !!document.querySelector('#run-active-hang > .lector-bilingual.is-loading')`)
      if (ready) break
      await sleep(50)
    }
    const activeRetryState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const actions = document.querySelector('#run-active-fail > .lector-bilingual.is-error .lector-bi-actions');
      return { active: document.body.classList.contains('lector-bilingual-run-active'), hidden: !!actions && getComputedStyle(actions).display === 'none' };
    })())`) || '{}')
    check('§9.8 Retry is hidden while its owning whole-page run is still active',
      activeRetryState.active && activeRetryState.hidden,
      `state=${JSON.stringify(activeRetryState)}`)
    await fireContentMessage(page, { action: 'lector-cancel-bilingual' })
    await sleep(350)
    const lateCancelErrors = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs || []).filter((message) => message.action === 'lector-bilingual-error'))`) || '[]')
    check('§9.8 Cancel is not overwritten by a late ordinary provider error',
      lateCancelErrors.some((message) => message.canceled === true) && !lateCancelErrors.some((message) => message.canceled !== true),
      `errors=${JSON.stringify(lateCancelErrors)}`)
    await evalIn(page, `['run-active-probe','run-active-fail','run-active-hang'].forEach((id) => document.getElementById(id)?.remove()); window.__translationResponseMode = 'translated'`)

    // §9.9 Failed hosts are revalidated against live ancestry. A block moved
    // under no-translate UI and an old GitHub repo-heading error must be
    // restored, never forcibly retried.
    await evalIn(page, `(() => {
      const excluded = document.createElement('div');
      excluded.setAttribute('data-lector-no-translate', '');
      excluded.innerHTML = '<p id="stale-excluded" class="lector-bilingual-host lector-translation-error"><span class="lector-bi-source lector-bi-source-node">Do not translate this moved block.</span><span class="lector-bilingual is-error">old error</span></p>';
      const row = document.createElement('article');
      row.className = 'Box-row';
      row.innerHTML = '<h2 id="stale-repo-heading" class="lector-bilingual-host lector-translation-error"><a class="lector-bi-source lector-bi-source-node" href="/owner/repository">owner / repository</a><span class="lector-bilingual is-error">old error</span></h2>';
      document.body.append(excluded, row);
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(500)
    const staleState = JSON.parse(await evalIn(page, `JSON.stringify((() => ({
      fetches: (window.__fetchCalls || []).length,
      excludedRestored: !document.querySelector('#stale-excluded')?.classList.contains('lector-bilingual-host') && !document.querySelector('#stale-excluded > .lector-bilingual'),
      repoRestored: !document.querySelector('#stale-repo-heading')?.classList.contains('lector-bilingual-host') && !document.querySelector('#stale-repo-heading > .lector-bilingual'),
    }))())`) || '{}')
    check('§9.9 stale excluded/repository-name errors are restored without provider calls',
      staleState.fetches === 0 && staleState.excludedRestored && staleState.repoRestored,
      `state=${JSON.stringify(staleState)}`)

    // §9.10 Unicode scripts cannot distinguish Spanish from English. The
    // local Chrome language detector skips prose already in the target and
    // rejects a same-language Spanish paraphrase when English was requested.
    await evalIn(page, `(() => {
      const english = document.createElement('p');
      english.id = 'same-script-already-english';
      english.textContent = 'This paragraph is already written in the requested English target language.';
      const spanish = document.createElement('p');
      spanish.id = 'same-script-spanish';
      spanish.textContent = 'Una app muy rápida.';
      document.body.append(english, spanish);
      window.__translationSettingsOverride = { targetLanguage: 'en', cacheTtlDays: 0 };
      window.__translationResponseMode = 'spanish-paraphrase';
      window.__fetchCalls = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(900)
    const sameScriptState = JSON.parse(await evalIn(page, `JSON.stringify((() => ({
      fetches: (window.__fetchCalls || []).length,
      englishSkipped: !document.querySelector('#same-script-already-english.lector-bilingual-host, #same-script-already-english > .lector-bilingual'),
      spanishRejected: !!document.querySelector('#same-script-spanish > .lector-bilingual.is-error'),
    }))())`) || '{}')
    check('§9.10 same-script detector skips target text and rejects source-language paraphrase',
      sameScriptState.fetches === 2 && sameScriptState.englishSkipped && sameScriptState.spanishRejected,
      `state=${JSON.stringify(sameScriptState)}`)
    await evalIn(page, `document.querySelector('#same-script-already-english')?.setAttribute('translate', 'no'); document.querySelector('#same-script-spanish')?.setAttribute('translate', 'no'); window.__translationSettingsOverride = {}; window.__translationResponseMode = 'translated'`)

    // §9.11 Cancel while output-language detection is pending. The provider
    // has already streamed a complete same-script translation, but ownership
    // is revoked before the on-device detector resolves; no DOM/cache write or
    // stale completion may survive that cancellation race.
    await evalIn(page, `(() => {
      const spanish = document.createElement('p');
      spanish.id = 'cancel-during-detector';
      spanish.textContent = 'Una app muy rápida.';
      document.body.appendChild(spanish);
      window.__translationSettingsOverride = { targetLanguage: 'en', cacheTtlDays: 30 };
      window.__translationResponseMode = 'english-translated';
      window.__delayLanguageDetectionAfterProviderMs = 1500;
      window.__fetchCalls = [];
      window.__storageSets = [];
      window.__lectorMsgs = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    for (let i = 0; i < 40; i++) {
      if (await evalIn(page, `(window.__fetchCalls || []).length > 0`)) break
      await sleep(10)
    }
    await fireContentMessage(page, { action: 'lector-cancel-bilingual' })
    // Wait past the mocked detector resolution and the cache debounce window,
    // proving neither can perform a late write after the abort listener wins.
    await sleep(1700)
    const detectorCancelState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const host = document.querySelector('#cancel-during-detector');
      const cacheWrites = (window.__storageSets || []).filter((entry) => entry && entry.lectorCache);
      const cachedValues = cacheWrites.flatMap((entry) => Object.values(entry.lectorCache || {}).map((value) => value && value.v));
      return {
        providerCalled: (window.__fetchCalls || []).length > 0,
        hostRestored: !!host && !host.classList.contains('lector-bilingual-host') && !host.querySelector(':scope > .lector-bilingual, :scope > .lector-bi-source-node'),
        cachedTranslatedOutput: cachedValues.some((value) => /complete English translation/i.test(String(value || ''))),
        completes: (window.__lectorMsgs || []).filter((message) => message.action === 'lector-bilingual-progress' && message.complete === true).length,
        canceled: (window.__lectorMsgs || []).some((message) => message.action === 'lector-bilingual-error' && message.canceled === true),
      };
    })())`) || '{}')
    check('§9.11 cancel during delayed language detection restores DOM and skips cache/final completion',
      detectorCancelState.providerCalled && detectorCancelState.hostRestored && !detectorCancelState.cachedTranslatedOutput && detectorCancelState.completes === 0 && detectorCancelState.canceled,
      `state=${JSON.stringify(detectorCancelState)}`)
    await evalIn(page, `document.querySelector('#cancel-during-detector')?.setAttribute('translate', 'no'); window.__delayLanguageDetectionAfterProviderMs = 0; window.__translationSettingsOverride = {}; window.__translationResponseMode = 'translated'`)

    // §9.12 Rapid replacement waits for the old run's DOM cleanup. The
    // aborted run must not emit a stale final-complete that clears the new
    // run's progress state.
    await evalIn(page, `(() => {
      const oldRun = document.createElement('p');
      oldRun.id = 'reentry-old-run';
      oldRun.textContent = 'The old run starts streaming and is immediately replaced by a newer page run.';
      document.body.appendChild(oldRun);
      window.__translationResponseMode = 'partial-hang';
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    for (let i = 0; i < 30; i++) {
      if (await evalIn(page, `!!document.querySelector('#reentry-old-run > .lector-bilingual')`)) break
      await sleep(25)
    }
    await evalIn(page, `(() => {
      document.querySelector('#reentry-old-run')?.setAttribute('translate', 'no');
      const nextRun = document.createElement('p');
      nextRun.id = 'reentry-new-run';
      nextRun.textContent = 'The replacement run should own the only final progress event and translated DOM.';
      document.body.appendChild(nextRun);
      window.__translationResponseMode = 'translated';
      window.__lectorMsgs = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    await sleep(1000)
    const reentryState = JSON.parse(await evalIn(page, `JSON.stringify((() => ({
      completes: (window.__lectorMsgs || []).filter((message) => message.action === 'lector-bilingual-progress' && message.complete === true).length,
      oldRestored: !document.querySelector('#reentry-old-run.lector-bilingual-host, #reentry-old-run > .lector-bilingual'),
      newTranslated: !!document.querySelector('#reentry-new-run > .lector-bilingual:not(.is-error)'),
    }))())`) || '{}')
    check('§9.12 rapid run replacement has one current completion and stable DOM ownership',
      reentryState.completes === 1 && reentryState.oldRestored && reentryState.newTranslated,
      `state=${JSON.stringify(reentryState)}`)

    // §9.13 Dynamically added content (infinite scroll / lazy load) must be
    // translated by the incremental observer after a finished run, with the
    // page-resolved target; a cancel stops the observer for good.
    await evalIn(page, `(() => {
      document.querySelectorAll('.lector-bilingual-host').forEach(host => {
        host.querySelectorAll(':scope > .lector-bilingual').forEach(n => n.remove());
        Array.from(host.querySelectorAll(':scope > .lector-bi-source-node')).forEach(node => {
          node.classList.remove('lector-bi-source', 'lector-bi-source-node');
          if (node.dataset.lectorSourceText === 'true') node.replaceWith(...Array.from(node.childNodes));
        });
        host.classList.remove('lector-bilingual-host', 'lector-translation-error');
      });
      const seed = document.createElement('p');
      seed.id = 'incremental-seed';
      seed.textContent = 'This seed paragraph establishes the page direction before new content is appended dynamically.';
      document.body.appendChild(seed);
      window.__translationResponseMode = 'translated';
      window.__fetchCalls = [];
      window.__fetchBodies = [];
    })()`)
    await fireContentMessage(page, { action: 'lector-toggle-bilingual' })
    for (let i = 0; i < 40; i++) {
      if (await evalIn(page, `!!document.querySelector('#incremental-seed > .lector-bilingual:not(.is-error)')`)) break
      await sleep(50)
    }
    await evalIn(page, `window.__fetchCalls = []; window.__fetchBodies = []`)
    // Simulate infinite scroll: new English prose appears AFTER the run.
    await evalIn(page, `(() => {
      const lazy = document.createElement('div');
      lazy.innerHTML = '<p id="incremental-lazy">Lazy-loaded article content that appeared after the translation run finished.</p>';
      document.body.appendChild(lazy);
    })()`)
    let lazyTranslated = false
    for (let i = 0; i < 60; i++) {
      if (await evalIn(page, `!!document.querySelector('#incremental-lazy > .lector-bilingual:not(.is-error)')`)) { lazyTranslated = true; break }
      await sleep(50)
    }
    const incrementalState = JSON.parse(await evalIn(page, `JSON.stringify((() => {
      const bodies = window.__fetchBodies || [];
      const prompt = bodies.at(-1)?.input?.filter((message) => message.role === 'user').at(-1)?.content || '';
      return {
        fetches: (window.__fetchCalls || []).filter((url) => String(url).endsWith('/responses')).length,
        targetIsChinese: /Chinese \\(Simplified\\)/.test(prompt),
      };
    })())`) || '{}')
    check('§9.13 dynamically added content is translated by the incremental pass',
      lazyTranslated && incrementalState.fetches === 1 && incrementalState.targetIsChinese,
      `translated=${lazyTranslated} state=${JSON.stringify(incrementalState)}`)
    // Cancel stops the observer: later additions stay untranslated.
    await fireContentMessage(page, { action: 'lector-cancel-bilingual' })
    await evalIn(page, `(() => {
      window.__fetchCalls = [];
      const after = document.createElement('p');
      after.id = 'incremental-after-cancel';
      after.textContent = 'No request may be sent for content added after the user canceled translation.';
      document.body.appendChild(after);
    })()`)
    await sleep(1600)
    const afterCancelState = JSON.parse(await evalIn(page, `JSON.stringify((() => ({
      fetches: (window.__fetchCalls || []).filter((url) => String(url).endsWith('/responses')).length,
      untranslated: !document.querySelector('#incremental-after-cancel.lector-bilingual-host, #incremental-after-cancel > .lector-bilingual'),
    }))())`) || '{}')
    check('§9.13 cancel stops the incremental observer (no post-cancel requests)',
      afterCancelState.fetches === 0 && afterCancelState.untranslated,
      `state=${JSON.stringify(afterCancelState)}`)
    await evalIn(page, `['incremental-seed','incremental-lazy','incremental-after-cancel'].forEach((id) => document.getElementById(id)?.setAttribute('translate','no'))`)

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
    await selectReveal(`(() => {
      const el = document.querySelectorAll('article p')[2];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) throw new Error('command save-word fixture has no text node');
      const r = document.createRange();
      r.setStart(text, Math.min(6, text.textContent.length));
      r.setEnd(text, Math.min(12, text.textContent.length));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    })()`)
    await fireContentMessage(page, { action: 'lector-command', command: 'save-word' })
    await sleep(300)
    const swAfter = JSON.parse(await evalIn(page, `JSON.stringify((window.__lectorMsgs||[]).filter(m=>m.action==='lector-save-word'))`) || '[]').length
    check('§5 Alt+S command route → save word', swAfter > swBefore, `${swBefore}→${swAfter}`)

    // ---- §A4 blockId whitelist (selector injection guard) ----
    const badId = await fireContentMessage(page, { action: 'lector-jump-to', blockId: 'b0"],.evil[x' })
    check('§A4 malicious blockId rejected (bad-id)', /bad-id/.test(badId), `resp="${String(badId).slice(0, 40)}"`)
    const goodId = await fireContentMessage(page, { action: 'lector-jump-to', blockId: 'b0' })
    check('§A4 valid blockId accepted (ok)', /"ok":true/.test(goodId), `resp="${String(goodId).slice(0, 40)}"`)

    await cleanup()
  } catch (e) {
    console.error('E2E error:', e.stack || e.message)
    // Never let an exception truncate the suite and still report success just
    // because every assertion before the exception passed.
    check('browser E2E completed without uncaught error', false, e.message)
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
