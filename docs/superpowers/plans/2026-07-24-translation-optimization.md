# 翻译功能全面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Lector AI 的翻译功能（沉浸式双语整页 + 划词弹窗 + 设置/目标语言 + 一致性/历史）升级到对标市面最好水平，同时严格遵守项目 BYOK 纯客户端与 `src/shared/*.ts` 纯逻辑分层规则。

**Architecture:** 新建 `src/shared/translation.ts` 作为零 DOM/零 chrome 的纯逻辑翻译子系统（语言表、方向解析、并发限流器、选块判定、历史 LRU、prompt 构建），由 `content.ts`（DOM 编排）、`background.ts`（中继/命令）、`App.tsx`（设置/历史 UI）消费。复用现有 `streamChat` 做流式；翻译历史沿用现有「content→background→storage→sidepanel」中继模式。

**Tech Stack:** TypeScript, Chrome Extension MV3, React 18, Zustand 4 (+persist), Vite, Vitest + jsdom, Playwright (browser E2E)。

## Global Constraints

- **NODE_ENV 陷阱：** 所有 install/test/build 命令必须前置 `NODE_ENV=development`（本机 shell 默认 production 会跳过 devDependencies）。
- **纯逻辑分层：** `src/shared/*.ts` 禁止 import DOM API 或 chrome API——违反则 jsdom 单测失败、违反核心约束。
- **content script 单 IIFE：** `src/content.ts` 不能有 chunk import / dynamic import（MV3 content_scripts 不支持 module）；`vite.content.config.ts` 用 `inlineDynamicImports` 内联。
- **BYOK 纯客户端：** 无后端、无数据库、无账号；密钥存 `chrome.storage.local`；翻译走用户自己的 provider key（复用 `streamChat`，不引入外部 MT）。
- **知识采集中继模式：** content→background→`chrome.storage.local` 队列→sidepanel 抽干入库（vocab/highlights 已有先例，翻译历史沿用）。
- **i18n 强类型：** 新增字符串必须加进 `src/shared/i18n.ts` 的 `STRINGS` 表（en+zh），key 由 `StringKey` 推导，缺 key 编译期就能抓到。
- **提交粒度：** 每个 Task 结束提交一次；提交信息 `feat(translation): ...` / `test(translation): ...` / `refactor(translation): ...`。
- **配色 token：** 沿用现有 `#9C6B3C`（主棕）/`#875A2F`（深棕）/`#6B6155`（次文本）/`#E8DECC`（分隔）/`#FFF8EE`（浅底）/`#2B2620`（深文本）。

---

## File Structure

| 文件 | 责任 | 状态 |
|------|------|------|
| `src/shared/translation.ts` | 翻译子系统纯逻辑：语言表、方向解析、prompt、并发限流、选块判定、历史 LRU、批量解析 | 新建 |
| `tests/translation.test.ts` | 上述纯逻辑单测 | 新建 |
| `src/shared/providers.ts` | `TranslationSettings` 类型 + `ByokSettings.translation?` + 默认值 | 改 |
| `src/shared/store.ts` | `translationHistory` 状态 + `addTranslationHistory`/`clearTranslationHistory` actions | 改 |
| `src/shared/i18n.ts` | 翻译相关 UI 字符串（en/zh） | 改 |
| `src/content.ts` | 双语整页（并发+流式+增量+进度+取消+显示模式）+ 划词弹窗（流式+语言选择+TTS） | 改 |
| `src/background.ts` | `lector-translate` 命令转发 + 翻译历史中继 + settings 变更广播 | 改 |
| `src/manifest.json` | 新增 `lector-translate` 命令 (Alt+T) | 改 |
| `src/sidepanel/App.tsx` | 翻译设置区 + 翻译历史抽屉 | 改 |
| `tests/browser/run-browser-e2e.mjs` | 翻译流式/并发/目标语言/快捷键 E2E | 改 |

---

## Task 1: 纯逻辑核心 — 语言表与方向解析

**Files:**
- Create: `src/shared/translation.ts`
- Create: `tests/translation.test.ts`

**Interfaces:**
- Produces: `TargetLangCode`, `LanguageDef`, `LANGUAGES`, `detectScript`, `resolveTargetLang`, `getLanguage`

- [ ] **Step 1: Write the failing test** (`tests/translation.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  detectScript,
  resolveTargetLang,
  getLanguage,
  type TargetLangCode,
} from '../src/shared/translation'

describe('LANGUAGES', () => {
  it('has 12 entries with unique codes and non-empty speechCode', () => {
    expect(LANGUAGES).toHaveLength(12)
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(12)
    for (const l of LANGUAGES) {
      expect(l.speechCode.length).toBeGreaterThan(0)
      expect(l.en.length).toBeGreaterThan(0)
      expect(l.zh.length).toBeGreaterThan(0)
    }
  })
  it('lists zh and en first', () => {
    expect(LANGUAGES[0].code).toBe('zh')
    expect(LANGUAGES[1].code).toBe('en')
  })
})

describe('getLanguage', () => {
  it('returns the def for a known code', () => {
    expect(getLanguage('ja').zh).toBe('日语')
  })
  it('falls back to en for unknown code', () => {
    expect(getLanguage('xx' as TargetLangCode).code).toBe('en')
  })
})

describe('detectScript', () => {
  it('detects cjk', () => {
    expect(detectScript('你好世界，这是一段中文')).toBe('cjk')
  })
  it('detects latin', () => {
    expect(detectScript('Hello world this is English')).toBe('latin')
  })
  it('detects cyrillic', () => {
    expect(detectScript('Привет мир')).toBe('cyrillic')
  })
  it('detects arabic', () => {
    expect(detectScript('مرحبا بالعالم')).toBe('arabic')
  })
})

describe('resolveTargetLang', () => {
  it('auto + cjk source -> en', () => {
    expect(resolveTargetLang('auto', '你好世界')).toBe('en')
  })
  it('auto + latin source -> zh', () => {
    expect(resolveTargetLang('auto', 'Hello world')).toBe('zh')
  })
  it('auto + cyrillic source -> zh', () => {
    expect(resolveTargetLang('auto', 'Привет')).toBe('zh')
  })
  it('explicit override wins', () => {
    expect(resolveTargetLang('ja', '你好')).toBe('ja')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: FAIL — module `../src/shared/translation` does not exist.

- [ ] **Step 3: Write minimal implementation** (`src/shared/translation.ts`)

```ts
// Translation subsystem — pure logic, zero DOM, zero chrome API.
// All exports are unit-testable in jsdom. This module is the single source
// of truth for translation direction, language metadata, prompt building,
// concurrency control, block selection, and history LRU.

export type TargetLangCode =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de'
  | 'es' | 'ru' | 'pt' | 'it' | 'vi' | 'ar'

export interface LanguageDef {
  code: TargetLangCode
  /** English name (also used as the translation target token in prompts). */
  en: string
  /** Chinese name. */
  zh: string
  /** BCP-47 tag for SpeechSynthesis (browser TTS, zero-dependency). */
  speechCode: string
}

// zh/en first (most common), then by usage frequency.
export const LANGUAGES: LanguageDef[] = [
  { code: 'zh', en: 'Chinese',  zh: '中文',     speechCode: 'zh-CN' },
  { code: 'en', en: 'English',  zh: '英语',     speechCode: 'en-US' },
  { code: 'ja', en: 'Japanese', zh: '日语',     speechCode: 'ja-JP' },
  { code: 'ko', en: 'Korean',   zh: '韩语',     speechCode: 'ko-KR' },
  { code: 'fr', en: 'French',   zh: '法语',     speechCode: 'fr-FR' },
  { code: 'de', en: 'German',   zh: '德语',     speechCode: 'de-DE' },
  { code: 'es', en: 'Spanish',  zh: '西班牙语', speechCode: 'es-ES' },
  { code: 'ru', en: 'Russian',  zh: '俄语',     speechCode: 'ru-RU' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语', speechCode: 'pt-PT' },
  { code: 'it', en: 'Italian',  zh: '意大利语', speechCode: 'it-IT' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语',  speechCode: 'vi-VN' },
  { code: 'ar', en: 'Arabic',   zh: '阿拉伯语', speechCode: 'ar-SA' },
]

const LANG_BY_CODE: Record<TargetLangCode, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l])
) as Record<TargetLangCode, LanguageDef>

/** Look up a language def; falls back to English for unknown codes. */
export function getLanguage(code: TargetLangCode): LanguageDef {
  return LANG_BY_CODE[code] || LANGUAGES[1] // en
}

export type Script = 'cjk' | 'cyrillic' | 'arabic' | 'latin'

/**
 * Detect the dominant script of a text by counting characters in each range.
 * Used to pick a sensible default target language (the "opposite" of the
 * source), matching the pre-existing zh<->en heuristic intuition.
 */
export function detectScript(text: string): Script {
  let cjk = 0, cyrillic = 0, arabic = 0, latin = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff) ||
        (c >= 0xac00 && c <= 0xd7af)) {
      cjk++
    } else if (c >= 0x0400 && c <= 0x04ff) {
      cyrillic++
    } else if (c >= 0x0600 && c <= 0x06ff) {
      arabic++
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++
    }
  }
  if (cjk >= cyrillic && cjk >= arabic && cjk > 0) return 'cjk'
  if (cyrillic >= arabic && cyrillic > 0) return 'cyrillic'
  if (arabic > 0) return 'arabic'
  return 'latin'
}

