// Focused screenshot walker for the 0.6 UX batch: message copy, library
// rename/export, vocab TSV export, settings backup section, history source
// links. Same seeding approach as take-preview-shots.mjs.
// Usage: node scripts/ux-feature-shots.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || 'preview/ux'
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
        { id: 'm2', role: 'assistant', content: "## Summary\n\n- Query, key and value vectors let each token look at every other token [1].\n- Multi-head attention runs several lookups in parallel [2].\n- The 2017 Transformer paper removed recurrence entirely [3]." },
        { id: 'm3', role: 'user', content: 'What does the scaling factor do?' },
        { id: 'm4', role: 'assistant', content: "The `√d` divisor keeps the dot products from growing with dimensionality [1]. Without it, softmax saturates and gradients vanish." },
      ],
    }, {
      id: 's2', title: '斯多葛主义入门', url: 'https://zh.example.com/stoicism', createdAt: now - day, messages: [],
    }],
    highlights: [],
    vocab: [
      { id: 'v1', word: 'serendipity', translation: '机缘巧合', context: '…a moment of pure serendipity…', url: 'https://example.com/a', title: 'T', lang: 'en', createdAt: now - 3 * day, srs: mkSrs(2, 5, 6) },
    ],
    glossary: [],
    sentences: [],
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
const openMoreItem = async (label) => {
  await clickTab('更多')
  await page.click(`[role="menu"] [role="menuitem"]:has-text("${label}")`)
  await page.waitForTimeout(500)
}

// --- 1. chat: hover assistant message → copy button; hover user message ---
await openMoreItem('历史记录')
await page.click('div[role="button"]:has-text("The Attention Mechanism")')
await page.waitForTimeout(600)
await page.hover('div.bg-accent') // user bubble's group
await page.waitForTimeout(250)
await shot('01-chat-user-copy')
await page.hover('div.bg-surface.border.border-line') // assistant bubble
await page.waitForTimeout(250)
await shot('02-chat-assistant-copy')

// --- 2. library: hover row (rename/export/delete), then rename input ---
await openMoreItem('历史记录')
await page.hover('div[role="button"]:has-text("The Attention Mechanism")')
await page.waitForTimeout(250)
await shot('03-library-hover')
await page.click('button[aria-label="重命名会话"]')
await page.waitForTimeout(300)
await shot('04-library-renaming')

// --- 3. vocab: export TSV in the action bar ---
await clickTab('生词')
await shot('05-vocab-export-bar')

// --- 4. settings: backup & restore section (bottom of the list) ---
const gear = page.locator('header button[aria-label]').last()
await gear.click()
await page.waitForTimeout(500)
await page.evaluate(() => {
  const sc = [...document.querySelectorAll('div')].find(
    (d) => d.classList.contains('overflow-y-auto') && d.scrollHeight > d.clientHeight
  )
  if (sc) sc.scrollTop = sc.scrollHeight
})
await page.waitForTimeout(400)
await shot('06-settings-backup')

// --- 5. translation history: host link + row actions on hover ---
await openMoreItem('翻译历史')
await page.hover('div.group.row:has-text("Attention is all you need")')
await page.waitForTimeout(250)
await shot('07-history-row')

await browser.close()
console.log(`DONE → ${outDir}`)
