// Chrome Web Store asset capture — shoots REAL production bundles.
//
// Serves dist/ plus purpose-built shells:
//   /shot/:name    1280×800 composer (warm-paper browser chrome mock) with
//                  same-origin iframes: the real article page + the real
//                  side-panel bundle (chrome.* stubbed, zustand state seeded).
//   /article/:name realistic essay page; optionally runs the REAL dist
//                  content.js with a stubbed fetch that returns hand-written
//                  per-paragraph translations (bilingual) / dictionary JSON.
//   /panel/:name   side-panel shell (inline production CSS + /sidepanel.js).
//
// Drives headless Chrome over CDP with REAL mouse events (hit-tested through
// the iframes), captures at deviceScaleFactor 2 and downsamples to exactly
// 1280×800 with sips (24-bit PNG, no alpha — per CWS requirements).
//
// Run:  node scripts/capture-store-assets.mjs [--only 01-chat] [--dsf 1]

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import WebSocket from 'ws'

const DIST = resolve(import.meta.dirname, '..', 'dist')
const OUT = resolve(import.meta.dirname, '..', 'store-assets', 'screenshots')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 1280, H = 800

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const dsf = process.argv.includes('--dsf') ? Number(process.argv[process.argv.indexOf('--dsf') + 1]) : 2

// ---------------------------------------------------------------------------
// Shared content: one believable essay, reused across shots for coherence.
// ---------------------------------------------------------------------------
const TAB_TITLE = 'The Quiet Power of Slow Reading'

const PARAS = [
  'There is a particular kind of silence that arrives when you settle into a long essay with no intention of finishing it quickly. The phone is face-down. The browser tabs are closed. For perhaps the first time all day, your mind is permitted to move at the speed of the sentences rather than the speed of the feed. Researchers who study attention call this state “deep reading,” and they describe it less as a skill than as a habitat — an environment the mind can only inhabit when nothing is competing for it.',
  'The numbers explain the longing. The average knowledge worker now checks some kind of screen every six minutes, and each interruption carries a hidden tax: studies of task-switching suggest it can take more than twenty minutes to return to full concentration. Reading slowly, by contrast, is a small act of resistance. It refuses the premise that every moment must be optimized, monetized, or shared.',
  'Speed has a genuine cost that rarely appears on any dashboard: the loss of serendipity. When you skim, you find exactly what you were looking for — and nothing else. But a reader who lingers, who follows a footnote down an unexpected path, regularly discovers the idea that changes everything. Insight, it turns out, is less often retrieved than stumbled upon.',
  'Librarians have understood this for centuries. The stacks of a great library are deliberately inefficient: you must walk past a thousand books you did not come for. Digital tools are finally rediscovering that principle. A new generation of reading apps now protects the margin — the unhurried space between question and answer — rather than compressing it to nothing.',
  'For language learners, the case is even clearer. Linguists who study vocabulary acquisition talk about “encounter richness”: a word met once in a feed is a stranger, but a word met in context, looked up, saved, and reviewed on a memory curve becomes a permanent resident. The difference is not intelligence. It is patience, arranged systematically.',
  'None of this requires a cabin in the woods. It requires only a boundary — an hour, a commute, a Sunday morning — inside which attention is allowed to be continuous. The essay you are reading now is longer than most things on your feed. That is not an accident. It is an invitation.',
]

// Keyed by paragraph prefix (first 20 chars of normalized text) → tokens.
const TRANSLATION_MAP = {
  'Essay · Attention': ['随笔 · 注意力'],
  'The Quiet Power of': ['慢读的静默力量'],
  'In an economy buil': ['在一个以打断为地基的经济里，注意力成了最稀有的奢侈。一些读者正在把它夺回来——一次一页，从容不迫。'],
  'Elena Marchetti': ['埃莱娜·马凯蒂'],
  'The Meridian Revi': ['《子午线评论》 · 2026 年 9 月 2 日'],
  'Serendipity needs': ['机缘巧合，需要余裕'],
  '“We built machine': ['「我们造出了能即时回答一切问题的机器，却忘了最好的问题，恰恰是那些我们愿意随身携带、悬而不决一阵子的问题。」'],
  'An invitation': ['一份邀请'],
  'Elena Marchetti w': ['埃莱娜·马凯蒂关注注意力、技术与阅读之艺。© 2026《子午线评论》。'],
  'There is a particul': ['有一种特别的安静，会在你打算慢慢读完一篇长文时降临。手机屏幕朝下，浏览器标签一一合上。也许这是一天里第一次，你的思绪被允许以句子的速度、而不是信息流的速度移动。研究注意力的学者把这种状态称为「深度阅读」，并认为它与其说是一种技能，不如说是一片栖息地——只有当没有东西在争夺注意力时，心灵才能栖居其中。'],
  'The numbers explain': ['数字解释了这种渴望。如今知识工作者平均每六分钟就要看一次屏幕，而每次打断都带着一笔隐性税：任务切换研究显示，重新回到全神贯注可能需要二十分钟以上。相比之下，慢读是一种小小的抵抗——它拒绝「每个瞬间都必须被优化、变现或分享」这个前提。'],
  'Speed has a genuine': ['速度有一项很少出现在任何仪表盘上的真实代价：机缘巧合（serendipity）的流失。快速浏览时，你找到的恰恰只是你本来在找的东西——别无其他。而一位流连忘返、顺着脚注走上意外小径的读者，却会不断撞见那个改变一切的想法。说到底，洞见往往不是被检索到的，而是被偶遇的。'],
  'Librarians have unde': ['几个世纪以来，图书馆员都深谙此道。一座伟大图书馆的书架是故意低效的：你必须走过一千本你并非为此而来的书。数字工具终于开始重新发现这条原则——新一代阅读应用开始保护「余裕」，即问题与答案之间那段不慌不忙的空间，而不是把它压缩到荡然无存。'],
  'For language learner': ['对语言学习者来说，道理还要更直白。研究词汇习得的学者谈到「相遇密度」：在信息流里遇见一次的词只是陌生人；而在语境中相遇、查证、收藏、再按记忆曲线复习的词，会成为永久居民。差别不在天资，而在被系统化安排的耐心。'],
  'None of this requir': ['这一切并不需要一间林中小屋。它需要的只是一道边界——一个小时、一段通勤、一个周日清晨——在这道边界之内，注意力被允许连续不断。你正在读的这篇随笔，比信息流里的绝大多数东西都长。这不是意外，而是一份邀请。'],
}