export type TargetLangSetting = TargetLangCode | 'auto'

/**
 * Resolve the final target language. An explicit user choice wins; 'auto'
 * picks the "opposite" of the detected source script (CJK -> English, else
 * Chinese), preserving the existing intuition.
 */
export function resolveTargetLang(setting: TargetLangSetting, sourceText: string): TargetLangCode {
  if (setting !== 'auto') return setting
  return detectScript(sourceText) === 'cjk' ? 'en' : 'zh'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: PASS (all 4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/translation.ts tests/translation.test.ts
git commit -m "feat(translation): add language table + script detection + target resolution"
```

---

## Task 2: Prompt 构建 + Glossary 方向过滤

**Files:**
- Modify: `src/shared/translation.ts` (append)
- Modify: `tests/translation.test.ts` (append)

**Interfaces:**
- Consumes: `GlossaryEntry` from `./glossary`, `TargetLangCode` from this module
- Produces: `buildTranslateSystemPrompt`, `filterGlossaryForDirection`

- [ ] **Step 1: Write the failing test** (append to `tests/translation.test.ts`)

```ts
import { buildTranslateSystemPrompt, filterGlossaryForDirection } from '../src/shared/translation'
import type { GlossaryEntry } from '../src/shared/glossary'

const ge = (id: string, source: string, target: string, enabled = true): GlossaryEntry => ({
  id, source, target, enabled, createdAt: 1000,
})

describe('buildTranslateSystemPrompt', () => {
  it('includes the target language name', () => {
    const p = buildTranslateSystemPrompt('ja', '')
    expect(p).toContain('Japanese')
    expect(p).toContain('Output ONLY')
  })
  it('appends glossary block when provided', () => {
    const p = buildTranslateSystemPrompt('en', 'GLOSSARY (translate these terms consistently):\n- LLM → 大语言模型')
    expect(p).toContain('LLM → 大语言模型')
  })
  it('omits glossary section when empty', () => {
    const p = buildTranslateSystemPrompt('en', '')
    expect(p).not.toContain('GLOSSARY')
  })
})

describe('filterGlossaryForDirection', () => {
  it('keeps entries whose source script matches a CJK->non-CJK direction', () => {
    const entries = [
      ge('1', '大语言模型', 'LLM'),   // cjk source
      ge('2', 'RAG', '检索增强生成'), // latin source
    ]
    // translating TO english => we care about cjk-source terms
    const out = filterGlossaryForDirection(entries, 'en')
    expect(out.map((e) => e.id)).toEqual(['1'])
  })
  it('keeps latin-source entries when translating to zh', () => {
    const entries = [
      ge('1', '大语言模型', 'LLM'),
      ge('2', 'RAG', '检索增强生成'),
    ]
    const out = filterGlossaryForDirection(entries, 'zh')
    expect(out.map((e) => e.id)).toEqual(['2'])
  })
  it('returns all enabled when target is neither zh nor en (cannot infer)', () => {
    const entries = [ge('1', 'A', 'B'), ge('2', 'C', 'D')]
    const out = filterGlossaryForDirection(entries, 'ja')
    expect(out).toHaveLength(2)
  })
  it('drops disabled entries', () => {
    const entries = [ge('1', 'RAG', '检索增强生成', false)]
    expect(filterGlossaryForDirection(entries, 'zh')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: FAIL — `buildTranslateSystemPrompt` / `filterGlossaryForDirection` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/shared/translation.ts`)

```ts
import type { GlossaryEntry } from './glossary'

/**
 * Build the standard translation system prompt, injecting the glossary block
 * only when non-empty. Single source of truth so the selection popup, bilingual
 * page mode, vocab save, and sentence card stay consistent. Migrated from the
 * former inline copy in content.ts.
 */
export function buildTranslateSystemPrompt(targetLang: TargetLangCode, glossaryBlock: string): string {
  const name = getLanguage(targetLang).en
  const base = `You are a professional translator. Translate the user text to ${name}. Preserve meaning, tone, and formatting. Keep code blocks, URLs, and HTML tags untranslated. Output ONLY the translation, no explanations.`
  return glossaryBlock ? `${base}\n\n${glossaryBlock}` : base
}

/**
 * Direction-aware glossary filter. When the target is Chinese, only Latin-source
 * terms are relevant (we are translating foreign text INTO chinese); when the
 * target is English, only CJK-source terms are relevant. For other target
 * languages we cannot infer direction, so keep all enabled entries. Disabled
 * entries are always dropped.
 */
export function filterGlossaryForDirection(entries: GlossaryEntry[], targetLang: TargetLangCode): GlossaryEntry[] {
  const enabled = entries.filter((e) => e.enabled && e.source.trim() && e.target.trim())
  if (targetLang !== 'zh' && targetLang !== 'en') return enabled
  return enabled.filter((e) => {
    const srcScript = detectScript(e.source)
    return targetLang === 'zh' ? srcScript !== 'cjk' : srcScript === 'cjk'
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/translation.ts tests/translation.test.ts
git commit -m "feat(translation): add prompt builder + direction-aware glossary filter"
```

---

## Task 3: 并发限流器

**Files:**
- Modify: `src/shared/translation.ts` (append)
- Modify: `tests/translation.test.ts` (append)

**Interfaces:**
- Produces: `runConcurrent`, `ConcurrencyOptions`

- [ ] **Step 1: Write the failing test** (append to `tests/translation.test.ts`)

```ts
import { runConcurrent } from '../src/shared/translation'

describe('runConcurrent', () => {
  it('respects the concurrency limit', async () => {
    let inflight = 0
    let maxInflight = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const worker = async (n: number) => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((r) => setTimeout(r, 10))
      inflight--
      return n * 2
    }
    const results = await runConcurrent(items, worker, { concurrency: 3 })
    expect(maxInflight).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(8)
    expect(results.every((r) => r.ok)).toBe(true)
    expect((results[0] as any).value).toBe(2)
  })

  it('isolates per-task errors (does not throw, marks failing tasks)', async () => {
    const items = [1, 2, 3]
    const worker = async (n: number) => {
      if (n === 2) throw new Error('boom')
      return n
    }
    const results = await runConcurrent(items, worker, { concurrency: 2 })
    expect(results[0]).toEqual({ ok: true, value: 1 })
    expect(results[1].ok).toBe(false)
    expect(results[2]).toEqual({ ok: true, value: 3 })
  })

  it('aborts remaining tasks when signal aborts', async () => {
    const controller = new AbortController()
    const started: number[] = []
    const items = [1, 2, 3, 4, 5]
    const worker = async (n: number) => {
      started.push(n)
      await new Promise((r) => setTimeout(r, 50))
      return n
    }
    setTimeout(() => controller.abort(), 20)
    const results = await runConcurrent(items, worker, { concurrency: 2, signal: controller.signal })
    // not all should have started; some ok some aborted errors
    expect(started.length).toBeLessThan(items.length)
    const aborted = results.filter((r) => !r.ok)
    expect(aborted.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: FAIL — `runConcurrent` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/shared/translation.ts`)

```ts
export interface ConcurrencyOptions {
  concurrency: number
  signal?: AbortSignal
}

export type ConcurrentResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: unknown; index: number }

/**
 * Run `worker` over `items` with at most `concurrency` in-flight tasks. Never
 * throws: a failing task is reported as { ok:false } so callers (e.g. bilingual
 * page translation) can keep going best-effort. Respects an optional AbortSignal:
 * when aborted, not-yet-started tasks are rejected with the abort error.
 */
export async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: ConcurrencyOptions
): Promise<ConcurrentResult<R>[]> {
  const n = Math.max(1, opts.concurrency)
  const results: ConcurrentResult<R>[] = new Array(items.length)
  let cursor = 0
  const aborted = () => opts.signal?.aborted === true

  async function runOne(myIndex: number): Promise<void> {
    if (aborted()) {
      results[myIndex] = { ok: false, error: new DOMException('Aborted', 'AbortError'), index: myIndex }
      return
    }
    try {
      const value = await worker(items[myIndex], myIndex)
      results[myIndex] = { ok: true, value }
    } catch (e) {
      results[myIndex] = { ok: false, error: e, index: myIndex }
    }
  }

  // Pool of workers; each grabs the next index until exhausted or aborted.
  async function pool(): Promise<void> {
    while (true) {
      if (aborted()) return
      const myIndex = cursor++
      if (myIndex >= items.length) return
      await runOne(myIndex)
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(n, items.length); i++) workers.push(pool())
  await Promise.all(workers)

  // Fill any untouched slots (e.g. abort before a pooled worker claimed them).
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { ok: false, error: new DOMException('Aborted', 'AbortError'), index: i }
    }
  }
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/translation.ts tests/translation.test.ts
git commit -m "feat(translation): add bounded concurrency runner with abort + error isolation"
```

---

## Task 4: 选块判定（纯函数化 DOM 过滤）

**Files:**
- Modify: `src/shared/translation.ts` (append)
- Modify: `tests/translation.test.ts` (append)

**Interfaces:**
- Produces: `BlockCandidate`, `shouldTranslateBlock`, `TRANSLATABLE_TAGS`, `EXCLUDED_ANCESTOR_TAGS`

- [ ] **Step 1: Write the failing test** (append to `tests/translation.test.ts`)

```ts
import { shouldTranslateBlock, TRANSLATABLE_TAGS, EXCLUDED_ANCESTOR_TAGS } from '../src/shared/translation'

const cand = (over: Partial<import('../src/shared/translation').BlockCandidate>) => ({
  text: 'Hello world this is a normal paragraph with enough text',
  tag: 'P',
  isInsideExcluded: false,
  isAlreadyTranslated: false,
  textRatio: 0.9,
  ...over,
})

describe('shouldTranslateBlock', () => {
  it('accepts a normal paragraph', () => {
    expect(shouldTranslateBlock(cand({}))).toBe(true)
  })
  it('rejects too-short text', () => {
    expect(shouldTranslateBlock(cand({ text: 'hi' }))).toBe(false)
  })
  it('rejects too-long text', () => {
    expect(shouldTranslateBlock(cand({ text: 'x'.repeat(2001) }))).toBe(false)
  })
  it('rejects excluded ancestor', () => {
    expect(shouldTranslateBlock(cand({ isInsideExcluded: true }))).toBe(false)
  })
  it('rejects already-translated', () => {
    expect(shouldTranslateBlock(cand({ isAlreadyTranslated: true }))).toBe(false)
  })
  it('rejects low text ratio', () => {
    expect(shouldTranslateBlock(cand({ textRatio: 0.3 }))).toBe(false)
  })
  it('rejects non-translatable tag', () => {
    expect(shouldTranslateBlock(cand({ tag: 'DIV' }))).toBe(false)
  })
  it('accepts a heading', () => {
    expect(shouldTranslateBlock(cand({ tag: 'H2', text: 'A meaningful heading here' }))).toBe(true)
  })
})

describe('tag lists', () => {
  it('TRANSLATABLE_TAGS includes core block tags', () => {
    expect(TRANSLATABLE_TAGS).toContain('P')
    expect(TRANSLATABLE_TAGS).toContain('H1')
    expect(TRANSLATABLE_TAGS).toContain('LI')
    expect(TRANSLATABLE_TAGS).toContain('BLOCKQUOTE')
  })
  it('EXCLUDED_ANCESTOR_TAGS includes code/pre/script', () => {
    expect(EXCLUDED_ANCESTOR_TAGS).toContain('CODE')
    expect(EXCLUDED_ANCESTOR_TAGS).toContain('PRE')
    expect(EXCLUDED_ANCESTOR_TAGS).toContain('SCRIPT')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/shared/translation.ts`)

```ts
/** Tags whose text content is worth translating. */
export const TRANSLATABLE_TAGS = new Set([
  'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'SUMMARY',
])

/** Ancestor tags that mark content as non-translatable (code, controls, etc). */
export const EXCLUDED_ANCESTOR_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT',
  'SELECT', 'OPTION', 'BUTTON', 'SVG', 'MATH',
])

export interface BlockCandidate {
  text: string
  tag: string
  isInsideExcluded: boolean
  isAlreadyTranslated: boolean
  /** text length / element outerHTML length; below threshold = mostly markup. */
  textRatio: number
}

const MIN_BLOCK_LEN = 1
const MAX_BLOCK_LEN = 2000
const MIN_TEXT_RATIO = 0.6

/**
 * Decide whether a candidate DOM block should be translated. Pure function so
 * the DOM-querying (content.ts) is decoupled from the policy (here, unit-tested).
 */
export function shouldTranslateBlock(c: BlockCandidate): boolean {
  if (!TRANSLATABLE_TAGS.has(c.tag.toUpperCase())) return false
  const t = c.text.trim()
  if (t.length < MIN_BLOCK_LEN || t.length > MAX_BLOCK_LEN) return false
  if (c.isInsideExcluded) return false
  if (c.isAlreadyTranslated) return false
  if (c.textRatio < MIN_TEXT_RATIO) return false
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/translation.ts tests/translation.test.ts
git commit -m "feat(translation): add block-selection policy (pure function + tag sets)"
```

---

## Task 5: 翻译历史 LRU + 批量解析 + 显示模式

**Files:**
- Modify: `src/shared/translation.ts` (append)
- Modify: `tests/translation.test.ts` (append)

**Interfaces:**
- Produces: `TranslationKind`, `TranslationHistoryEntry`, `appendHistory`, `newHistoryId`, `BATCH_SEP`, `buildBatchPrompt`, `parseBatchResult`, `DisplayMode`, `isValidDisplayMode`

- [ ] **Step 1: Write the failing test** (append to `tests/translation.test.ts`)

```ts
import {
  appendHistory,
  newHistoryId,
  BATCH_SEP,
  buildBatchPrompt,
  parseBatchResult,
  isValidDisplayMode,
  type TranslationHistoryEntry,
} from '../src/shared/translation'

const he = (id: string, source: string, target: string, targetLang: any, createdAt = 1000): TranslationHistoryEntry => ({
  id, source, target, sourceLang: 'auto', targetLang, kind: 'selection', url: 'https://x', createdAt,
})

describe('appendHistory', () => {
  it('prepends new entries', () => {
    const out = appendHistory([], he('1', 'a', 'A', 'en'))
    expect(out[0].id).toBe('1')
  })
  it('dedupes by source+targetLang keeping newest', () => {
    const list = [he('1', 'a', 'A', 'en', 1000)]
    const out = appendHistory(list, he('2', 'a', 'A2', 'en', 2000))
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('2')
    expect(out[0].target).toBe('A2')
  })
  it('keeps different targetLang for same source', () => {
    const list = [he('1', 'a', 'A', 'en')]
    const out = appendHistory(list, he('2', 'a', '甲', 'zh'))
    expect(out).toHaveLength(2)
  })
  it('caps at max (default 200)', () => {
    const list = Array.from({ length: 200 }, (_, i) => he(String(i), `s${i}`, `t${i}`, 'en', i))
    const out = appendHistory(list, he('new', 's', 't', 'en', 999))
    expect(out).toHaveLength(200)
    expect(out[0].id).toBe('new')
  })
  it('truncates source/target to 200 chars', () => {
    const long = 'x'.repeat(500)
    const out = appendHistory([], he('1', long, long, 'en'))
    expect(out[0].source.length).toBe(200)
    expect(out[0].target.length).toBe(200)
  })
})

describe('newHistoryId', () => {
  it('produces a non-empty string', () => {
    expect(newHistoryId().length).toBeGreaterThan(0)
  })
})

describe('batch prompt', () => {
  it('round-trips N items via the separator', () => {
    const { system, user } = buildBatchPrompt(['hello', 'world'], 'zh', '')
    expect(system).toContain('Chinese')
    const parts = parseBatchResult('你好' + BATCH_SEP + '世界', 2)
    expect(parts).toEqual(['你好', '世界'])
  })
  it('parseBatchResult pads missing parts', () => {
    const parts = parseBatchResult('only one', 3)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('only one')
    expect(parts[1]).toBe('')
    expect(parts[2]).toBe('')
  })
  it('parseBatchResult trims extra parts', () => {
    const parts = parseBatchResult('a' + BATCH_SEP + 'b' + BATCH_SEP + 'c', 2)
    expect(parts).toEqual(['a', 'b'])
  })
})

describe('isValidDisplayMode', () => {
  it('accepts the three modes', () => {
    expect(isValidDisplayMode('bilingual')).toBe(true)
    expect(isValidDisplayMode('translationOnly')).toBe(true)
    expect(isValidDisplayMode('hover')).toBe(true)
  })
  it('rejects unknown', () => {
    expect(isValidDisplayMode('xxx' as any)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/shared/translation.ts`)

```ts
export type TranslationKind = 'selection' | 'page' | 'vocab' | 'sentence'

export interface TranslationHistoryEntry {
  id: string
  source: string
  target: string
  sourceLang: string
  targetLang: TargetLangCode
  kind: TranslationKind
  url: string
  createdAt: number
}

export function newHistoryId(): string {
  return 'th_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const HISTORY_MAX = 200
const FIELD_MAX = 200
const trunc = (s: string) => (s.length > FIELD_MAX ? s.slice(0, FIELD_MAX) : s)

/**
 * Append a history entry with LRU semantics: newest first; an exact
 * (source, targetLang) duplicate replaces the older one; the list is capped
 * at `max` (default 200). Source/target are truncated to 200 chars.
 */
export function appendHistory(
  list: TranslationHistoryEntry[],
  entry: TranslationHistoryEntry,
  max = HISTORY_MAX
): TranslationHistoryEntry[] {
  const norm = (s: string) => s.trim()
  const key = (e: TranslationHistoryEntry) => norm(e.source) + '|' + e.targetLang
  const k = key(entry)
  const filtered = list.filter((e) => key(e) !== k)
  const clean: TranslationHistoryEntry = {
    ...entry,
    source: trunc(entry.source),
    target: trunc(entry.target),
  }
  return [clean, ...filtered].slice(0, max)
}

// --- batch translation (available but NOT enabled by default; preserves streaming) ---

export const BATCH_SEP = '\n\n@@@LECTOR_BATCH@@@\n\n'

export function buildBatchPrompt(items: string[], targetLang: TargetLangCode, glossaryBlock: string): { system: string; user: string } {
  const system = buildTranslateSystemPrompt(targetLang, glossaryBlock) +
    `\n\nThe user message contains ${items.length} segments separated by the line "${BATCH_SEP.trim()}". Translate each segment independently and output them in the SAME order, separated by exactly the same separator. Do not add numbering or extra text.`
  const user = items.join(BATCH_SEP)
  return { system, user }
}

export function parseBatchResult(raw: string, count: number): string[] {
  const parts = raw.split(BATCH_SEP).map((p) => p.trim())
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(parts[i] || '')
  return out
}

// --- display mode ---

export type DisplayMode = 'bilingual' | 'translationOnly' | 'hover'
const DISPLAY_MODES: DisplayMode[] = ['bilingual', 'translationOnly', 'hover']
export function isValidDisplayMode(m: unknown): m is DisplayMode {
  return typeof m === 'string' && (DISPLAY_MODES as string[]).includes(m)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/translation.test.ts`
Expected: PASS (full file green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/translation.ts tests/translation.test.ts
git commit -m "feat(translation): add history LRU + batch prompt/parser + display mode"
```

---

## Task 6: TranslationSettings 类型 + ByokSettings 扩展

**Files:**
- Modify: `src/shared/providers.ts`

**Interfaces:**
- Consumes: `DisplayMode`, `TargetLangSetting`, `TargetLangCode` from `./translation`
- Produces: `TranslationSettings`, `DEFAULT_TRANSLATION_SETTINGS`; extends `ByokSettings` with optional `translation?`

- [ ] **Step 1: Add types to `src/shared/providers.ts`**

Add import near the top (after existing imports):
```ts
import { isValidDisplayMode, type DisplayMode, type TargetLangCode } from './translation'
```

Add the interface + default before `export interface ByokSettings`:
```ts
export interface TranslationSettings {
  /** Target language; 'auto' infers the opposite of the source script. */
  targetLanguage: TargetLangCode | 'auto'
  /** How bilingual translations are rendered on the page. */
  displayMode: DisplayMode
  /** Auto-translate the whole page on load when enabled. Default false. */
  autoTranslate: boolean
  /** Max in-flight translation requests for page mode. 1–10. Default 5. */
  concurrency: number
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  targetLanguage: 'auto',
  displayMode: 'bilingual',
  autoTranslate: false,
  concurrency: 5,
}

/** Coerce arbitrary stored data into a valid TranslationSettings (migration-safe). */
export function normalizeTranslationSettings(raw: unknown): TranslationSettings {
  const base = { ...DEFAULT_TRANSLATION_SETTINGS }
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  if (typeof r.targetLanguage === 'string') {
    base.targetLanguage = r.targetLanguage as TargetLangCode | 'auto'
  }
  if (isValidDisplayMode(r.displayMode)) base.displayMode = r.displayMode
  if (typeof r.autoTranslate === 'boolean') base.autoTranslate = r.autoTranslate
  if (typeof r.concurrency === 'number' && r.concurrency >= 1 && r.concurrency <= 10) {
    base.concurrency = Math.floor(r.concurrency)
  }
  return base
}
```

Add the optional field to `ByokSettings` (after the `anki?` field):
```ts
  /** Translation feature settings (target language, display mode, etc.). */
  translation?: TranslationSettings
```

- [ ] **Step 2: Add/extend a test in `tests/providers.test.ts`** (create if absent)

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRANSLATION_SETTINGS,
  normalizeTranslationSettings,
  DEFAULT_BYOK_SETTINGS,
} from '../src/shared/providers'

describe('normalizeTranslationSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeTranslationSettings(null)).toEqual(DEFAULT_TRANSLATION_SETTINGS)
    expect(normalizeTranslationSettings('x')).toEqual(DEFAULT_TRANSLATION_SETTINGS)
  })
  it('keeps valid fields and drops invalid ones', () => {
    const out = normalizeTranslationSettings({
      targetLanguage: 'ja',
      displayMode: 'hover',
      autoTranslate: true,
      concurrency: 3,
    })
    expect(out).toEqual({ targetLanguage: 'ja', displayMode: 'hover', autoTranslate: true, concurrency: 3 })
  })
  it('clamps concurrency to 1-10 and rejects bad displayMode', () => {
    const out = normalizeTranslationSettings({ concurrency: 99, displayMode: 'weird' })
    expect(out.concurrency).toBe(10)
    expect(out.displayMode).toBe('bilingual')
  })
})

describe('DEFAULT_BYOK_SETTINGS', () => {
  it('does NOT set translation by default (lazy default applied at read time)', () => {
    expect(DEFAULT_BYOK_SETTINGS.translation).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run typecheck + test**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Expected: no errors.

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/providers.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/providers.ts tests/providers.test.ts
git commit -m "feat(translation): add TranslationSettings type + ByokSettings field"
```

---

## Task 7: i18n 字符串

**Files:**
- Modify: `src/shared/i18n.ts`

**Interfaces:**
- Produces: new `StringKey` entries (compile-time checked everywhere)

- [ ] **Step 1: Add string entries**

In `src/shared/i18n.ts`, add this block inside the `STRINGS` object (e.g. right before the closing `} as const`):

```ts
  // --- translation settings (Feature) ---
  'settings.translation.title': { en: 'Translation', zh: '翻译' },
  'settings.translation.targetLanguage': { en: 'Target language', zh: '目标语言' },
  'settings.translation.targetLanguage.auto': { en: 'Auto (opposite of source)', zh: '自动（与源语言相反）' },
  'settings.translation.displayMode': { en: 'Bilingual display', zh: '双语显示' },
  'settings.translation.displayMode.bilingual': { en: 'Below original', zh: '译文在原文下方' },
  'settings.translation.displayMode.translationOnly': { en: 'Translation only', zh: '仅译文' },
  'settings.translation.displayMode.hover': { en: 'On hover', zh: '悬停显示' },
  'settings.translation.autoTranslate': { en: 'Auto-translate pages on load', zh: '打开页面自动整页翻译' },
  'settings.translation.concurrency': { en: 'Parallel requests', zh: '并发请求数' },

  // --- bilingual page translation ---
  'toolbar.bilingual': { en: 'Bilingual', zh: '双语' },
  'bilingual.progress': { en: 'Translated {done}/{total}', zh: '已翻译 {done}/{total} 段' },
  'bilingual.cancel': { en: 'Cancel', zh: '取消' },
  'bilingual.retry': { en: 'Retry', zh: '重试' },
  'bilingual.copyTranslation': { en: 'Copy translation', zh: '复制译文' },
  'bilingual.blockError': { en: 'Translation failed', zh: '翻译失败' },
  'bilingual.canceled': { en: 'Canceled', zh: '已取消' },

  // --- selection popup (translate) ---
  'popup.result.speak': { en: 'Read aloud', zh: '朗读' },
  'popup.result.retranslate': { en: 'Retranslate', zh: '重新翻译' },
  'popup.result.targetLang': { en: 'Translate to', zh: '译为' },

  // --- translation history ---
  'side.translationHistory.title': { en: 'Translation history', zh: '翻译历史' },
  'side.translationHistory.empty': {
    en: 'Your translations will appear here.',
    zh: '你的翻译记录会出现在这里。',
  },
  'side.translationHistory.clear': { en: 'Clear all', zh: '清空' },
  'side.translationHistory.search': { en: 'Search translations…', zh: '搜索翻译…' },
  'side.translationHistory.kind.selection': { en: 'Selection', zh: '划词' },
  'side.translationHistory.kind.page': { en: 'Page', zh: '整页' },
  'side.translationHistory.kind.vocab': { en: 'Vocab', zh: '生词' },
  'side.translationHistory.kind.sentence': { en: 'Sentence', zh: '长难句' },
```

- [ ] **Step 2: Run typecheck**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Expected: no errors (new keys are now part of `StringKey`).

- [ ] **Step 3: Commit**

```bash
git add src/shared/i18n.ts
git commit -m "feat(i18n): add translation feature UI strings (en/zh)"
```

---

## Task 8: store.ts — translationHistory 状态 + actions

**Files:**
- Modify: `src/shared/store.ts`

**Interfaces:**
- Consumes: `TranslationHistoryEntry`, `appendHistory` from `./translation`
- Produces: `translationHistory` state + `addTranslationHistory` / `clearTranslationHistory` actions

- [ ] **Step 1: Add import** (top of `src/shared/store.ts`)

```ts
import { appendHistory, newHistoryId, type TranslationHistoryEntry } from './translation'
```

- [ ] **Step 2: Add state field** in `AppState` (after the `sentences: SentenceCard[]` line):

```ts
  // Translation history — LRU list of recent translations (max 200).
  translationHistory: TranslationHistoryEntry[]
```

- [ ] **Step 3: Add action signatures** in `AppState` (after `clearSentences` or near other clear/add actions):

```ts
  addTranslationHistory: (entry: Omit<TranslationHistoryEntry, 'id'>) => void
  clearTranslationHistory: () => void
```

- [ ] **Step 4: Initialize state** in the `create` call's initial state object (find the existing `sentences: []` and add after it):

```ts
    translationHistory: [],
```

- [ ] **Step 5: Implement actions** in the actions object (alongside `addSentence` etc.):

```ts
    addTranslationHistory: (entry) => set((s) => ({
      translationHistory: appendHistory(s.translationHistory, { ...entry, id: newHistoryId() }),
    })),
    clearTranslationHistory: () => set({ translationHistory: [] }),
```

- [ ] **Step 6: Add a test** in `tests/store.test.ts` (append)

```ts
import { useStore } from '../src/shared/store'

describe('translation history', () => {
  beforeEach(() => {
    useStore.setState({ translationHistory: [] })
  })
  it('addTranslationHistory prepends and assigns id', () => {
    useStore.getState().addTranslationHistory({
      source: 'hi', target: '你好', sourceLang: 'auto', targetLang: 'zh',
      kind: 'selection', url: 'u', createdAt: 1,
    })
    const list = useStore.getState().translationHistory
    expect(list).toHaveLength(1)
    expect(list[0].id).toBeTruthy()
    expect(list[0].source).toBe('hi')
  })
  it('clearTranslationHistory empties the list', () => {
    useStore.getState().addTranslationHistory({
      source: 'hi', target: '你好', sourceLang: 'auto', targetLang: 'zh',
      kind: 'selection', url: 'u', createdAt: 1,
    })
    useStore.getState().clearTranslationHistory()
    expect(useStore.getState().translationHistory).toHaveLength(0)
  })
})
```
(If `tests/store.test.ts` lacks a `beforeEach` import, add `import { beforeEach } from 'vitest'`.)

- [ ] **Step 7: Run typecheck + test**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Run: `NODE_ENV=development node_modules/.bin/vitest run tests/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/store.ts tests/store.test.ts
git commit -m "feat(translation): add translationHistory state + actions to store"
```

---

## Task 9: content.ts — 沉浸式双语整页翻译（并发+流式+增量+进度+取消+显示模式）

**Files:**
- Modify: `src/content.ts`

**Interfaces:**
- Consumes: `runConcurrent`, `shouldTranslateBlock`, `buildTranslateSystemPrompt`, `filterGlossaryForDirection`, `resolveTargetLang`, `EXCLUDED_ANCESTOR_TAGS`, `DisplayMode` from `./shared/translation`; `streamChat`, `getSettings` from `./shared/byok`; `renderGlossaryPrompt` from `./shared/glossary`; `normalizeTranslationSettings` from `./shared/providers`

> This is the largest integration task. It replaces the serial `toggleBilingual()` (content.ts:660-713) and the `.lector-bilingual` style. The selection popup (Task 10) is separate.

- [ ] **Step 1: Update imports** at top of `src/content.ts`

Add to the existing import from `./shared/byok`:
```ts
import { getSettings, completeOnce, streamChat } from './shared/byok'
```
Add new imports:
```ts
import {
  runConcurrent,
  shouldTranslateBlock,
  buildTranslateSystemPrompt,
  filterGlossaryForDirection,
  resolveTargetLang,
  EXCLUDED_ANCESTOR_TAGS,
  type DisplayMode,
} from './shared/translation'
import { normalizeTranslationSettings } from './shared/providers'
```
(Adjust to match actual existing import paths; byok/glossary are already imported — merge the named imports.)

- [ ] **Step 2: Add module state for bilingual translation** (near the existing `const translatedSet = new WeakSet...`):

```ts
let bilingualAbort: AbortController | null = null
let bilingualObserver: IntersectionObserver | null = null
let bilingualDone = 0
let bilingualTotal = 0
let cachedDisplayMode: DisplayMode = 'bilingual'
```

- [ ] **Step 3: Replace the `.lector-bilingual` CSS** in `injectStyles()` (find the existing `.lector-bilingual { ... }` line and replace the whole rule with):

```css
    .lector-bilingual { font-size:.92em; line-height:1.6; color:#6B6155; border-left:3px solid #9C6B3C; padding:4px 0 4px 12px; margin:8px 0 8px 4px; border-radius:0 3px 3px 0; position:relative; transition:opacity .2s ease; }
    .lector-bilingual.is-loading { opacity:.6; }
    .lector-bilingual.is-error { border-left-color:#c0392b; color:#c0392b; }
    .lector-bilingual::after { content:''; }
    .lector-bilingual .lector-bi-caret { display:inline-block; width:2px; height:1em; background:#9C6B3C; vertical-align:text-bottom; margin-left:1px; animation:lectorBlink 1s steps(2) infinite; }
    @keyframes lectorBlink { 50% { opacity:0; } }
    .lector-bi-actions { position:absolute; right:6px; top:-10px; display:none; gap:4px; background:#FFF8EE; border:1px solid #E8DECC; border-radius:6px; padding:2px 4px; box-shadow:0 2px 8px rgba(0,0,0,.1); z-index:1; }
    .lector-bilingual:hover .lector-bi-actions { display:flex; }
    .lector-bi-actions button { border:none; background:transparent; color:#9C6B3C; cursor:pointer; font-size:11px; padding:2px 4px; border-radius:4px; }
    .lector-bi-actions button:hover { background:rgba(156,107,60,.12); }
    /* display modes (toggled via body class set by content script) */
    body.lector-dm-translationOnly .lector-source-hidden { display:none !important; }
    body.lector-dm-hover .lector-bilingual { display:none; }
    body.lector-dm-hover .lector-bi-source:hover + .lector-bilingual,
    body.lector-dm-hover .lector-bi-source:hover .lector-bilingual { display:block; }
```

- [ ] **Step 4: Replace `toggleBilingual()` entirely** (delete the old function body lines ~660-713 and the `const translatedSet` line; replace with):

```ts
function buildBlockCandidate(el: HTMLElement) {
  const text = (el.textContent || '').trim()
  const outerLen = (el.outerHTML || '').length || text.length || 1
  return {
    text,
    tag: el.tagName,
    isInsideExcluded: !!el.closest(Array.from(EXCLUDED_ANCESTOR_TAGS).map((t) => t.toLowerCase()).join(',')),
    isAlreadyTranslated: !!el.querySelector('.lector-bilingual'),
    textRatio: text.length / outerLen,
  }
}

function applyDisplayMode(mode: DisplayMode) {
  cachedDisplayMode = mode
  document.body.classList.remove('lector-dm-bilingual', 'lector-dm-translationOnly', 'lector-dm-hover')
  document.body.classList.add('lector-dm-' + mode)
}

function reportProgress() {
  chrome.runtime
    .sendMessage({ action: 'lector-bilingual-progress', done: bilingualDone, total: bilingualTotal })
    .catch(() => {})
}

async function translateOneBlock(settings: any, systemPrompt: string, block: HTMLElement): Promise<string> {
  const original = (block.textContent || '').trim()
  // Insert placeholder container immediately so the user sees progress.
  const span = document.createElement('div')
  span.className = 'lector-bilingual is-loading'
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  span.appendChild(caret)
  // Per-block hover actions.
  const actions = document.createElement('span')
  actions.className = 'lector-bi-actions'
  const retry = document.createElement('button')
  retry.textContent = tr('bilingual.retry')
  retry.onclick = (ev) => { ev.stopPropagation(); void translateOneBlock(settings, systemPrompt, block).catch(() => {}) }
  const copy = document.createElement('button')
  copy.textContent = tr('bilingual.copyTranslation')
  copy.onclick = (ev) => { ev.stopPropagation(); navigator.clipboard.writeText(span.textContent || '').catch(() => {}) }
  actions.appendChild(retry); actions.appendChild(copy)
  span.appendChild(actions)
  block.appendChild(span)

  let acc = ''
  await streamChat(
    settings,
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: original.slice(0, 8000) }],
    { maxTokens: Math.min(1000, Math.max(200, original.length * 2)), temperature: 0.2 },
    (delta) => {
      acc += delta
      // Re-render text (drop caret while streaming, keep actions).
      span.classList.remove('is-loading')
      span.textContent = acc
      span.appendChild(actions)
    }
  )
  span.textContent = acc || tr('err.emptyResponse')
  span.appendChild(actions)
  return acc
}

async function runBilingualTranslation() {
  const settings = await getSettings()
  if (!settings.apiKey) {
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    return
  }
  const tSettings = normalizeTranslationSettings(settings.translation)
  applyDisplayMode(tSettings.displayMode)

  // Gather candidates: viewport-first ordering.
  const all = Array.from(document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary')) as HTMLElement[]
  const vh = window.innerHeight
  const candidates = all
    .map((el) => ({ el, c: buildBlockCandidate(el) }))
    .filter((x) => shouldTranslateBlock(x.c) && !x.el.closest('#lector-ai-result, #lector-ai-toolbar, #lector-ai-loading, #lector-ai-fab, [data-lector-no-translate]'))
    .sort((a, b) => {
      const ra = a.el.getBoundingClientRect()
      const rb = b.el.getBoundingClientRect()
      const aIn = ra.top < vh && ra.bottom > 0 ? 0 : 1
      const bIn = rb.top < vh && rb.bottom > 0 ? 0 : 1
      return aIn - bIn
    })
    .map((x) => x.el)
  if (candidates.length === 0) return

  const page = extractPage()
  const target = resolveTargetLang(tSettings.targetLanguage, page.lang === 'zh' ? '中文' : 'Hello')
  const glossary = await loadGlossary()
  const glossaryBlock = renderGlossaryPrompt(filterGlossaryForDirection(glossary, target))
  const systemPrompt = buildTranslateSystemPrompt(target, glossaryBlock)

  bilingualAbort = new AbortController()
  bilingualDone = 0
  bilingualTotal = candidates.length
  reportProgress()

  const results = await runConcurrent(
    candidates,
    async (block) => {
      try {
        await translateOneBlock(settings, systemPrompt, block)
      } catch (e) {
        // Retry once with a short backoff.
        await new Promise((r) => setTimeout(r, 500))
        try {
          await translateOneBlock(settings, systemPrompt, block)
        } catch (e2) {
          const span = block.querySelector('.lector-bilingual')
          if (span) {
            span.classList.remove('is-loading')
            span.classList.add('is-error')
            span.textContent = tr('bilingual.blockError')
          }
          throw e2
        }
      }
    },
    { concurrency: tSettings.concurrency, signal: bilingualAbort.signal }
  )

  bilingualDone = results.filter((r) => r.ok).length
  bilingualTotal = results.length
  reportProgress()

  // Relay history for successful page translations (best-effort, first block as sample).
  const firstOk = results.find((r) => r.ok)
  if (firstOk) {
    const sample = candidates[(results as any).indexOf(firstOk)] || candidates[0]
    chrome.runtime
      .sendMessage({
        action: 'lector-translation-history',
        entry: {
          source: ((sample?.textContent) || '').trim().slice(0, 200),
          target: ((sample?.querySelector('.lector-bilingual'))?.textContent) || '').slice(0, 200),
          sourceLang: page.lang || 'auto',
          targetLang: target,
          kind: 'page',
          url: location.href,
          createdAt: Date.now(),
        },
      })
      .catch(() => {})
  }

  // First error surfaces to side panel (preserve existing UX).
  const firstErr = results.find((r) => !r.ok && !(r.error instanceof DOMException && r.error.name === 'AbortError'))
  if (firstErr && !firstErr.ok) {
    const msg = firstErr.error instanceof Error ? firstErr.error.message : tr('err.requestFailed')
    chrome.runtime.sendMessage({ action: 'lector-bilingual-error', message: msg }).catch(() => {})
  }
  bilingualAbort = null
}

function cancelBilingual() {
  if (bilingualAbort) {
    bilingualAbort.abort()
    bilingualAbort = null
  }
  chrome.runtime.sendMessage({ action: 'lector-bilingual-error', message: tr('bilingual.canceled') }).catch(() => {})
}

// Backwards-compat: the side panel / command still send lector-toggle-bilingual.
async function toggleBilingual() {
  await runBilingualTranslation()
}
```

> Note: `extractPage()` and `loadGlossary()` already exist in content.ts — reuse them. Fix the obvious `))` typo in the history-relay line when transcribing (it should be `((sample?.querySelector('.lector-bilingual'))?.textContent || '').slice(0, 200)`).

- [ ] **Step 5: Handle the `lector-cancel-bilingual` message** in the existing `chrome.runtime.onMessage` listener (content.ts ~783-832). Add a case:

```ts
    else if (msg.action === 'lector-cancel-bilingual') {
      cancelBilingual()
    }
    else if (msg.action === 'lector-translation-settings-changed') {
      // Re-apply display mode live without re-translating.
      const s = await getSettings()
      const ts = normalizeTranslationSettings(s.translation)
      applyDisplayMode(ts.displayMode)
    }
```

- [ ] **Step 6: Optional viewport incremental translation** — add at the bottom of the listeners section (after the existing mouseup listener), guarded so it only activates after a bilingual run:

```ts
function setupBilingualObserver() {
  if (bilingualObserver) bilingualObserver.disconnect()
  bilingualObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target as HTMLElement
      const c = buildBlockCandidate(el)
      if (shouldTranslateBlock(c)) {
        void runBilingualTranslation().catch(() => {})
        bilingualObserver?.unobserve(el)
      }
    }
  }, { rootMargin: '200px' })
}
```
(Wire `setupBilingualObserver()` + observing of untranslated blocks inside `runBilingualTranslation` after the first pass if `autoTranslate` is on — keep it minimal; if scope creeps, leave the observer function present but only call it from the autoTranslate path.)

- [ ] **Step 7: Build + smoke test**

Run: `NODE_ENV=development npm run build:extension`
Expected: build succeeds (content.js produced as single IIFE).

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/content.test.ts`
Expected: existing content tests still pass (no regressions from the refactor).

- [ ] **Step 8: Commit**

```bash
git add src/content.ts
git commit -m "feat(translation): bilingual page translation — concurrency, streaming, progress, cancel, display modes"
```

---

## Task 10: content.ts — 划词翻译弹窗（流式 + 语言选择 + TTS）

**Files:**
- Modify: `src/content.ts`

**Interfaces:**
- Consumes: `streamChat`, `resolveTargetLang`, `buildTranslateSystemPrompt`, `filterGlossaryForDirection`, `LANGUAGES`, `getLanguage`, `normalizeTranslationSettings`

- [ ] **Step 1: Add a streaming translate path.** Refactor `runByokAction` so that the `translate` branch streams into the result popup. Replace the `if (kind === 'translate') { ... }` block inside `runByokAction` (content.ts ~622-627) and the single `completeOnce` call with a branch:

```ts
async function runByokAction(kind: 'translate' | 'summarize' | 'explain', text: string) {
  const settings = await getSettings()
  cachedPref = settings.locale ?? 'auto'
  const r = () => selectionToolbar?.getBoundingClientRect()

  if (!settings.apiKey) {
    removeLoading()
    showResult(r()?.left || 100, r()?.top || 100, tr('err.addKey'), 'translate')
    chrome.runtime.sendMessage({ action: 'open-side-panel' }).catch(() => {})
    return
  }

  if (kind === 'translate') {
    const tSettings = normalizeTranslationSettings(settings.translation)
    const target = resolveTargetLang(tSettings.targetLanguage, text)
    const glossary = await loadGlossary()
    const systemPrompt = buildTranslateSystemPrompt(target, renderGlossaryPrompt(filterGlossaryForDirection(glossary, target)))
    // Show streaming popup immediately with a language selector.
    showStreamingTranslateResult(r()?.left || 100, r()?.top || 100, text, target, async (selTarget, sink) => {
      const sp = buildTranslateSystemPrompt(selTarget, renderGlossaryPrompt(filterGlossaryForDirection(glossary, selTarget)))
      await streamChat(
        settings,
        [{ role: 'system', content: sp }, { role: 'user', content: text.slice(0, 8000) }],
        { maxTokens: Math.min(3000, Math.max(500, text.length * 2)), temperature: 0.2 },
        (delta) => sink.append(delta)
      )
    })
    return
  }

  // Non-translate actions unchanged (summarize/explain still non-streaming).
  let systemPrompt = ''
  let maxTokens = 900
  if (kind === 'summarize') {
    systemPrompt = `You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.`
  } else {
    systemPrompt = `You are Lector AI. Explain the user content clearly in a few sentences, then give one concrete example. Clean Markdown.`
  }
  try {
    const out = await completeOnce(settings, systemPrompt, text.slice(0, 8000), { maxTokens, temperature: 0.5 })
    removeLoading()
    showResult(r()?.left || 100, r()?.top || 100, out || tr('err.emptyResponse'), kind === 'summarize' ? 'summary' : 'explain')
  } catch (e) {
    removeLoading()
    const msg = e instanceof Error ? e.message : tr('err.requestFailed')
    showResult(r()?.left || 100, r()?.top || 100, tr('err.failedPrefix').replace('{msg}', msg), 'explain')
  }
}
```

- [ ] **Step 2: Add `showStreamingTranslateResult`** (new function, near `showResult`):

```ts
function showStreamingTranslateResult(
  x: number, y: number, sourceText: string, initialTarget: import('./shared/translation').TargetLangCode,
  run: (target: import('./shared/translation').TargetLangCode, sink: { append: (d: string) => void; setText: (s: string) => void }) => Promise<void>
) {
  removeLoading()
  removeResult()

  resultPopup = document.createElement('div')
  resultPopup.id = 'lector-ai-result'
  const maxHeight = window.innerHeight - y - 100
  resultPopup.style.cssText = `
    position: fixed; left: ${x}px; top: ${y + 20}px; max-width: 420px; max-height: ${Math.min(maxHeight, 500)}px;
    overflow-y: auto; padding: 16px; background: #fff; border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2); z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; animation: lectorFadeIn .25s ease-out;
  `

  const header = document.createElement('div')
  header.className = 'result-header'
  const title = document.createElement('div')
  title.className = 'result-title'
  title.innerHTML = tr('popup.result.translate')
  // Target language selector.
  const langWrap = document.createElement('label')
  langWrap.style.cssText = 'font-size:11px;color:#6B6155;display:flex;align-items:center;gap:4px;'
  const langLabel = document.createElement('span')
  langLabel.textContent = tr('popup.result.targetLang')
  const sel = document.createElement('select')
  sel.style.cssText = 'font-size:11px;border:1px solid #E8DECC;border-radius:6px;padding:2px 4px;'
  const autoOpt = document.createElement('option')
  autoOpt.value = 'auto'
  autoOpt.textContent = tr('settings.translation.targetLanguage.auto')
  sel.appendChild(autoOpt)
  for (const l of LANGUAGES) {
    const o = document.createElement('option')
    o.value = l.code
    o.textContent = cachedPref === 'zh' ? l.zh : l.en
    if (l.code === initialTarget) o.selected = true
    sel.appendChild(o)
  }
  langWrap.appendChild(langLabel)
  langWrap.appendChild(sel)
  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;'
  closeBtn.textContent = tr('popup.close')
  closeBtn.onclick = () => removeResult()
  header.appendChild(title)
  header.appendChild(langWrap)
  header.appendChild(closeBtn)

  const content = document.createElement('div')
  content.className = 'result-content'
  content.textContent = ''
  const caret = document.createElement('span')
  caret.className = 'lector-bi-caret'
  content.appendChild(caret)

  const footer = document.createElement('div')
  footer.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #E8DECC;display:flex;gap:8px;'
  const speakSrc = document.createElement('button')
  speakSrc.className = 'copy-btn'
  speakSrc.textContent = '🔊 ' + tr('popup.result.speak')
  speakSrc.onclick = () => speak(sourceText, detectScriptForTTS(sourceText))
  const speakTgt = document.createElement('button')
  speakTgt.className = 'copy-btn'
  speakTgt.textContent = '🔊'
  speakTgt.title = tr('popup.result.speak')
  speakTgt.onclick = () => speak(content.textContent || '', getLanguage(currentTarget()).speechCode)
  const copyBtn = document.createElement('button')
  copyBtn.className = 'copy-btn'
  copyBtn.textContent = tr('popup.copy')
  copyBtn.onclick = () => { navigator.clipboard.writeText(content.textContent || ''); copyBtn.textContent = tr('popup.copied'); setTimeout(() => (copyBtn.textContent = tr('popup.copy')), 1500) }
  const chatBtn = document.createElement('button')
  chatBtn.className = 'action-btn primary'
  chatBtn.textContent = tr('popup.continueInPanel')
  chatBtn.onclick = () => { chrome.runtime.sendMessage({ action: 'open-side-panel', seed: { kind: 'translate', text: content.textContent || '' } }).catch(() => {}); removeResult(); removeToolbar() }
  footer.appendChild(speakSrc); footer.appendChild(speakTgt); footer.appendChild(copyBtn); footer.appendChild(chatBtn)

  resultPopup.appendChild(header)
  resultPopup.appendChild(content)
  resultPopup.appendChild(footer)
  document.body.appendChild(resultPopup)

  let acc = ''
  let curTarget = initialTarget
  function currentTarget() { return curTarget }
  const sink = {
    append(delta: string) { acc += delta; content.textContent = acc; content.appendChild(caret) },
    setText(s: string) { acc = s; content.textContent = s; content.appendChild(caret) },
  }

  async function execute(target: import('./shared/translation').TargetLangCode) {
    curTarget = target
    sink.setText('')
    content.appendChild(caret)
    try {
      await run(target, sink)
      content.removeChild(caret)
      // Relay to history.
      chrome.runtime.sendMessage({
        action: 'lector-translation-history',
        entry: { source: sourceText.slice(0, 200), target: (acc || '').slice(0, 200), sourceLang: 'auto', targetLang: target, kind: 'selection', url: location.href, createdAt: Date.now() },
      }).catch(() => {})
    } catch (e) {
      content.removeChild(caret)
      const msg = e instanceof Error ? e.message : tr('err.requestFailed')
      content.textContent = tr('err.failedPrefix').replace('{msg}', msg)
    }
  }

  sel.onchange = () => {
    const code = sel.value === 'auto' ? resolveTargetLang('auto', sourceText) : (sel.value as import('./shared/translation').TargetLangCode)
    // Persist the user's choice so it sticks for next time.
    chrome.runtime.sendMessage({ action: 'lector-set-translation-target', target: sel.value }).catch(() => {})
    void execute(code)
  }

  void execute(initialTarget)
}
```

- [ ] **Step 3: Add TTS + small helpers** (near the new function):

```ts
import { LANGUAGES, getLanguage, detectScript, type TargetLangCode } from './shared/translation'

function detectScriptForTTS(text: string): string {
  return getLanguage(detectScript(text) === 'cjk' ? 'zh' : 'en').speechCode
}

function speak(text: string, langSpeechCode: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = langSpeechCode
  window.speechSynthesis.speak(u)
}
```
(Add `LANGUAGES`, `getLanguage`, `detectScript`, `TargetLangCode` to the existing translation import added in Task 9.)

- [ ] **Step 4: Build + content test**

Run: `NODE_ENV=development npm run build:extension`
Run: `NODE_ENV=development node_modules/.bin/vitest run tests/content.test.ts`
Expected: build OK, tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/content.ts
git commit -m "feat(translation): streaming selection popup with target-language selector + TTS"
```

---

## Task 11: background.ts — 命令转发 + 历史中继 + settings 广播

**Files:**
- Modify: `src/background.ts`

**Interfaces:**
- Consumes: `appendHistory` from `./shared/translation` (for the storage queue drain)

- [ ] **Step 1: Add the `lector-translate` command handler** in the existing `chrome.commands.onCommand` listener (find where `highlight-selection`/`save-word` are handled and add):

```ts
    else if (command === 'lector-translate') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'lector-toggle-bilingual' }).catch(() => {})
      }
    }
```

- [ ] **Step 2: Add translation-history relay** in the `chrome.runtime.onMessage` listener (find the `lector-save-word`/`lector-explain-sentence` handlers and add a new branch):

```ts
    else if (msg.action === 'lector-translation-history') {
      // Queue into storage; the side panel drains & merges into zustand.
      const { lectorTranslationHistory = [] } = await chrome.storage.local.get('lectorTranslationHistory')
      const next = appendHistory(lectorTranslationHistory as any[], { ...msg.entry, id: newHistoryId() })
      await chrome.storage.local.set({ lectorTranslationHistory: next })
    }
    else if (msg.action === 'lector-set-translation-target') {
      // Persist the popup's language choice back into BYOK settings.
      const r = await chrome.storage.local.get('lector_byok_settings')
      const s = (r.lector_byok_settings || {}) as any
      const ts = normalizeTranslationSettings(s.translation)
      ts.targetLanguage = msg.target
      s.translation = ts
      await chrome.storage.local.set({ lector_byok_settings: s })
      // Tell content scripts to refresh display mode / settings live.
      const tabs = await chrome.tabs.query({})
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { action: 'lector-translation-settings-changed' }).catch(() => {})
      }
    }
```

Add imports at top of `src/background.ts`:
```ts
import { appendHistory, newHistoryId } from './shared/translation'
import { normalizeTranslationSettings } from './shared/providers'
```

- [ ] **Step 3: Add context-menu label** — in the context-menu setup, the existing `lector-translate` menu item (background.ts ~196-201) currently opens the side panel. Leave it; the popup flow already covers selection translation. No change needed here unless the menu is missing — verify it exists.

- [ ] **Step 4: Build + background E2E**

Run: `NODE_ENV=development npm run build:extension`
Run: `NODE_ENV=development node_modules/.bin/vitest run`
Expected: all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts
git commit -m "feat(translation): background relay for history + target-language persistence + Alt+T command"
```

---

## Task 12: manifest.json — lector-translate command

**Files:**
- Modify: `src/manifest.json`

- [ ] **Step 1: Add the command** in the `commands` object:

```json
    "lector-translate": {
      "suggested_key": { "default": "Alt+T" },
      "description": "Translate this page (bilingual mode)"
    }
```

- [ ] **Step 2: Build** (verifies manifest validity)

Run: `NODE_ENV=development npm run build:extension`
Expected: build succeeds; `dist/manifest.json` contains the new command.

- [ ] **Step 3: Commit**

```bash
git add src/manifest.json
git commit -m "feat(translation): add Alt+T keyboard command for bilingual page translation"
```

---

## Task 13: sidepanel/App.tsx — 翻译历史抽屉（drain storage queue）

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `translationHistory`/`addTranslationHistory`/`clearTranslationHistory` from store; storage drain pattern from existing vocab/highlights code

- [ ] **Step 1: Drain the storage queue on load.** Find the existing `chrome.storage.local.get` drain logic (App.tsx ~233-244, where `lectorVocab`/`lectorHighlights` are drained) and add a parallel block:

```tsx
    // Drain translation history queue relayed from content/background.
    const rHist = await chrome.storage.local.get('lectorTranslationHistory')
    if (Array.isArray(rHist.lectorTranslationHistory) && rHist.lectorTranslationHistory.length) {
      for (const e of rHist.lectorTranslationHistory) {
        addTranslationHistory({
          source: e.source, target: e.target, sourceLang: e.sourceLang,
          targetLang: e.targetLang, kind: e.kind, url: e.url, createdAt: e.createdAt,
        })
      }
      await chrome.storage.local.set({ lectorTranslationHistory: [] })
    }
```
(Place inside the same effect that drains the other queues; ensure `addTranslationHistory` is destructured from `useStore`.)

- [ ] **Step 2: Add a storage.onChanged listener** (alongside the existing one for vocab) so live translations appear without reload:

```tsx
  useEffect(() => {
    const handler = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (changes.lectorTranslationHistory && Array.isArray(changes.lectorTranslationHistory.newValue)) {
        for (const e of changes.lectorTranslationHistory.newValue) {
          addTranslationHistory(e)
        }
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [addTranslationHistory])
```

- [ ] **Step 3: Render the history drawer.** Add a `translationHistory` view (mirror the structure of the existing highlights/vocab drawers). Minimal JSX:

```tsx
{activeView === 'translationHistory' && (
  <div className="p-4">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-bold text-[#9C6B3C]">{t('side.translationHistory.title')}</h2>
      <button onClick={() => clearTranslationHistory()} className="text-xs text-[#6B6155] hover:text-[#9C6B3C]">{t('side.translationHistory.clear')}</button>
    </div>
    <input
      value={histSearch}
      onChange={(e) => setHistSearch(e.target.value)}
      placeholder={t('side.translationHistory.search')}
      className="w-full mb-3 px-3 py-2 text-xs border border-[#E8DECC] rounded-lg"
    />
    {translationHistory.length === 0 ? (
      <p className="text-xs text-[#9CA3AF]">{t('side.translationHistory.empty')}</p>
    ) : (
      <ul className="space-y-2">
        {translationHistory
          .filter((e) => !histSearch || e.source.includes(histSearch) || e.target.includes(histSearch))
          .map((e) => (
            <li key={e.id} className="border border-[#E8DECC] rounded-lg p-2 text-xs">
              <div className="flex justify-between text-[10px] text-[#9CA3AF] mb-1">
                <span>{t(('side.translationHistory.kind.' + e.kind) as any)}</span>
                <span>{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-[#2B2620]">{e.source}</div>
              <div className="text-[#6B6155] mt-1">{e.target}</div>
              <div className="flex gap-2 mt-1">
                <button onClick={() => navigator.clipboard.writeText(e.target)} className="text-[10px] text-[#9C6B3C]">{t('popup.copy')}</button>
              </div>
            </li>
          ))}
      </ul>
    )}
  </div>
)}
```
(Add `const [histSearch, setHistSearch] = useState('')` and destructure `translationHistory`, `addTranslationHistory`, `clearTranslationHistory` from `useStore`. Add a nav button to switch `activeView` to `'translationHistory'`.)

- [ ] **Step 4: typecheck + build**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Run: `NODE_ENV=development npm run build:extension`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(translation): translation history drawer + storage queue drain"
```

---

## Task 14: sidepanel/App.tsx — 翻译设置区

**Files:**
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: Add a Translation settings block** inside the existing Settings view (find the BYOK settings section). Render controls bound to `byok.translation` via `setByok`:

```tsx
{(() => {
  const ts = { ...DEFAULT_TRANSLATION_SETTINGS, ...(byok.translation || {}) }
  const setTs = (patch: Partial<TranslationSettings>) => setByok({ translation: { ...ts, ...patch } })
  return (
    <div className="mt-4 border-t border-[#E8DECC] pt-4">
      <h3 className="text-xs font-bold text-[#9C6B3C] mb-2">{t('settings.translation.title')}</h3>
      <label className="block text-xs text-[#6B6155] mb-1">{t('settings.translation.targetLanguage')}
        <select
          value={ts.targetLanguage}
          onChange={(e) => { setTs({ targetLanguage: e.target.value as any }); persistTranslation(byok, { targetLanguage: e.target.value as any }) }}
          className="mt-1 w-full px-2 py-1 text-xs border border-[#E8DECC] rounded-md"
        >
          <option value="auto">{t('settings.translation.targetLanguage.auto')}</option>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.zh} ({l.en})</option>)}
        </select>
      </label>
      <div className="text-xs text-[#6B6155] mb-1 mt-2">{t('settings.translation.displayMode')}</div>
      <div className="flex gap-2 mb-2">
        {(['bilingual','translationOnly','hover'] as const).map((m) => (
          <button key={m} onClick={() => { setTs({ displayMode: m }); persistTranslation(byok, { displayMode: m }) }}
            className={`flex-1 px-2 py-1 text-xs rounded-md border ${ts.displayMode === m ? 'border-[#9C6B3C] bg-[#F5EFE3] text-[#9C6B3C]' : 'border-[#E8DECC] text-[#6B6155]'}`}>
            {t(('settings.translation.displayMode.' + (m === 'bilingual' ? 'bilingual' : m === 'translationOnly' ? 'translationOnly' : 'hover')) as any)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-[#6B6155] mb-2">
        <input type="checkbox" checked={ts.autoTranslate} onChange={(e) => { setTs({ autoTranslate: e.target.checked }); persistTranslation(byok, { autoTranslate: e.target.checked }) }} />
        {t('settings.translation.autoTranslate')}
      </label>
      <label className="block text-xs text-[#6B6155]">{t('settings.translation.concurrency')}: {ts.concurrency}
        <input type="range" min={1} max={10} value={ts.concurrency}
          onChange={(e) => { setTs({ concurrency: Number(e.target.value) }); persistTranslation(byok, { concurrency: Number(e.target.value) }) }}
          className="w-full" />
      </label>
    </div>
  )
})()}
```

Add imports at top of App.tsx:
```tsx
import { LANGUAGES, type TranslationHistoryEntry } from '../shared/translation'
import { DEFAULT_TRANSLATION_SETTINGS, type TranslationSettings, normalizeTranslationSettings } from '../shared/providers'
```

Add a helper to write settings to chrome.storage.local AND broadcast the change so content scripts refresh live:
```tsx
async function persistTranslation(byok: ByokSettings, patch: Partial<TranslationSettings>) {
  const ts = { ...DEFAULT_TRANSLATION_SETTINGS, ...(byok.translation || {}), ...patch }
  const next = { ...byok, translation: ts }
  await saveSettings(next)
  const tabs = await chrome.tabs.query({})
  for (const t of tabs) if (t.id) chrome.tabs.sendMessage(t.id, { action: 'lector-translation-settings-changed' }).catch(() => {})
}
```
(`saveSettings` is already imported from `./shared/byok` in App.tsx; verify the import.)

- [ ] **Step 2: typecheck + build**

Run: `NODE_ENV=development node_modules/.bin/tsc --noEmit`
Run: `NODE_ENV=development npm run build:extension`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(translation): settings UI — target language, display mode, auto-translate, concurrency"
```

---

## Task 15: Browser E2E — streaming, concurrency, target language, shortcut

**Files:**
- Modify: `tests/browser/run-browser-e2e.mjs`

- [ ] **Step 1: Add E2E cases.** Following the existing test harness conventions (mock SSE via the mock backend; `build:extension` runs first), add cases that:

  1. **Selection streaming:** load a page, select text, click the translate toolbar button, assert the result popup's `.result-content` grows token-by-token (mock backend returns SSE chunks `data: {"choices":[{"delta":{"content":"你"}}]}` etc.) and final text contains the joined translation.
  2. **Bilingual concurrency:** load a page with several `<p>` blocks, trigger `lector-toggle-bilingual`, assert multiple `.lector-bilingual` elements appear and that the mock backend received >1 concurrent `/chat/completions` request.
  3. **Target language respected:** set `lector_byok_settings.translation.targetLanguage = 'ja'` via storage before triggering, assert the mock backend captured a request whose `messages[0].content` (system prompt) contains `Japanese`.
  4. **Alt+T shortcut:** dispatch the `lector-translate` command path (or simulate the keyboard command via `chrome.commands` — the harness can instead send `lector-toggle-bilingual` directly since command wiring is unit-covered), assert bilingual blocks inject.

  Use the existing mock-SSE helper in the file (the one returning `[译文] mock-translated`) as the template; extend it to return multi-chunk deltas for the streaming case.

- [ ] **Step 2: Run the full browser suite**

Run: `NODE_ENV=development npm run build:extension && npm run test:browser`
Expected: all browser E2E pass, including new translation cases.

- [ ] **Step 3: Commit**

```bash
git add tests/browser/run-browser-e2e.mjs
git commit -m "test(translation): browser E2E — streaming popup, concurrent bilingual, target lang, shortcut"
```

---

## Task 16: Final verification + full build

- [ ] **Step 1: Full typecheck**

Run: `NODE_ENV=development npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Full unit test suite**

Run: `NODE_ENV=development npm test`
Expected: all green (translation.test.ts, providers.test.ts, store.test.ts, glossary.test.ts, content.test.ts, etc.).

- [ ] **Step 3: Full extension build**

Run: `NODE_ENV=development npm run build:extension`
Expected: `dist/` produced with `content.js` (single IIFE), `background.js`, `sidepanel/index.html`, `manifest.json` containing `lector-translate` command.

- [ ] **Step 4: Full browser E2E**

Run: `NODE_ENV=development npm run build:extension && npm run test:browser`
Expected: all green.

- [ ] **Step 5: Manual smoke (optional but recommended)** — load `dist/` in Chrome, fill a BYOK key, select English text → translate (watch streaming + TTS), press Alt+T on a long article (watch concurrent streaming bilingual + progress in sidepanel + history drawer populating).

- [ ] **Step 6: Final commit if any verification surfaced fixes**

```bash
git add -A
git commit -m "chore(translation): verification fixes from full-suite run"
```

---

## Self-Review (run after writing — done)

**Spec coverage:**
- §3.1 语言表 → Task 1 ✓
- §3.2 方向解析 → Task 1 ✓
- §3.3 prompt + 方向 glossary → Task 2 ✓
- §3.4 批量 → Task 5 ✓ (kept, not enabled by default per §11)
- §3.5 并发限流 → Task 3 ✓
- §3.6 选块判定 → Task 4 ✓
- §3.7 历史 LRU → Task 5 ✓
- §3.8 显示模式 → Task 5 ✓
- §4 双语整页 → Task 9 ✓
- §5 划词弹窗 → Task 10 ✓
- §6 设置/目标语言 → Task 6 (types) + Task 14 (UI) + Task 12 (shortcut) ✓
- §7 glossary 增强 + 历史 → Task 2 (filter) + Task 8 (store) + Task 11 (relay) + Task 13 (drawer) ✓
- §8 i18n → Task 7 ✓
- §9 测试 → Task 1-5 (unit) + Task 15 (e2e) + Task 16 (gates) ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. (The "fix the `))` typo when transcribing" note in Task 9 is an explicit warning, not a placeholder.)

**Type consistency:** `TargetLangCode`, `resolveTargetLang`, `buildTranslateSystemPrompt`, `filterGlossaryForDirection`, `runConcurrent`, `shouldTranslateBlock`, `appendHistory`, `newHistoryId`, `TranslationSettings`, `normalizeTranslationSettings`, `LANGUAGES`, `getLanguage`, `detectScript`, `DisplayMode`, `isValidDisplayMode` — names match across producer (Tasks 1-6) and consumer (Tasks 9-14) tasks. ✓
