// Theme picker visual walkthrough at side-panel width.
// Usage: NODE_ENV=development npm run dev &  # then note the printed port
//        node scripts/theme-preview-shots.mjs [port=5174]
// Seeds zustand localStorage per palette (settings view + one chat shot in
// 靛墨), screenshots into /tmp/theme-shots. Dev-only — mirrors the seed style
// of take-preview-shots.mjs.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const outDir = '/tmp/theme-shots'
const base = `http://localhost:${process.argv[2] || '5174'}/src/sidepanel/index.html`
mkdirSync(outDir, { recursive: true })

const now = Date.now()
const mkSrs = (dueInDays, interval, reps) => ({ due: now + dueInDays * 86400000, interval, ease: 2.5, reps })
const seed = (palette, theme) => ({
  state: {
    byok: { locale: 'zh', theme, palette },
    sessions: [{
      id: 's1', title: 'The Attention Mechanism, Explained', url: 'https://example.com/attention',
      createdAt: now - 7200e3,
      messages: [
        { id: 'm1', role: 'user', content: '总结这篇文章的三个要点。' },
        { id: 'm2', role: 'assistant', content: '## 摘要\n\n文章追溯了注意力机制如何成为现代语言模型的核心原语 [0]。\n\n- Query、Key、Value 向量让每个 token 能"查看"其他所有 token [1]。\n- 多头注意力并行运行多组这样的查询 [2]。\n\n> "Attention is all you need" —— 标题最终成为了字面事实 [3]。' },
      ],
    }],
    highlights: [
      { id: 'h1', text: 'Attention is not merely a metaphor — it is a differentiable lookup table.', note: '', quote: '', url: 'https://example.com/a', title: 'The Attention Mechanism', blockId: 'b3', createdAt: now - 3600e3 },
    ],
    vocab: [
      { id: 'v1', word: 'serendipity', translation: '机缘巧合', context: '…a moment of pure serendipity…', url: 'https://example.com/a', title: 'T', lang: 'en', createdAt: now - 86400e3, srs: mkSrs(0, 1, 2) },
      { id: 'v2', word: 'recalcitrant', translation: '倔强的', context: '…the recalcitrant dataset…', url: 'https://example.com/b', title: 'T', lang: 'en', createdAt: now - 86400e3, srs: mkSrs(0, 3, 4) },
    ],
    templates: [], glossary: [], sentences: [], translationHistory: [], hasOpened: true,
  },
  version: 1,
})

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 2 })

const run = async (name, palette, theme, shotChat) => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate((s) => {
    localStorage.setItem('lector-ai-storage', JSON.stringify(s))
  }, seed(palette, theme))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  if (shotChat) await page.screenshot({ path: path.join(outDir, `${name}-chat.png`) })
  const gear = page.locator('header button[aria-label]').last()
  await gear.click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(outDir, `${name}-settings.png`) })
}

await run('paper', 'paper', 'light')
await run('ink', 'ink', 'light', true)
await run('moss', 'moss', 'light')
await run('dusk', 'dusk', 'light')
await run('sea', 'sea', 'light')
await run('ink-dark', 'ink', 'dark')

await browser.close()
console.log('shots in', outDir)