const DICT_JSON = {
  word: 'serendipity',
  phonetic_us: '/ˌserənˈdepəti/',
  phonetic_uk: '/ˌserənˈdepəti/',
  cefr: 'C1',
  frequency: '书面语 · 常见于科学史与人文随笔',
  senses: [
    { pos: 'n.', gloss: '意外发现珍奇事物的运气；机缘巧合', example: 'Insight, it turns out, is less often retrieved than stumbled upon — a kind of serendipity.', example_gloss: '洞见往往不是被检索到的，而是被偶遇的——一种机缘巧合。' },
    { pos: 'n.', gloss: '（科学发现中的）偶然性收获', example: 'Penicillin was pure serendipity: Fleming noticed the mold by accident.', example_gloss: '青霉素纯属机缘巧合：弗莱明是偶然注意到那团霉菌的。' },
  ],
  note: '不可数名词 · 源自 1754 年 Horace Walpole 所造词',
}

const CHAT_QUESTION = '作者说的「抵抗」指什么？慢读和 serendipity 之间又是什么关系？'
const CHAT_ANSWER_TOKENS = [
  '作者把慢读称为「一种小小的抵抗」[b1]，因为它同时拒绝了两件事：\n\n',
  '- **打断经济**：如今知识工作者平均每六分钟看一次屏幕，而每次切换都带着「约二十分钟才能重新专注」的隐性税 [b1]\n',
  '- **即时性崇拜**：慢读拒绝「每个瞬间都必须被优化、变现或分享」的前提 [b1]\n\n',
  '**与 serendipity 的关系**：快速浏览只能找到你本来就在找的东西；而改变一切的想法，往往是在流连与绕路中被「偶遇」到的 [b2]。作者用图书馆书架作类比——它是**故意低效**的，你必须路过一千本你并非为此而来的书；新一代阅读工具要保护的，正是问题与答案之间的这段「余裕」[b3]。\n\n',
  '对语言学习者，作者还引出「相遇密度」：在语境中相遇、查证、收藏、再按记忆曲线复习的词，才会从陌生人变成「永久居民」[b4]。',
]

const now = Date.now()
const DAY = 86_400_000
const SRC = 'https://meridianreview.com/essays/slow-reading'
const VOCAB_SEED = [
  { id: 'v1', word: 'serendipity', translation: '机缘巧合；意外发现的乐趣', context: '…the loss of serendipity. When you skim, you find exactly what you were looking for — and nothing else.', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 9 * DAY, srs: { due: now - 3600_000, interval: 6, ease: 2.5, reps: 3, lapses: 0 } },
  { id: 'v2', word: 'slack', translation: '富余；松弛', context: 'Serendipity needs slack — the unhurried space between question and answer.', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 7 * DAY, srs: { due: now - 7200_000, interval: 2, ease: 2.3, reps: 2, lapses: 1 } },
  { id: 'v3', word: 'hidden tax', translation: '隐性代价', context: '…each interruption carries a hidden tax: studies of task-switching suggest…', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 2 * DAY, srs: { due: now - 60_000, interval: 0, ease: 2.5, reps: 0, lapses: 0 } },
  { id: 'v4', word: 'resident', translation: '（永久）居民', context: '…reviewed on a memory curve becomes a permanent resident.', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 5 * DAY, srs: { due: now - 86_400_000, interval: 4, ease: 2.5, reps: 2, lapses: 0 } },
  { id: 'v5', word: 'habitat', translation: '栖息地', context: '…less as a skill than as a habitat — an environment the mind can only inhabit…', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 6 * DAY, srs: { due: now + 3 * DAY, interval: 3, ease: 2.5, reps: 1, lapses: 0 } },
  { id: 'v6', word: 'stumble upon', translation: '偶然遇上', context: 'Insight… is less often retrieved than stumbled upon.', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 4 * DAY, srs: { due: now + 2 * DAY, interval: 5, ease: 2.6, reps: 4, lapses: 0 } },
  { id: 'v7', word: 'margin', translation: '余裕；边距', context: '…reading apps now protects the margin — the unhurried space…', url: SRC, title: TAB_TITLE, lang: 'en', createdAt: now - 3 * DAY, srs: { due: now + 1 * DAY, interval: 1, ease: 2.4, reps: 1, lapses: 0 } },
]

