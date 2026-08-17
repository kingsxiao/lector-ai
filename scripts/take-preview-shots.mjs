// Preview screenshot walker for Lector AI sidepanel.
// Usage: node /tmp/lector-preview-shots.mjs <outDir> [baseUrl]
// Drives the real dev-server UI through every view and saves full-viewport
// screenshots named <outDir>/<view>.png.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || 'preview/after'
const base = process.argv[3] || 'http://localhost:5188/src/sidepanel/index.html'
mkdirSync(outDir, { recursive: true })

const now = Date.now()
const day = 86400000
const mkSrs = (dueInDays, interval, reps) => ({ due: now + dueInDays * day, interval, ease: 2.5, reps })
const seed = {
  state: {
    byok: { locale: 'zh' },
    sessions: [{
      id: 's1', title: 'The Attention Mechanism, Explained', url: 'https://example.com/attention',
      createdAt: now - 2 * 3600e3,
      messages: [
        { id: 'm1', role: 'user', content: 'Summarize this article in three bullet points.' },
        { id: 'm2', role: 'assistant', content: "## Summary\n\nThe article traces how **attention** became the core primitive of modern language models [0].\n\n- Query, key and value vectors let each token *look at* every other token [1].\n- Multi-head attention runs several such lookups in parallel, each head learning a different relation [2].\n- The 2017 Transformer paper removed recurrence entirely, trading memory for parallelism [3].\n\n> \"Attention is all you need\" — the title turned out to be literal [4].\n\nSee `softmax(QK^T / √d)` — the scaled dot-product at the heart of it [1]." },
        { id: 'm3', role: 'user', content: 'What does the scaling factor do?' },
        { id: 'm4', role: 'assistant', content: "The `√d` divisor keeps the dot products from growing with dimensionality [1]. Without it, softmax saturates and gradients vanish — training stalls. It's a one-character fix with outsized impact [2]." },
      ],
    }, {
      id: 's2', title: '斯多葛主义入门', url: 'https://zh.example.com/stoicism', createdAt: now - day, messages: [],
    }, {
      id: 's3', title: 'Why Rust compile times are slow', url: 'https://example.com/rust', createdAt: now - 2 * day, messages: [],
    }],
    highlights: [
      { id: 'h1', text: 'Attention is not merely a metaphor — it is a differentiable lookup table.', note: '', quote: '…the authors argue that attention is not merely a metaphor…', url: 'https://example.com/attention', title: 'The Attention Mechanism, Explained', blockId: 'b3', createdAt: now - 3600e3 },
      { id: 'h2', text: 'The scarcest resource in learning is not information but attention.', note: '与《深度工作》观点呼应', quote: '…Newport concludes that the scarcest resource…', url: 'https://example.com/deep-work', title: 'Deep Work, Revisited', createdAt: now - 5 * 3600e3 },
      { id: 'h3', text: 'Compound interest applies to knowledge as it does to capital.', note: '', quote: '…Munger liked to say compound interest applies to knowledge…', url: 'https://example.com/munger', title: 'Munger on Learning', createdAt: now - 2 * day },
    ],
    vocab: [
      { id: 'v1', word: 'serendipity', translation: '意外发现珍奇事物的运气；机缘巧合', context: '…a moment of pure serendipity in the archives…', url: 'https://example.com/a', title: 'The Attention Mechanism, Explained', lang: 'en', createdAt: now - 3 * day, srs: mkSrs(0, 1, 2) },
      { id: 'v2', word: 'recalcitrant', translation: '倔强的；不服从的', context: '…the recalcitrant dataset refused to converge…', url: 'https://example.com/b', title: 'Debugging Neural Nets', lang: 'en', createdAt: now - 2 * day, srs: mkSrs(0, 3, 4) },
      { id: 'v3', word: 'ephemeral', translation: '短暂的；瞬息即逝的', context: '…fame in the age of feeds is ephemeral…', url: 'https://example.com/c', title: 'Digital Attention', lang: 'en', createdAt: now - day, srs: mkSrs(2, 5, 6) },
      { id: 'v4', word: 'ubiquitous', translation: '无处不在的', context: '…smartphones are ubiquitous in modern classrooms…', url: 'https://example.com/d', title: 'EdTech Notes', lang: 'en', createdAt: now - day, srs: mkSrs(7, 10, 8) },
    ],
    glossary: [
      { id: 'g1', source: 'LLM', target: '大语言模型', note: '', enabled: true, createdAt: now },
      { id: 'g2', source: 'RAG', target: '检索增强生成', note: '保持缩写', enabled: true, createdAt: now },
      { id: 'g3', source: 'attention', target: '注意力', note: '', enabled: false, createdAt: now },
    ],
    sentences: [{
      id: 'sn1', sentence: 'The dog that I adopted last year has become the center of my universe.', translation: '我去年收养的那只狗已经成为我宇宙的中心。',
      analysis: "## 原句\nThe dog that I adopted last year has become the center of my universe.\n\n## 翻译\n我去年收养的那只狗已经成为我宇宙的中心。\n\n## 句子结构\n主语 `The dog` + 定语从句 `that I adopted last year` + 谓语 `has become` + 表语 `the center of my universe`\n\n## 关键词与搭配\n- adopt a dog 收养狗\n- the center of my universe 我的宇宙中心\n\n## 难度\nB1\n\n## 语言点\n定语从句 `that I adopted last year` 修饰先行词 `dog`，关系代词 that 在从句中作 adopted 的宾语。",
      keywords: ['adopt a dog', 'the center of my universe'], quote: '…The dog that I adopted last year…', url: 'https://example.com/a', title: 'The Attention Mechanism, Explained', lang: 'en', cefr: 'B1', createdAt: now - day, srs: mkSrs(0, 1, 1),
    }],
    translationHistory: [
      { id: 't1', source: 'Attention is all you need.', target: '注意力就是你所需要的一切。', sourceLang: 'en', targetLang: 'zh-CN', kind: 'selection', url: 'https://example.com/attention', createdAt: now - 1800e3 },
      { id: 't2', source: 'The quick brown fox jumps over the lazy dog.', target: '敏捷的棕色狐狸跳过了懒惰的狗。', sourceLang: 'en', targetLang: 'zh-CN', kind: 'page', url: 'https://example.com/fox', createdAt: now - 7200e3 },
    ],
    hasOpened: true,
  },
  version: 0,
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 2 })
await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate((s) => {
  localStorage.setItem('lector-ai-storage', JSON.stringify(s))
}, seed)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) })
const clickTab = async (label) => {
  await page.click(`nav.tab-bar button:has-text("${label}")`)
  await page.waitForTimeout(450)
}

