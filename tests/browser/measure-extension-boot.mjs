// Measure side-panel first-open timing inside a REAL extension context.
//
// Branded Chrome removed --load-extension, but Playwright's Chromium still
// honors it: dist/ loads as a real unpacked extension, and the panel page runs
// with REAL chrome.* APIs (storage IPC, tabs, runtime) on the real
// chrome-extension:// origin. Fresh temp profile per run = first-install
// condition (empty chrome.storage AND empty localStorage).
//
// Run: node tests/browser/measure-extension-boot.mjs

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const DIST = resolve(import.meta.dirname, '..', '..', 'dist')
const RUNS = Number(process.env.RUNS || 3)

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
`

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
  const js = performance.getEntriesByType('resource').find((r) => r.name.endsWith('sidepanel.js'))
  return JSON.stringify({
    origin: location.origin,
    bundleResponseEndMs: js ? Math.round(js.responseEnd) : null,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadEventEndMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    reactCommitMs: window.__boot?.reactCommit ?? null,
    rootChildren: window.__boot?.rootChildren ?? null,
    longTasks: (window.__boot?.longTasks || []).slice(0, 10),
  })
})()`

function fmt(m) {
  if (!m || !m.origin?.startsWith('chrome-extension')) return '  ' + JSON.stringify(m)
  const s = `bundle=${m.bundleResponseEndMs}ms dcl=${m.domContentLoadedMs}ms fcp=${m.fcpMs}ms load=${m.loadEventEndMs}ms REACT_COMMIT=${m.reactCommitMs}ms (root children: ${m.rootChildren})`
  const lt = m.longTasks?.length ? '\n    longTasks(start+dur ms): ' + m.longTasks.map((t) => `${t.start}+${t.dur}`).join(', ') : ''
  return '  ' + s + lt
}

async function once(label) {
  const profile = mkdtempSync(resolve(tmpdir(), 'lector-ext-measure-'))
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    // Plain headless uses the headless shell, which drops --load-extension;
    // the full Chromium build with new headless loads unpacked extensions.
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run', '--no-default-browser-check',
    ],
  })
  try {
    // The service worker target appears once the extension registers.
    let extId = null
    for (let i = 0; i < 40 && !extId; i++) {
      for (const w of ctx.serviceWorkers()) {
        const m = w.url().match(/^chrome-extension:\/\/([a-p]{32})\//)
        if (m) extId = m[1]
      }
      if (!extId) await sleep(250)
    }
    if (!extId) throw new Error('extension did not load (no service worker target)')
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
    await page.addInitScript(PROBE)
    await page.goto(`chrome-extension://${extId}/sidepanel/index.html`)
    let m
    const start = Date.now()
    while (Date.now() - start < 20000) {
      m = JSON.parse(await page.evaluate(READ))
      if (m.reactCommitMs != null) break
      await sleep(100)
    }
    console.log(`\n=== ${label} (ext ${extId.slice(0, 8)}…) ===`)
    console.log(fmt(m))
    for (const e of errors) console.log('  pageerror:', e)
    return { page, ctx }
  } catch (e) {
    await ctx.close()
    throw e
  }
}

const keep = await once(`run 1 COLD (real chrome-extension origin, fresh profile)`)
try {
  const page = keep.page
  // Simulate a HEAVY user profile: zustand persist rehydrates this
  // synchronously during module eval (store creation) — does a multi-MB
  // localStorage blob delay React's first commit (boot shell duration)?
  if (process.env.SEED_MB) {
    const mb = Number(process.env.SEED_MB)
    const sessions = Array.from({ length: Math.round(mb * 40) }, (_, i) => ({
      id: 's' + i,
      title: 'Session ' + i + ' — a reasonably long session title about an article',
      createdAt: Date.now(),
      messages: Array.from({ length: 12 }, (_, j) => ({
        role: j % 2 ? 'assistant' : 'user',
        content: 'Trust matters. Consistency builds confidence. '.repeat(8) + j,
      })),
    }))
    const vocab = Array.from({ length: 2000 }, (_, i) => ({
      id: 'v' + i, word: 'word' + i, translation: '翻译' + i,
      context: 'A sentence using the word in context. '.repeat(3),
      url: 'https://example.com/article/' + i, title: 'Article ' + i,
      lang: 'en', createdAt: 1,
      srs: { due: 1, interval: i, ease: 2.5, reps: 3, lapses: 0 },
    }))
    const blob = JSON.stringify({ state: { byok: { provider: 'openai', apiKey: 'sk-x', model: 'm', baseUrl: '', locale: 'en' }, sessions, highlights: [], vocab, templates: [], glossary: [], sentences: [], translationHistory: [], hasOpened: true }, version: 0 })
    await page.evaluate((v) => localStorage.setItem('lector-ai-storage', v), blob)
    console.log(`\nseeded localStorage: ${(blob.length / 1024 / 1024).toFixed(1)} MB`)
    console.log('\n=== HEAVY-PROFILE navigation (reload with seeded data) ===')
    await page.reload()
    let h
    const start = Date.now()
    while (Date.now() - start < 30000) {
      h = JSON.parse(await page.evaluate(READ))
      if (h.reactCommitMs != null) break
      await sleep(100)
    }
    console.log(fmt(h))
  }
  // Warm reload in the same context.
  await page.reload()
  let m
  const start = Date.now()
  while (Date.now() - start < 20000) {
    m = JSON.parse(await page.evaluate(READ))
    if (m.reactCommitMs != null) break
    await sleep(100)
  }
  console.log('\n=== WARM (reload same page) ===')
  console.log(fmt(m))
} finally {
  await keep.ctx.close()
}
for (let r = 2; r <= RUNS - 1; r++) await once(`run ${r} COLD`)
process.exit(0)