const BYOK = {
  provider: 'deepseek',
  apiKey: 'sk-lector-demo-9f3Ka7Xf2Q',
  model: 'deepseek-chat',
  baseUrl: '',
  locale: 'zh',
  translation: { targetLanguage: 'zh', displayMode: 'bilingual', autoTranslate: false, concurrency: 5 },
}

const PAGE_BLOCKS = PARAS.map((text, i) => ({ id: `b${i}`, text, domSelector: '' }))

const SSE_FN = `
function __sseEvents(tokens) {
  const enc = new TextEncoder();
  const out = [];
  for (const t of tokens) out.push('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: t }) + '\\n\\n');
  out.push('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } }) + '\\n\\n');
  return out;
}
function __sseCompatEvents(tokens) {
  const enc = new TextEncoder();
  const out = [];
  for (const t of tokens) out.push('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\\n\\n');
  out.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\\n\\n');
  out.push('data: [DONE]\\n\\n');
  return out;
}
function __sseFor(url, tokens) {
  const events = /\\/responses\\b/.test(String(url)) ? __sseEvents(tokens) : __sseCompatEvents(tokens);
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(e)); c.close() } });
}`

// ---------------------------------------------------------------------------
// Article page.
// ---------------------------------------------------------------------------
function articleHtml({ withContentScript }) {
  const paras = PARAS.map((p, i) => `<p${i === 0 ? ' class="drop"' : ''}>${p}</p>`)
  const stub = `
${SSE_FN}
window.__loads = (window.__loads || 0) + 1;
window.__misses = [];
window.chrome = {
  runtime: {
    id: 'testextid',
    sendMessage: (msg, cb) => { if (cb) cb({ ok: true }); return Promise.resolve({ ok: true }) },
    onMessage: { addListener(){}, removeListener(){} },
    getURL: (p) => '/' + String(p).replace(/^\\/+/, ''),
  },
  storage: {
    local: {
      get: (keys, cb) => { const out = { lector_byok_settings: ${JSON.stringify(BYOK)} }; if (cb) cb(out); return Promise.resolve(out) },
      set: (obj, cb) => { if (cb) cb(); return Promise.resolve() },
    },
    onChanged: { addListener(){}, removeListener(){} },
  },
  i18n: { detectLanguage: (t) => ({ isReliable: true, languages: [{ language: /[\\u3400-\\u9fff]/.test(String(t)) ? 'zh' : 'en', percentage: 100 }] }) },
};
window.__fetchCalls = [];
window.fetch = function (url, opts) {
  window.__fetchCalls.push(String(url).slice(0, 100));
  let body = null; try { body = JSON.parse(opts && opts.body || '{}') } catch {}
  const msg = Array.isArray(body && body.messages) ? body.messages[body.messages.length - 1] : null
  const raw = Array.isArray(body && body.input) && body.input.length
    ? String(body.input[body.input.length - 1].content || '')
    : String((msg && msg.content) || '')
  const marker = raw.lastIndexOf('SOURCE_JSON:');
  let source = raw;
  if (marker >= 0) { try { source = JSON.parse(raw.slice(marker + 12).trim()) } catch {} }
  const key = String(source).replace(/\\s+/g, ' ').trim().slice(0, 20);
  if (window.__dictWord) {
    const dict = Object.assign(JSON.parse(${JSON.stringify(JSON.stringify(DICT_JSON))}), { word: window.__dictWord });
    return Promise.resolve({ ok: true, status: 200, body: __sseFor(url, [JSON.stringify(dict)]) });
  }
  const map = ${JSON.stringify(TRANSLATION_MAP)};
  const hit = Object.keys(map).find((k) => key.startsWith(k) || k.startsWith(key));
  if (hit) return Promise.resolve({ ok: true, status: 200, body: __sseFor(url, map[hit]) });
  window.__misses.push(key + ' ← ' + String(source).slice(0, 40));
  return Promise.resolve({ ok: true, status: 200, body: __sseFor(url, ['（译文缺失）']) });
};`
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${TAB_TITLE}</title>
<style>
  :root { --ink:#26211B; --ink-soft:#4A4032; --muted:#7A6E5C; --accent:#8F5E30; --line:#E7DCC6; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#FFFFFF; }
  ::selection { background:#F3E2C4; color:#26211B; }
  body {
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    color: var(--ink-soft); font-size: 16.5px; line-height: 1.78;
    -webkit-font-smoothing: antialiased;
  }
  article { max-width: 640px; margin: 0 auto; padding: 44px 28px 72px; }
  .kicker { font-family: -apple-system, 'PingFang SC', 'Segoe UI', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); margin: 0 0 14px; }
  h1 { font-size: 35px; line-height: 1.18; letter-spacing: -.01em; color: #1F1A14; font-weight: 700; margin: 0 0 14px; }
  .dek { font-size: 19px; line-height: 1.55; color: var(--muted); font-style: italic; margin: 0 0 22px; }
  .byline { display:flex; align-items:center; gap:10px; font-family:-apple-system,'PingFang SC','Segoe UI',sans-serif; font-size:12.5px; color:var(--muted); margin: 0 0 8px; }
  .byline .avatar { width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#9C6B3C,#6B4A24);color:#FFF6EA;display:grid;place-items:center;font-size:11px;font-weight:700; }
  .byline b { color: var(--ink); font-weight: 600; }
  .meta { font-family:-apple-system,'PingFang SC',sans-serif; font-size:11.5px; color:#B4A78E; margin: 0 0 26px; }
  hr.rule { border:none; border-top:1px solid var(--line); margin: 0 0 30px; }
  p { margin: 0 0 22px; }
  p.drop::first-letter { float:left; font-size:56px; line-height:.82; padding:6px 10px 0 0; color:var(--accent); font-weight:700; }
  h2 { font-size: 23px; color:#1F1A14; margin: 38px 0 16px; letter-spacing:-.005em; }
  blockquote { margin: 34px 0; padding: 4px 0 4px 22px; border-left: 3px solid var(--accent); }
  blockquote p { font-size: 21px; line-height: 1.6; font-style: italic; color: #6B4A24; margin: 0; }
  .endmark { color: var(--accent); font-weight: 700; }
  footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--line); font-family:-apple-system,'PingFang SC',sans-serif; font-size: 12px; color: #B4A78E; }
</style></head>
<body>
${withContentScript ? '<script>' + stub + '</script>' : ''}
<article>
  <p class="kicker">Essay · Attention</p>
  <h1>${TAB_TITLE}</h1>
  <p class="dek">In an economy built on interruption, attention has become the rarest luxury. Some readers are taking it back — one unhurried page at a time.</p>
  <div class="byline"><span class="avatar">EM</span><span><b>Elena Marchetti</b></span><span>·</span><span>6 min read</span></div>
  <p class="meta">The Meridian Review · September 2, 2026</p>
  <hr class="rule">
  ${paras.slice(0, 2).join('\n  ')}
  <h2>Serendipity needs slack</h2>
  ${paras[2]}
  <blockquote><p>“We built machines to answer every question instantly, and forgot that the best questions are the ones we carry around unsolved for a while.”</p></blockquote>
  ${paras.slice(3, 5).join('\n  ')}  <h2>An invitation</h2>
  ${paras[5]} <span class="endmark">◆</span>
  <footer>Elena Marchetti writes about attention, technology, and the craft of reading. © 2026 The Meridian Review.</footer>
</article>
${withContentScript ? '<script type="module" src="/content.js"></script>' : ''}
</body></html>`
}

// ---------------------------------------------------------------------------
// Side-panel shell (real bundle; chrome.* stubbed; zustand state seeded).
// ---------------------------------------------------------------------------
function panelHtml({ seed = {}, stubFetch = false }) {
  const PANEL_HTML = readFileSync(resolve(DIST, 'sidepanel', 'index.html'), 'utf8')
  const INLINE_STYLE = [...PANEL_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')

  const fetchStub = `
${SSE_FN}
window.__fetchCalls = [];
window.fetch = function (url, opts) {
  window.__fetchCalls.push(String(url).slice(0, 100));
  let body = null; try { body = JSON.parse(opts && opts.body || '{}') } catch {}
  const msgs = (body && (body.messages || (Array.isArray(body.input) ? body.input : []))) || [];
  const probe = String((msgs[0] && msgs[0].content) || '') + String((msgs[1] && msgs[1].content) || '');
  if (/single word OK|Reply with/i.test(probe)) {
    return Promise.resolve({ ok: true, status: 200, body: __sseFor(url, ['OK']) });
  }
  const streaming = body && body.stream;
  if (!streaming) {
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ data: [ { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-coder' } ] }),
      text: () => Promise.resolve('ok'),
    });
  }
  return Promise.resolve({ ok: true, status: 200, body: __sseFor(url, ${JSON.stringify(CHAT_ANSWER_TOKENS)}) });
};`

  const chromeStub = `
window.__tabsSent = [];
window.__lectorMsgs = [];
window.__runtimeListeners = [];
window.chrome = {
  runtime: {
    lastError: null,
    id: 'testextid',
    onMessage: { addListener(fn){ window.__runtimeListeners.push(fn) }, removeListener(){} },
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {
          lector_byok_settings: ${JSON.stringify(BYOK)},
          lectorHighlights: [],
          lectorVocab: [],
        };
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set: (obj, cb) => { if (cb) cb(); return Promise.resolve() },
      remove: (_k, cb) => { if (cb) cb(); return Promise.resolve() },
    },
    onChanged: { addListener(){}, removeListener(){} },
  },
  tabs: {
    query: (_q, cb) => {
      const tabs = [{ id: 1, url: ${JSON.stringify(SRC)}, title: ${JSON.stringify(TAB_TITLE)}, windowId: 1 }];
      if (cb) cb(tabs);
      return Promise.resolve(tabs);
    },
    sendMessage: (tabId, msg, cb) => {
      window.__lectorMsgs.push({ tabId, ...msg });
      if (msg && msg.action === 'lector-get-page') {
        cb && cb({ page: { title: ${JSON.stringify(TAB_TITLE)}, url: ${JSON.stringify(SRC)}, lang: 'en', blocks: ${JSON.stringify(PAGE_BLOCKS)} } });
      } else if (msg && (msg.action === 'lector-jump-to' || msg.action === 'lector-toggle-bilingual' || msg.action === 'lector-get-selection')) {
        cb && cb({ ok: true, selection: '' });
      } else { cb && cb({}) }
    },
  },
  sidePanel: { open: () => Promise.resolve() },
};`

  const persistSeed = JSON.stringify({ state: { byok: BYOK, hasOpened: true, ...seed }, version: 1 })

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Lector AI</title>
<style>${INLINE_STYLE}</style>
</head>
<body><div id="root"></div>
<script>
${stubFetch ? fetchStub : ''}
${chromeStub}
localStorage.setItem('lector-ai-storage', ${JSON.stringify(persistSeed)});
</script>
<script type="module" src="/sidepanel.js"></script>
</body></html>`
}

// ---------------------------------------------------------------------------
// Composer: warm-paper browser chrome mock + content area.
// ---------------------------------------------------------------------------
function composerHtml({ split }) {
  const icon = (d) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; user-select: none; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { display: flex; flex-direction: column; background: #FFFFFF; font-family: -apple-system, 'PingFang SC', 'Segoe UI', sans-serif; }
  .tabs { height: 40px; flex: none; background: #EDE3D0; display: flex; align-items: flex-end; padding: 0 10px; gap: 8px; }
  .dots { display: flex; gap: 7px; align-self: center; margin-right: 10px; padding-bottom: 2px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot-r { background:#FF5F57; } .dot-y { background:#FEBC2E; } .dot-g { background:#28C840; }
  .tab { display: flex; align-items: center; gap: 8px; width: 268px; height: 32px; padding: 0 12px; background: #FBF6EC; border-radius: 10px 10px 0 0; font-size: 12px; color: #3A3226; }
  .tab .fav { width: 15px; height: 15px; border-radius: 4px; background: linear-gradient(135deg, #9C6B3C, #6B4A24); color: #FFF6EA; font-family: Georgia, serif; font-weight: 700; font-size: 9.5px; display: grid; place-items: center; flex: none; }
  .tab .tt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .tab .x { color: #A99A80; font-size: 13px; line-height: 1; }
  .tab-new { align-self: center; color: #8A7B63; padding: 4px 6px 8px; font-size: 15px; font-weight: 700; }
  .nav { height: 44px; flex: none; background: #FBF6EC; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid #E2D5BB; }
  .nav .btn { color: #8A7B63; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; }
  .nav .btn.dim { opacity: .38; }
  .url { flex: 1; height: 30px; background: #FFFFFF; border: 1px solid #E7DCC6; border-radius: 999px; display: flex; align-items: center; gap: 7px; padding: 0 14px; font-size: 12.5px; color: #4A4032; }
  .url svg { color: #7A6E5C; flex: none; }
  .url .u { white-space: nowrap; overflow: hidden; }
  .url .u b { font-weight: 500; color: #26211B; }
  .ext { display: flex; align-items: center; gap: 10px; padding-left: 4px; }
  .ext .puzzle { color: #B4A78E; }
  .ext .lector { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #E2D5BB; }
  .ext .sep { width: 1px; height: 18px; background: #E2D5BB; }
  .ext .me { width: 26px; height: 26px; border-radius: 50%; background: #C89866; color: #FFF6EA; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
  .content { flex: 1; display: flex; min-height: 0; background: #FFFFFF; }
  .content iframe { border: none; width: 100%; height: 100%; }
  .divider { width: 1px; flex: none; background: #E2D5BB; box-shadow: -6px 0 14px -8px rgba(66,45,16,.18); }
</style></head>
<body>
  <div class="tabs">
    <div class="dots"><span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span></div>
    <div class="tab">
      <span class="fav">M</span><span class="tt">${TAB_TITLE} — The Meridian Review</span><span class="x">×</span>
    </div>
    <div class="tab-new">+</div>
  </div>
  <div class="nav">
    <span class="btn dim">${icon('<path d="M15 6l-6 6 6 6"/>')}</span>
    <span class="btn dim">${icon('<path d="M9 6l6 6-6 6"/>')}</span>
    <span class="btn">${icon('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>')}</span>
    <div class="url">
      ${icon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}
      <span class="u"><b>meridianreview.com</b>/essays/slow-reading</span>
    </div>
    <div class="ext">
      <span class="puzzle">${icon('<path d="M10 4h4v3a1.5 1.5 0 0 0 3 0V4h3v4h-3a1.5 1.5 0 0 0 0 3h3v3h-4v-3a1.5 1.5 0 0 0-3 0v3H7v-4h3a1.5 1.5 0 0 0 0-3H7V4h3z"/>')}</span>
      <img class="lector" src="/icons/icon128.png" alt="">
      <span class="sep"></span>
      <span class="me">W</span>
    </div>
  </div>
  <div class="content">
    <iframe id="art" src="/article/SNAME"></iframe>
    ${split ? '<div class="divider"></div><iframe id="panel" src="/panel/SNAME" style="width:412px;flex:none"></iframe>' : ''}
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// HTTP server.
// ---------------------------------------------------------------------------
function startServer(routes) {
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '').split('?')[0])
    for (const [prefix, body] of routes) {
      if (u === prefix) return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
    }
    let filePath
    try { filePath = resolve(DIST, '.' + u) } catch { return res.writeHead(404).end() }
    if (!filePath.startsWith(DIST)) return res.writeHead(403).end()
    try {
      const data = readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': mime[filePath.slice(filePath.lastIndexOf('.'))] || 'application/octet-stream' })
      res.end(data)
    } catch { res.writeHead(404).end('nf') }
  })
  return new Promise((r) => srv.listen(8791, '127.0.0.1', () => r(srv)))
}

// ---------------------------------------------------------------------------
// CDP driver.
// ---------------------------------------------------------------------------
let msgId = 0
const cdpCall = (ws, method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result) } }
  ws.on('message', h); ws.send(JSON.stringify({ id, method, params }))
})
async function evalIn(ws, expression, awaitPromise = false) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300))
  return r.result.value
}
async function waitFor(ws, expr, { timeout = 15000, poll = 120, label = '' } = {}) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await evalIn(ws, expr) } catch { v = false }
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + (label || expr.slice(0, 80)))
    await sleep(poll)
  }
}
async function mouseClick(ws, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdpCall(ws, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', clicks: 1 })
  }
  await sleep(180)
}
// `rectExpr` must evaluate (inside the given iframe) to {left, top, width, height}
// in IFRAME coordinates; the wrapper converts to page coordinates.
const inFrame = (iframeId, rectExpr) => `(() => {
  const f = document.getElementById('${iframeId}');
  const fb = f.getBoundingClientRect();
  const r = (${rectExpr});
  if (!r) return null;
  return JSON.stringify({ left: fb.left + r.left, top: fb.top + r.top, width: r.width, height: r.height });
})()`
const elRect = (finder) => `(() => { const el = (${finder}); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } })()`
async function rectOf(ws, expr) {
  const v = await evalIn(ws, expr)
  if (!v) return null
  const r = typeof v === 'string' ? JSON.parse(v) : v
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, ...r }
}

async function launchChrome() {
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-shots-'))
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--disable-gpu', '--font-render-hinting=none',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const wsUrl = await new Promise((res) => {
    let buf = ''
    proc.stderr.on('data', (d) => {
      buf += d
      const m = buf.match(/ws:\/\/\S+/)
      if (m) res(m[0])
    })
  })
  return { proc, wsUrl, dbgHttp: 'http://' + wsUrl.replace(/^ws:\/\//, '').replace(/\/.*$/, '') }
}

async function openPage(dbgHttp, path) {
  const { webSocketDebuggerUrl: target } = await (await fetch(dbgHttp + '/json/new?' + encodeURIComponent('http://127.0.0.1:8791' + path), { method: 'PUT' })).json()
  const ws = new WebSocket(target)
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  await cdpCall(ws, 'Runtime.enable')
  await cdpCall(ws, 'Page.enable')
  await cdpCall(ws, 'Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dsf, mobile: false })
  return ws
}

async function capture(ws, file) {
  await sleep(450)
  const shot = await cdpCall(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  const raw = resolve(OUT, '_raw_' + file)
  writeFileSync(raw, Buffer.from(shot.data, 'base64'))
  execFileSync('sips', ['-s', 'format', 'png', '-Z', String(W), raw, '--out', resolve(OUT, file)], { stdio: 'ignore' })
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', resolve(OUT, file)], { encoding: 'utf8' })
  console.log('  📸 ' + file + '  ' + (dims.match(/pixel\w+: \d+/g) || []).join(' '))
  execFileSync('rm', ['-f', raw])
}

// Panel-side helpers (iframe id is always "panel" for these).
const pdoc = (expr) => `document.getElementById('panel').contentDocument` + (expr ? `.${expr}` : '')
const adoc = (expr) => `document.getElementById('art').contentDocument` + (expr ? `.${expr}` : '')

// ---------------------------------------------------------------------------
// Shot definitions.
// ---------------------------------------------------------------------------
const SHOTS = {
  '01-chat': {
    split: true,
    panel: () => panelHtml({ stubFetch: true }),
    contentScript: false,
    drive: async (ws) => {
      await waitFor(ws, `!!${pdoc("querySelector('textarea')")}`, { label: 'panel booted' })
      const ta = await rectOf(ws, inFrame('panel', elRect(`document.getElementById('panel').contentDocument.querySelector('textarea')`)))
      await mouseClick(ws, ta.x, ta.y)
      await cdpCall(ws, 'Input.insertText', { text: CHAT_QUESTION })
      await sleep(250)
      await cdpCall(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await cdpCall(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(ws, `${pdoc('body.innerText')}.includes('永久居民')`, { label: 'assistant reply rendered', timeout: 25000 }).catch(async (e) => {
        console.log('  DIAG text:', await evalIn(ws, `${pdoc('body.innerText')}.slice(0, 300).replace(/\\n/g, ' | ')`).catch(() => 'n/a'))
        console.log('  DIAG fetches:', await evalIn(ws, `JSON.stringify(window.__fetchCalls || ${pdoc('defaultView')}.__fetchCalls || 'none')`).catch(() => 'n/a'))
        console.log('  DIAG msgs:', await evalIn(ws, `JSON.stringify((${pdoc('defaultView')}.__lectorMsgs || []).map(m => m.action))`).catch(() => 'n/a'))
        throw e
      })
      await sleep(1000)
      // Scroll the chat log to bottom so the full reply is in view.
      await evalIn(ws, `(() => { const d = ${pdoc()}; let best = null; for (const el of d.querySelectorAll('div')) { if (el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 100) best = el } if (best) best.scrollTop = best.scrollHeight; return true })()`)
      await sleep(350)
    },
  },

  '02-bilingual': {
    split: false,
    contentScript: true,
    drive: async (ws) => {
      await waitFor(ws, `!!${adoc("querySelector('#lector-ai-fab')")}`, { label: 'FAB mounted' })
      await sleep(700)
      // Toggle the FAB menu and click 翻译整页 (e2e-style synthetic clicks —
      // the drag-aware pointer handlers swallow plain CDP mouse presses).
      await evalIn(ws, `${adoc("querySelector('#lector-ai-fab')")}.click()`)
      await waitFor(ws, `${adoc("querySelectorAll('.lector-fab-item')")}.length > 0`, { label: 'fab menu open' })
      const picked = await evalIn(ws, `(() => { const d = ${adoc()}; const items = [...d.querySelectorAll('.lector-fab-item')]; const it = items.find(i => /翻译整页|翻译本页|Translate/i.test((i.getAttribute('aria-label') || '') + i.textContent)); if (it) { it.click(); return it.getAttribute('aria-label') } return '' })()`)
      console.log('  fab item clicked: ' + picked)
      await waitFor(ws, `(() => { const d = ${adoc()}; const done = [...d.querySelectorAll('.lector-tstatus')].some(t => t.textContent.includes('✓') && /\\d+\\s*段/.test(t.textContent)); const trs = d.querySelectorAll('.lector-bilingual').length; return done && trs >= 6 })()`, { label: 'bilingual complete + done pill', timeout: 40000 }).catch(async (e) => {
        console.log('  DIAG pills:', await evalIn(ws, `JSON.stringify([...${adoc("querySelectorAll('.lector-tstatus')")}].map(t => t.textContent))`).catch(() => 'n/a'))
        console.log('  DIAG pop:', await evalIn(ws, `JSON.stringify([...${adoc("querySelectorAll('.lector-pop, #lector-ai-result')")}].map(e => e.textContent.slice(0, 60)))`).catch(() => 'n/a'))
        console.log('  DIAG fetches:', await evalIn(ws, `JSON.stringify(${adoc('defaultView')}.__fetchCalls || 'stub-gone')`).catch(() => 'n/a'))
        console.log('  DIAG storage:', await evalIn(ws, `JSON.stringify({ chrome: !!(${adoc('defaultView')}.chrome), loads: ${adoc('defaultView')}.__loads, top: ${adoc('defaultView')}.top === ${adoc('defaultView')}.self, href: ${adoc('defaultView')}.location.href })`).catch(() => 'n/a'))
        throw e
      })
      console.log('  map misses:', await evalIn(ws, `JSON.stringify(${adoc('defaultView')}.__misses || [])`).catch(() => 'n/a'))
      await evalIn(ws, `(() => { const f = ${adoc("querySelector('#lector-ai-fab')")}; if (f) f.style.animation = 'none'; return true })()`)
      await sleep(500)
    },
  },

  '03-lookup': {
    split: false,
    contentScript: true,
    drive: async (ws) => {
      await waitFor(ws, `!!${adoc("querySelector('#lector-ai-fab')")}`, { label: 'FAB mounted' })
      await sleep(500)
      // Put the serendipity paragraph mid-viewport and select the word.
      await evalIn(ws, `(() => { const d = ${adoc()}; const p = [...d.querySelectorAll('article p')].find(el => el.textContent.includes('loss of serendipity')); p.scrollIntoView({ block: 'center' }); const walker = d.createTreeWalker(p, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const i = node.textContent.indexOf('serendipity'); if (i >= 0) { const r = d.createRange(); r.setStart(node, i); r.setEnd(node, i + 11); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); return 'selected' } } return 'not-found' })()`)
      await sleep(250)
      await evalIn(ws, `(() => { const w = ${adoc('defaultView')}; const el = w.getSelection().anchorNode?.parentElement || ${adoc('body')}; el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true })()`)
      await waitFor(ws, `!!${adoc("getElementById('lector-ai-toolbar')")}`, { label: 'selection toolbar' })
      await evalIn(ws, `${adoc('defaultView')}.__dictWord = 'serendipity'`)
      const clicked = await evalIn(ws, `(() => { const d = ${adoc()}; const b = [...d.querySelectorAll('#lector-ai-toolbar button')].find(x => /翻译|Translate/i.test(x.textContent + ' ' + (x.title || ''))); if (b) { b.click(); return true } return false })()`)
      if (!clicked) throw new Error('translate button not found on toolbar')
      await waitFor(ws, `(() => { const c = ${adoc("querySelector('.lector-dict')")}; return !!c && c.textContent.includes('机缘巧合') })()`, { label: 'dict card rendered', timeout: 20000 }).catch(async (e) => {
        console.log('  DIAG pop:', await evalIn(ws, `JSON.stringify([...${adoc("querySelectorAll('.lector-pop, #lector-ai-result')")}].map(e => e.className + ' :: ' + e.textContent.slice(0, 80)))`).catch(() => 'n/a'))
        console.log('  DIAG fetches:', await evalIn(ws, `JSON.stringify(${adoc('defaultView')}.__fetchCalls || 'gone')`).catch(() => 'n/a'))
        console.log('  DIAG toolbar:', await evalIn(ws, `!!${adoc("getElementById('lector-ai-toolbar')")}`).catch(() => 'n/a'))
        throw e
      })
      await evalIn(ws, `(() => { const d = ${adoc()}; const c = d.querySelector('.lector-dict'); if (!c) return; const r = c.getBoundingClientRect(); const vw = d.documentElement.clientWidth, vh = d.documentElement.clientHeight; if (r.bottom > vh - 10) c.style.top = Math.max(10, vh - r.height - 10) + 'px'; if (r.right > vw - 10) c.style.left = Math.max(10, vw - r.width - 14) + 'px'; return true })()`)
      await sleep(450)
    },
  },

  '04-review': {
    split: true,
    panel: () => panelHtml({ seed: { vocab: VOCAB_SEED } }),
    contentScript: false,
    drive: async (ws) => {
      await waitFor(ws, `${adoc("querySelectorAll('article p')")}.length >= 6`, { label: 'article ready' })
      // Park the article at the vocabulary paragraph for context.
      await evalIn(ws, `(() => { const d = ${adoc()}; [...d.querySelectorAll('article p')][4].scrollIntoView({ block: 'center' }); return true })()`)
      await waitFor(ws, `!!${pdoc("querySelector('.tab-item')")}`, { label: 'panel booted' })
      await evalIn(ws, `(() => { const d = ${pdoc()}; const t = [...d.querySelectorAll('.tab-item')].find(x => /词汇|单词|生词|Vocab/i.test(x.textContent)); if (t) { t.click(); return true } return false })()`)
      await waitFor(ws, `${pdoc('body.innerText')}.includes('serendipity')`, { label: 'vocab list rendered' })
      await evalIn(ws, `(() => { const d = ${pdoc()}; const b = [...d.querySelectorAll('button')].find(x => x.offsetParent !== null && /到期|复习|due|review/i.test(x.textContent)); if (b) { b.click(); return true } return false })()`)
      await sleep(400)
      await evalIn(ws, `(() => { const d = ${pdoc()}; const b = [...d.querySelectorAll('button')].find(x => x.offsetParent !== null && /显示译文|显示释义|Show (translation|definition)/i.test(x.textContent)); if (b) { b.click(); return true } return false })()`)
      await sleep(350)
    },
  },

  '05-byok': {
    split: true,
    panel: () => panelHtml({ stubFetch: true }),
    contentScript: false,
    drive: async (ws) => {
      await waitFor(ws, `!!${pdoc("querySelector('.icon-btn')")}`, { label: 'panel booted' })
      // Open settings; retry the gear click until the BYOK form is really there
      // (the chat header also says "DeepSeek", so check a settings-only string).
      for (let i = 0; i < 8; i++) {
        await evalIn(ws, `(() => { const d = ${pdoc()}; const b = [...d.querySelectorAll('button[aria-label]')].find(x => /自带密钥|Bring Your Own Key/i.test(x.getAttribute('aria-label'))); if (b) { b.click(); return true } return false })()`)
        const opened = await evalIn(ws, `(() => { const d = ${pdoc()}; return [...d.querySelectorAll('button')].some(x => x.offsetParent !== null && /测试连接|Test connection/i.test(x.textContent)) })()`)
        if (opened) break
        await sleep(400)
      }
      await waitFor(ws, `(() => { const d = ${pdoc()}; return [...d.querySelectorAll('button')].some(x => x.offsetParent !== null && /测试连接|Test connection/i.test(x.textContent)) })()`, { label: 'settings rendered', timeout: 20000 })
      await evalIn(ws, `(() => { const d = ${pdoc()}; const b = [...d.querySelectorAll('button')].find(x => x.offsetParent !== null && /测试连接|Test connection/i.test(x.textContent)); if (b) { b.click(); return true } return false })()`)
      await waitFor(ws, `(() => { const d = ${pdoc()}; return [...d.querySelectorAll('.text-success, .text-danger')].some(e => e.offsetParent !== null && e.textContent.trim().length > 0) })()`, { label: 'connection success', timeout: 20000 }).catch(async (e) => {
        console.log('  DIAG result:', await evalIn(ws, `JSON.stringify([...${pdoc("querySelectorAll('.text-success, .text-danger')")}].map(x => x.textContent.trim().slice(0, 60)))`).catch(() => 'n/a'))
        console.log('  DIAG buttons:', await evalIn(ws, `JSON.stringify([...${pdoc("querySelectorAll('button')")}].filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 18)).slice(0, 20))`).catch(() => 'n/a'))
        console.log('  DIAG fetches:', await evalIn(ws, `JSON.stringify(${pdoc('defaultView')}.__fetchCalls || 'gone')`).catch(() => 'n/a'))
        throw e
      })
      // Bring the BYOK block (provider / key / model / test result) back to the
      // top of the panel — clicking deep in the form scrolls the container.
      await evalIn(ws, `(() => { const d = ${pdoc()}; for (const el of d.querySelectorAll('div')) { if (el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 100) el.scrollTop = 0 } d.documentElement.scrollTop = 0; d.body.scrollTop = 0; return true })()`)
      await sleep(450)
    },
  },
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const names = only ? [only] : Object.keys(SHOTS)
const routes = []
for (const name of names) {
  const def = SHOTS[name]
  routes.push([`/shot/${name}`, composerHtml({ split: def.split }).replaceAll('SNAME', name)])
  routes.push([`/article/${name}`, articleHtml({ withContentScript: def.contentScript })])
  if (def.panel) routes.push([`/panel/${name}`, def.panel()])
}

const srv = await startServer(routes)
const { proc, wsUrl, dbgHttp } = await launchChrome()
console.log('workbench up — ' + wsUrl)

try {
  for (const name of names) {
    console.log('▶ ' + name)
    const ws = await openPage(dbgHttp, `/shot/${name}`)
    try {
      await waitFor(ws, `document.readyState === 'complete'`, { label: 'page load' })
      await SHOTS[name].drive(ws)
      await capture(ws, `${name}.png`)
    } catch (e) {
      console.log('  ❌ ' + name + ': ' + e.message)
      try { await capture(ws, `${name}.FAILED.png`) } catch {}
    }
    ws.close()
  }
} finally {
  proc.kill('SIGTERM')
  srv.close()
}