// 1. chat empty state (fresh visit, no session active)
await shot('01-chat-empty')

// 2. open More menu
await clickTab('更多')
await shot('02-more-menu')
// go to library via menu
await page.click('[role="menu"] [role="menuitem"]:has-text("历史记录")')
await page.waitForTimeout(500)
await shot('03-library')
// open the first session → chat with messages
await page.click('div[role="button"]:has-text("The Attention Mechanism")')
await page.waitForTimeout(600)
await shot('04-chat-messages')

// 3. vocab
await clickTab('生词')
await shot('05-vocab')
// reveal one translation
await page.click('button:has-text("显示释义")')
await page.waitForTimeout(300)
await shot('06-vocab-revealed')

// 4. sentences + analysis
await clickTab('句库')
await shot('07-sentences')
await page.click('button:has-text("显示讲解")')
await page.waitForTimeout(400)
await shot('08-sentence-analysis')

// 5. highlights
await clickTab('高亮')
await shot('09-highlights')

// 6. settings (top + provider grid + translation card)
const gear = page.locator('header button[aria-label]').last()
await gear.click()
await page.waitForTimeout(500)
await shot('10-settings-top')
const scrollSettings = async (y) => {
  await page.evaluate((yy) => {
    const sc = [...document.querySelectorAll('div')].find((d) => d.classList.contains('overflow-y-auto') && d.scrollHeight > d.clientHeight)
    if (sc) sc.scrollTop = yy
  }, y)
  await page.waitForTimeout(350)
}
await scrollSettings(430)
await shot('11-settings-providers')
await scrollSettings(1500)
await shot('12-settings-translation')

await browser.close()
console.log(`DONE → ${outDir}`)
