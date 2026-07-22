# Sentence Library 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「句库与深度讲解卡片」功能——选中/粘贴英文句子 → BYOK AI 生成 6 节结构化讲解卡片 → 沉淀进侧栏句库抽屉，可搜索/复习/跳回原文/导出 Anki。

**Architecture:** 纯逻辑模块 `src/shared/sentences.ts`（镜像 `glossary.ts`/`highlights.ts`）+ zustand store 扩展 + 薄 UI 层。AI 输出固定 6 节 H2 Markdown，`renderMarkdown` 直接渲染，正则提取 `translation`/`keywords` 两字段供去重/搜索/复习。网页选中走 background 中转流（镜像 `lectorVocab`）；粘贴/联动在侧栏内直调。

**Tech Stack:** React 18 + TypeScript 5.5 + Zustand 4 + TailwindCSS；Vitest 2 (jsdom)；Chrome MV3。

## Global Constraints

- **NODE_ENV**：typecheck/test/build 命令必须前置 `NODE_ENV=development`（shell 默认 production 会破坏 dev 工具）。
- **纯模块约定**：`src/shared/*.ts` 不得 import DOM 或 chrome API；纯函数配 vitest 单测。
- **i18n**：新字符串必须加进 `src/shared/i18n.ts` 的 `STRINGS`（en/zh 双语），`StringKey` 编译期检查，渲染用 `tr(key)`/`t(key, locale)`。
- **id 前缀**：句子卡片用 `s` + base36(time) + random（对齐 vocab `v` / highlight `h`）。
- **存储上限**：句库 1000 条（对齐 vocab 2000 / glossary 2000 / highlights 500 量级）。
- **commit 规范**：feat(sentences)/docs(sentences) 前缀；每个 task 末尾 commit。
- **设计文档**：`docs/superpowers/specs/2026-07-22-sentence-library-design.md`（已存在，本计划对照实现）。

**命令参考**：
- typecheck：`NODE_ENV=development npm run typecheck`
- 单测：`NODE_ENV=development npm test`
- 全量构建：`NODE_ENV=development npm run build`

---

### Task 1: 纯模块 `sentences.ts` + 单测（TDD）

**Files:**
- Create: `src/shared/sentences.ts`
- Test: `tests/sentences.test.ts`

**Interfaces:**
- Produces: `SentenceCard`, `ValidationResult`, `SENTENCE_CARD_SYSTEM_PROMPT`, `validateSentence`, `normalizeSentence`, `newCardId`, `makeSentenceCard`, `mergeSentenceCard`, `isDuplicateSentence`, `dedupeCards`, `searchSentences`, `groupSentences`, `extractTranslation`, `extractKeywords`, `exportSentences`, `importSentences`. 后续 task 消费这些。

- [ ] **Step 1: 写失败的单测**

Create `tests/sentences.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  validateSentence,
  normalizeSentence,
  newCardId,
  makeSentenceCard,
  mergeSentenceCard,
  isDuplicateSentence,
  dedupeCards,
  searchSentences,
  groupSentences,
  extractTranslation,
  extractKeywords,
  exportSentences,
  importSentences,
  SENTENCE_CARD_SYSTEM_PROMPT,
  type SentenceCard,
} from '../src/shared/sentences'

const card = (
  id: string,
  sentence: string,
  opts: Partial<SentenceCard> = {}
): SentenceCard => ({
  id,
  sentence,
  translation: opts.translation ?? '译文',
  analysis: opts.analysis ?? '## 译文\n\n译文',
  keywords: opts.keywords ?? [],
  quote: opts.quote ?? '',
  url: opts.url ?? 'https://example.com',
  title: opts.title ?? 'Title',
  blockId: opts.blockId,
  lang: opts.lang ?? 'en',
  createdAt: opts.createdAt ?? 1000,
  srs: opts.srs ?? null,
})

describe('validateSentence', () => {
  it('accepts a normal sentence', () => {
    expect(validateSentence('The quick brown fox jumps.').ok).toBe(true)
  })
  it('rejects empty', () => {
    expect(validateSentence('   ').ok).toBe(false)
  })
  it('rejects fragments shorter than 10 chars', () => {
    expect(validateSentence('hi there').ok).toBe(false)
  })
  it('rejects paragraphs over 1000 chars', () => {
    expect(validateSentence('a '.repeat(600)).ok).toBe(false)
  })
  it('accepts exactly 10 chars (boundary)', () => {
    expect(validateSentence('1234567890').ok).toBe(true)
  })
})

describe('normalizeSentence', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeSentence('  The   quick\nfox  ')).toBe('The quick fox')
  })
  it('preserves case (sentence-start casing is significant)', () => {
    expect(normalizeSentence('Hello world')).toBe('Hello world')
  })
})

describe('newCardId', () => {
  it('generates unique ids with the s prefix', () => {
    const a = newCardId()
    const b = newCardId()
    expect(a).not.toBe(b)
    expect(a.startsWith('s')).toBe(true)
  })
})

describe('makeSentenceCard', () => {
  it('fills defaults: srs=null, createdAt=now', () => {
    const c = makeSentenceCard({
      id: 's1',
      sentence: 'A test sentence here.',
      translation: '',
      analysis: '',
      keywords: [],
      quote: '',
      url: '',
      title: '',
      lang: 'en',
    })
    expect(c.srs).toBeNull()
    expect(typeof c.createdAt).toBe('number')
  })
  it('normalizes the sentence', () => {
    const c = makeSentenceCard({
      id: 's1',
      sentence: '  messy   spacing  ',
      translation: '',
      analysis: '',
      keywords: [],
      quote: '',
      url: '',
      title: '',
      lang: 'en',
    })
    expect(c.sentence).toBe('messy spacing')
  })
})

describe('mergeSentenceCard', () => {
  it('refreshes analysis/translation/keywords, keeps earliest createdAt, preserves srs', () => {
    const existing = card('s1', 'Hello world', {
      createdAt: 500,
      translation: '旧译文',
      analysis: 'old',
      srs: { due: 9999, interval: 5, ease: 2.5, reps: 3, lapses: 1 },
    })
    const incoming = card('s2', 'Hello world', {
      createdAt: 1000,
      translation: '新译文',
      analysis: 'new',
      keywords: ['hello'],
      srs: null,
    })
    const merged = mergeSentenceCard(existing, incoming)
    expect(merged.createdAt).toBe(500)
    expect(merged.analysis).toBe('new')
    expect(merged.translation).toBe('新译文')
    expect(merged.keywords).toEqual(['hello'])
    expect(merged.srs).toEqual({ due: 9999, interval: 5, ease: 2.5, reps: 3, lapses: 1 })
  })
})

describe('isDuplicateSentence', () => {
  it('matches by normalized sentence, ignoring whitespace differences', () => {
    const a = card('s1', 'Hello   world')
    const b = card('s2', 'Hello world')
    expect(isDuplicateSentence(a, b)).toBe(true)
  })
  it('does NOT match different sentences', () => {
    expect(isDuplicateSentence(card('s1', 'Hello'), card('s2', 'Goodbye'))).toBe(false)
  })
})

describe('dedupeCards', () => {
  it('keeps earliest createdAt on normalized-sentence collision', () => {
    const list = [
      card('s1', 'Hello world', { createdAt: 500, translation: '旧' }),
      card('s2', 'Hello   world', { createdAt: 100, translation: '新' }),
      card('s3', 'Goodbye', { createdAt: 300 }),
    ]
    const out = dedupeCards(list)
    expect(out.length).toBe(2)
    const hw = out.find((c) => normalizeSentence(c.sentence) === 'Hello world')
    expect(hw?.createdAt).toBe(100)
    expect(hw?.translation).toBe('新')
  })
  it('returns empty for empty input', () => {
    expect(dedupeCards([])).toEqual([])
  })
})

describe('searchSentences', () => {
  const list = [
    card('s1', 'The quick brown fox', { translation: '敏捷的棕狐', keywords: ['fox'] }),
    card('s2', 'A lazy dog', { translation: '懒狗', keywords: ['dog'], title: 'Animals' }),
  ]
  it('matches sentence text case-insensitively', () => {
    expect(searchSentences(list, 'FOX').length).toBe(1)
  })
  it('matches translation', () => {
    expect(searchSentences(list, '懒狗').length).toBe(1)
  })
  it('matches keywords', () => {
    expect(searchSentences(list, 'dog').length).toBe(1)
  })
  it('matches title', () => {
    expect(searchSentences(list, 'animal').length).toBe(1)
  })
  it('returns all on empty query', () => {
    expect(searchSentences(list, '').length).toBe(2)
  })
})

describe('groupSentences', () => {
  it('groups by title+url, newest-first within group', () => {
    const list = [
      card('s1', 'A', { title: 'P1', url: 'u1', createdAt: 100 }),
      card('s2', 'B', { title: 'P1', url: 'u1', createdAt: 300 }),
      card('s3', 'C', { title: 'P2', url: 'u2', createdAt: 200 }),
    ]
    const groups = groupSentences(list)
    expect(groups.size).toBe(2)
    const p1 = groups.get('P1\u0000u1')!
    expect(p1.map((c) => c.id)).toEqual(['s2', 's1']) // newest first
  })
})

const SAMPLE_ANALYSIS = `## 译文
这是一个测试句子。

## 句法结构
- 主语：This
- 谓语：is

## 关键词与搭配
- **test** — 搭配：test case；辨析：test vs exam
- **sentence** — 搭配：write a sentence

## 地道表达
无明显地道表达

## 举一反三
1. This is another test.
2. The test was hard.

## 记忆点
记住 test 的搭配 test case。`

describe('extractTranslation', () => {
  it('extracts the 译文 section', () => {
    expect(extractTranslation(SAMPLE_ANALYSIS)).toBe('这是一个测试句子。')
  })
  it('returns empty string when section is missing', () => {
    expect(extractTranslation('## 其他\n\n内容')).toBe('')
  })
})

describe('extractKeywords', () => {
  it('extracts bolded headwords from 关键词与搭配', () => {
    expect(extractKeywords(SAMPLE_ANALYSIS)).toEqual(['test', 'sentence'])
  })
  it('returns empty array when section is missing', () => {
    expect(extractKeywords('## 译文\n\nx')).toEqual([])
  })
  it('returns empty array when no bolded words', () => {
    expect(extractKeywords('## 关键词与搭配\n\n- plain bullet')).toEqual([])
  })
})

describe('exportSentences / importSentences round-trip', () => {
  const list = [
    card('s1', 'Hello world', { createdAt: 100, keywords: ['hi'] }),
    card('s2', 'Goodbye', { createdAt: 200, srs: null }),
  ]
  it('round-trips losslessly', () => {
    const json = exportSentences(list)
    const result = importSentences(json)
    expect(result.ok).toBe(true)
    expect(result.cards).toEqual(list)
  })
  it('produces pretty JSON', () => {
    expect(exportSentences(list).includes('\n')).toBe(true)
  })
})

describe('importSentences', () => {
  it('rejects malformed JSON', () => {
    const r = importSentences('{not json')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
  it('rejects non-array top-level', () => {
    expect(importSentences(JSON.stringify({ x: 1 })).ok).toBe(false)
  })
  it('skips rows missing required fields, keeps good ones', () => {
    const dirty = [
      { id: 's1', sentence: 'Hello world', translation: 't', analysis: 'a', keywords: [], quote: '', url: 'u', title: 'T', lang: 'en', createdAt: 1, srs: null },
      { id: 's2', sentence: '' }, // bad: empty sentence
      { notEven: 'a card' },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.ok).toBe(true)
    expect(r.cards?.length).toBe(1)
  })
  it('fills defaults for optional fields (srs=null, createdAt=now)', () => {
    const minimal = [{ id: 's1', sentence: 'A real sentence.', translation: '', analysis: '', keywords: [], quote: '', url: '', title: '', lang: 'en' }]
    const r = importSentences(JSON.stringify(minimal))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toBeNull()
    expect(typeof r.cards?.[0].createdAt).toBe('number')
  })
})

describe('SENTENCE_CARD_SYSTEM_PROMPT', () => {
  it('contains all 6 H2 section headers', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 译文')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 句法结构')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 关键词与搭配')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 地道表达')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 举一反三')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 记忆点')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `NODE_ENV=development npm test -- sentences`
Expected: FAIL — 模块不存在，import 报错。

- [ ] **Step 3: 实现 `src/shared/sentences.ts`**

```ts
// 句库（Sentence Library）领域逻辑 for Feature ④.
//
// Pure functions, zero deps. Each card holds a structured deep analysis of one
// English sentence (译文/句法/关键词搭配/地道表达/举一反三/记忆点), produced by the
// BYOK AI as fixed-H2 Markdown. We store the verbatim Markdown (rendered by the
// dependency-free renderMarkdown) and regex-extract translation + keywords into
// structured fields for dedup / search / SRS review.
//
// 对标 Trancy「AI Grammar Analysis」+ Language Reactor「phrasebook」+ Ludwig「collocation」。
// 与轻量工具栏 Explain（一行 prompt 速答）并存：本模块是结构化、可沉淀、可复习的重型卡片。
//
// Persistence is handled by the zustand store (see store.ts).

import type { SrsState } from './srs'

export interface SentenceCard {
  /** 's' + base36(time) + random — 对齐 vocab('v')/highlight('h') 前缀约定。*/
  id: string
  /** 原句，归一化（trim + 折叠内部空白）。用于去重键和翻卡正面。*/
  sentence: string
  /** 译文，从 analysis 正则提取。用于去重/搜索/翻卡正面补充。提取失败为 ''。*/
  translation: string
  /** AI 原始 Markdown（6 节 H2），renderMarkdown 直接渲染的唯一来源。*/
  analysis: string
  /** 关键词，从「关键词与搭配」节正则提取。用于标签式搜索。提取失败为 []。*/
  keywords: string[]
  /** 原文上下文 ±200 字符，镜像 Highlight.quote。*/
  quote: string
  url: string
  title: string
  /** data-lector-id，跳回原文复用 content.ts 现有滚动逻辑。*/
  blockId?: string
  lang: string
  createdAt: number
  /** null = 被动参考；opt-in「加入复习」后 newSrs()。*/
  srs: SrsState | null
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/** 真句子下限（非片段），整段上限（非段落）。*/
const MIN_LEN = 10
const MAX_LEN = 1000

/**
 * 校验候选句子。空/<10/>1000 均拒绝。10~1000 为合法一句。
 */
export function validateSentence(text: string): ValidationResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length < MIN_LEN) return { ok: false, reason: 'too-short' }
  if (trimmed.length > MAX_LEN) return { ok: false, reason: 'too-long' }
  return { ok: true }
}

/**
 * 归一化：trim + 折叠内部空白。保留大小写（句首大小写有意义，假合并会丢信息）。
 */
export function normalizeSentence(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 生成唯一卡片 id。 */
export function newCardId(): string {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 工厂，镜像 makeVocabEntry。srs 默认 null（被动参考）；createdAt 默认 now。
 * 归一化 sentence。
 */
export function makeSentenceCard(
  partial: Omit<SentenceCard, 'srs' | 'createdAt'> & { srs?: SrsState | null; createdAt?: number }
): SentenceCard {
  return {
    ...partial,
    sentence: normalizeSentence(partial.sentence),
    createdAt: partial.createdAt ?? Date.now(),
    srs: partial.srs ?? null,
  }
}

/**
 * 重复合并：刷新 analysis/translation/keywords/quote（取 incoming 非空值），
 * 保留 earliest createdAt + existing srs（永不清零复习进度）。镜像 mergeVocabEntry。
 */
export function mergeSentenceCard(existing: SentenceCard, incoming: SentenceCard): SentenceCard {
  return {
    ...existing,
    analysis: incoming.analysis || existing.analysis,
    translation: incoming.translation || existing.translation,
    keywords: incoming.keywords?.length ? incoming.keywords : existing.keywords,
    quote: incoming.quote || existing.quote,
    url: incoming.url || existing.url,
    title: incoming.title || existing.title,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    srs: existing.srs, // never clobber review progress
  }
}

/**
 * 去重键 = 归一化句子。不按 url——同句跨页即同卡。
 */
export function isDuplicateSentence(a: SentenceCard, b: SentenceCard): boolean {
  return normalizeSentence(a.sentence) === normalizeSentence(b.sentence)
}

/**
 * 列表去重，归一化句子相同者最早 createdAt 优先。镜像 glossary.dedupeEntries
 * （Map + 稳定序保留首次出现顺序）。不 mutate 输入。
 */
export function dedupeCards(cards: SentenceCard[]): SentenceCard[] {
  const seen = new Map<string, SentenceCard>()
  for (const c of cards) {
    const key = normalizeSentence(c.sentence)
    if (!key) continue
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, c)
      continue
    }
    if (c.createdAt < prev.createdAt) seen.set(key, c)
  }
  const out: SentenceCard[] = []
  const used = new Set<string>()
  for (const c of cards) {
    const key = normalizeSentence(c.sentence)
    if (!key || used.has(key)) continue
    out.push(seen.get(key)!)
    used.add(key)
  }
  return out
}

/**
 * 跨 sentence/translation/keywords/title 搜索，大小写不敏感子串。镜像 searchHighlights。
 */
export function searchSentences(cards: SentenceCard[], q: string): SentenceCard[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return cards
  return cards.filter(
    (c) =>
      c.sentence.toLowerCase().includes(needle) ||
      c.translation.toLowerCase().includes(needle) ||
      c.title.toLowerCase().includes(needle) ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(needle))
  )
}

/**
 * 按来源（title + url）分组，组内最新优先。镜像 groupHighlights。
 */
export function groupSentences(cards: SentenceCard[]): Map<string, SentenceCard[]> {
  const map = new Map<string, SentenceCard[]>()
  for (const c of cards) {
    const key = `${c.title}\u0000${c.url}`
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => b.createdAt - a.createdAt)
  }
  return map
}

/**
 * 从 analysis 提取译文：锚定 `## 译文` 节到下一个 `## ` 或文末。
 * 稳健到节内内容变化；缺节返回 ''。
 */
export function extractTranslation(analysis: string): string {
  const m = analysis.match(/##\s*译文\s*\n([\s\S]*?)(?=\n##\s|$)/)
  return m ? m[1].trim() : ''
}

/**
 * 从「关键词与搭配」节提取加粗 headword（`**word**`）。缺节或无加粗返回 []。
 */
export function extractKeywords(analysis: string): string[] {
  const section = analysis.match(/##\s*关键词与搭配\s*\n([\s\S]*?)(?=\n##\s|$)/)?.[1] ?? ''
  const out: string[] = []
  for (const line of section.split('\n')) {
    const m = line.match(/^\s*[-*]\s*\*\*([^*]+)\*\*/)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** 序列化为 pretty JSON（备份/迁移）。 */
export function exportSentences(cards: SentenceCard[]): string {
  return JSON.stringify(cards, null, 2)
}

/**
 * 从 JSON 导入，容忍脏数据：非法 JSON / 非数组顶层返回 { ok:false }；
 * 缺必填字段的行静默跳过。镜像 importGlossary。
 */
export function importSentences(json: string): {
  ok: boolean
  cards?: SentenceCard[]
  reason?: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'invalid JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'top-level JSON must be an array' }
  }
  const now = Date.now()
  const cards: SentenceCard[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const sentence = typeof r.sentence === 'string' ? r.sentence : ''
    if (!validateSentence(sentence).ok) continue
    const id = typeof r.id === 'string' ? r.id : newCardId()
    const translation = typeof r.translation === 'string' ? r.translation : ''
    const analysis = typeof r.analysis === 'string' ? r.analysis : ''
    const keywords = Array.isArray(r.keywords) ? r.keywords.filter((k): k is string => typeof k === 'string') : []
    const quote = typeof r.quote === 'string' ? r.quote : ''
    const url = typeof r.url === 'string' ? r.url : ''
    const title = typeof r.title === 'string' ? r.title : ''
    const blockId = typeof r.blockId === 'string' ? r.blockId : undefined
    const lang = typeof r.lang === 'string' ? r.lang : 'en'
    const createdAt = typeof r.createdAt === 'number' ? r.createdAt : now
    const srs = r.srs && typeof r.srs === 'object' ? (r.srs as SrsState) : null
    cards.push({ id, sentence, translation, analysis, keywords, quote, url, title, blockId, lang, createdAt, srs })
  }
  return { ok: true, cards }
}

/**
 * System prompt：要求模型输出恰好 6 节 H2 Markdown。固定 header 同时是
 * extractTranslation/extractKeywords 的正则锚点。英文指令式，对齐 content.ts 既有
 * prompt 风格。讲解用中文，例句用英文。
 */
export const SENTENCE_CARD_SYSTEM_PROMPT = `You are Lector AI, an English-reading tutor for Chinese learners. The user gives
you ONE English sentence. Produce a structured "sentence card" that helps them
deeply understand and remember it.

Output ONLY clean Markdown with EXACTLY these H2 sections, in this order, and
NOTHING before the first "## " or after the last section:

## 译文
<faithful Chinese translation, one line>

## 句法结构
<break down 主谓宾 / clause structure / grammar points; 2-4 short lines or bullets>

## 关键词与搭配
- **<word>** — 搭配：<collocations>；辨析：<nuance vs near-synonyms>
(2-4 bullets; always bold the headword with **word**)

## 地道表达
<idioms / register / native phrasing; 1-3 lines; if none, write 无明显地道表达>

## 举一反三
1. <a fresh English example sentence reusing a key structure or word>
2. <another>
3. <another>

## 记忆点
<one punchy line: the single thing worth remembering>

Rules: explanations in Chinese, example sentences in English. No code fences,
no extra commentary, no leading/trailing prose.`
```

- [ ] **Step 4: 运行测试确认通过**

Run: `NODE_ENV=development npm test -- sentences`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: typecheck + commit**

Run: `NODE_ENV=development npm run typecheck`
Expected: 无错误。

```bash
git add src/shared/sentences.ts tests/sentences.test.ts
git commit -m "feat(sentences): add pure sentences module + tests (Feature ④)"
```

---

### Task 2: Anki 导出映射 `sentenceToAnkiNote` + 单测

**Files:**
- Modify: `src/shared/anki.ts`
- Test: `tests/anki.test.ts`（如不存在则 Create）

**Interfaces:**
- Consumes: `SentenceCard` from Task 1; 现有 `AnkiNote`, `withAnkiDefaults`, `exportVocabToAnki`。
- Produces: `sentenceToAnkiNote(card, opts)`, `exportSentencesToAnki(cards, opts)`. Task 9 UI 消费。

- [ ] **Step 1: 读现有 anki.test.ts 确认测试风格（若存在）**

Run: `cat tests/anki.test.ts 2>/dev/null | head -20 || echo "NOT FOUND"`
若不存在，本 task 同时创建它（含 vocab 现有映射的回归测试 + 新增 sentence 测试）。

- [ ] **Step 2: 写失败的 sentence→Anki 测试**

Append to `tests/anki.test.ts`（若文件不存在则新建并 import 现有被测函数补回归测试；下面只展示新增部分）:

```ts
import { sentenceToAnkiNote, exportSentencesToAnki } from '../src/shared/anki'
import type { SentenceCard } from '../src/shared/sentences'

const sc = (over: Partial<SentenceCard> = {}): SentenceCard => ({
  id: 's1',
  sentence: 'The quick brown fox jumps.',
  translation: '敏捷的棕色狐狸跳跃。',
  analysis: '## 译文\n\n敏捷的棕色狐狸跳跃。\n\n## 记忆点\n\n记住 jumps。',
  keywords: ['fox'],
  quote: 'context here',
  url: 'https://example.com/p',
  title: 'Page',
  blockId: 'b3',
  lang: 'en',
  createdAt: 1000,
  srs: null,
  ...over,
})

describe('sentenceToAnkiNote', () => {
  it('maps sentence→Front, translation+analysis+source→Back', () => {
    const note = sentenceToAnkiNote(sc(), { deckName: 'Lector::Sentences', modelName: 'Basic', tags: ['lector'] })
    expect(note.fields.Front).toBe('The quick brown fox jumps.')
    expect(note.fields.Back).toContain('敏捷的棕色狐狸跳跃。')
    expect(note.fields.Back).toContain('## 记忆点')
    expect(note.fields.Back).toContain('https://example.com/p')
    expect(note.deckName).toBe('Lector::Sentences')
    expect(note.tags).toEqual(['lector'])
  })
  it('degrades gracefully when translation is empty', () => {
    const note = sentenceToAnkiNote(sc({ translation: '' }), { deckName: 'D', modelName: 'Basic' })
    expect(note.fields.Front).toBe('The quick brown fox jumps.')
    // Back still contains the analysis; no crash.
    expect(note.fields.Back).toContain('## 记忆点')
  })
  it('degrades gracefully when url/title empty', () => {
    const note = sentenceToAnkiNote(sc({ url: '', title: '' }), { deckName: 'D', modelName: 'Basic' })
    expect(note.fields.Back).not.toContain('Source:')
  })
})

describe('exportSentencesToAnki', () => {
  it('returns zero-added on empty input without calling fetch', async () => {
    const r = await exportSentencesToAnki([], { url: 'http://127.0.0.1:8765', deckName: 'D', modelName: 'Basic', tags: [] })
    expect(r.added).toBe(0)
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `NODE_ENV=development npm test -- anki`
Expected: FAIL — `sentenceToAnkiNote` 未导出。

- [ ] **Step 4: 实现 — 追加到 `src/shared/anki.ts` 末尾**

在文件顶部 import 区追加（若 VocabEntry import 已存在则并列）:
```ts
import type { SentenceCard } from './sentences'
```
在 `exportVocabToAnki` 之后追加:

```ts
/** 句库导出 Anki 默认牌组名（与 Vocab 区分）。 */
export const DEFAULT_SENTENCE_DECK_NAME = 'Lector::Sentences'

/**
 * Map a SentenceCard to an AnkiConnect addNote payload. Front = 原句；
 * Back = 译文 + 完整 analysis Markdown + 来源链接。空字段优雅降级。
 */
export function sentenceToAnkiNote(
  c: SentenceCard,
  opts: { deckName: string; modelName: string; tags?: string[] }
): AnkiNote {
  return {
    deckName: opts.deckName,
    modelName: opts.modelName,
    fields: { Front: c.sentence, Back: renderSentenceBack(c) },
    tags: opts.tags ?? [],
  }
}

/** Render the back-of-card content for a sentence card. */
function renderSentenceBack(c: SentenceCard): string {
  const parts: string[] = []
  if (c.translation?.trim()) {
    parts.push(c.translation.trim())
  }
  if (c.analysis?.trim()) {
    parts.push('')
    parts.push(c.analysis.trim())
  }
  if (c.url?.trim() || c.title?.trim()) {
    parts.push('')
    const title = c.title?.trim() || 'Source'
    const url = c.url?.trim()
    parts.push(url ? `Source: [${title}](${url})` : `Source: ${title}`)
  }
  // 若译文和分析都空，给占位避免 Anki 拒收空 Back。
  if (parts.length === 0) parts.push('(no analysis yet)')
  return parts.join('\n')
}

/**
 * Export a batch of sentence cards to Anki. Mirrors exportVocabToAnki:
 * createDeck + N×addNote as a single multi action, tally added/duplicated/failed.
 */
export async function exportSentencesToAnki(
  cards: SentenceCard[],
  opts: AnkiConfig
): Promise<AnkiExportResult> {
  const result: AnkiExportResult = { added: 0, duplicated: 0, failed: 0, errors: [] }
  if (cards.length === 0) return result

  const actions: AnkiConnectAction[] = [
    { action: 'createDeck', params: { deck: opts.deckName } },
    ...cards.map((c) => ({
      action: 'addNote',
      params: { note: sentenceToAnkiNote(c, { deckName: opts.deckName, modelName: opts.modelName, tags: opts.tags }) },
    })),
  ]

  const res = await invokeAnkiConnect(opts.url, actions)
  if (!res.ok) {
    result.failed = cards.length
    result.errors.push(res.error || 'Unknown AnkiConnect error')
    return result
  }

  const perAction = Array.isArray(res.result) ? (res.result as unknown[]) : []
  for (let i = 0; i < cards.length; i++) {
    const addResult = perAction[i + 1]
    if (addResult === null) {
      result.duplicated += 1
    } else if (typeof addResult === 'number' && addResult > 0) {
      result.added += 1
    } else {
      result.failed += 1
      result.errors.push(`"${cards[i].sentence.slice(0, 30)}…" was rejected by AnkiConnect`)
    }
  }
  return result
}
```

- [ ] **Step 5: 运行确认通过 + typecheck**

Run: `NODE_ENV=development npm test -- anki && NODE_ENV=development npm run typecheck`
Expected: PASS，无类型错误。

- [ ] **Step 6: commit**

```bash
git add src/shared/anki.ts tests/anki.test.ts
git commit -m "feat(sentences): add sentenceToAnkiNote + exportSentencesToAnki"
```

---

### Task 3: i18n 字符串

**Files:**
- Modify: `src/shared/i18n.ts`

**Interfaces:**
- Produces: 新增 `StringKey` 条目（toolbar.explainSentence, side.sentences.*, sentence.section.*, sentence.err.*, side.sentences.fromVocab, side.sentences.fromHighlight）。所有后续 UI task 消费。

- [ ] **Step 1: 定位插入点**

在 `src/shared/i18n.ts` 的 `toolbar.saveWord` 行（约 line 123）之后插入 toolbar 键；在 `side.vocab.*` 区块（约 line 145）之后插入 sentences 区块；在 `popup.result.explain`（约 line 151）之后插入 popup 键。

- [ ] **Step 2: 添加字符串**

在 `STRINGS` 对象中按命名空间插入（精确文本如下）。**toolbar 区**——在 `'toolbar.saveWord'` 后加:
```ts
  'toolbar.explainSentence': { en: '🃏 Explain sentence', zh: '🃏 讲解句子' },
```
**side.sentences 区**——在 `side.vocab.easy` 之后加:
```ts
  // --- side panel: sentence library drawer (Feature ④) ---
  'side.sentences.title': { en: 'Sentences', zh: '句库' },
  'side.sentences.empty': {
    en: 'Select a sentence on any page and tap "Explain sentence", or paste one here.',
    zh: '在页面选中句子点击"讲解句子"，或在此粘贴一句。',
  },
  'side.sentences.search': { en: 'Search sentence / word…', zh: '搜索句子或单词…' },
  'side.sentences.export': { en: '⬇ Export', zh: '⬇ 导出' },
  'side.sentences.import': { en: '⬆ Import', zh: '⬆ 导入' },
  'side.sentences.importFail': { en: 'Import failed: {msg}', zh: '导入失败：{msg}' },
  'side.sentences.importOk': { en: 'Imported {n} cards', zh: '已导入 {n} 张卡片' },
  'side.sentences.viewSource': { en: 'View source', zh: '查看原文' },
  'side.sentences.addToReview': { en: 'Add to review', zh: '加入复习' },
  'side.sentences.inReview': { en: 'Reviewing', zh: '复习中' },
  'side.sentences.remove': { en: 'Remove', zh: '删除' },
  'side.sentences.generating': { en: 'Analyzing sentence…', zh: '分析句子中…' },
  'side.sentences.toAnki': { en: 'Send to Anki', zh: '发送到 Anki' },
  'side.sentences.due': { en: 'due', zh: '待复习' },
  'side.sentences.reviews': { en: 'reviews', zh: '次' },
  'side.sentences.showAnalysis': { en: 'Show analysis', zh: '显示讲解' },
  'side.sentences.hideAnalysis': { en: 'Hide', zh: '收起' },
  'side.sentences.pasteTitle': { en: 'Explain a sentence', zh: '讲解一个句子' },
  'side.sentences.pastePlaceholder': { en: 'Paste an English sentence…', zh: '粘贴一句英文…' },
  'side.sentences.pasteGenerate': { en: 'Generate card', zh: '生成卡片' },
  'side.sentences.pasteEmpty': { en: 'Enter a sentence first.', zh: '请先输入一个句子。' },
  'side.sentences.fromVocab': { en: 'Explain this word', zh: '讲解这个词' },
  'side.sentences.fromHighlight': { en: 'Explain this sentence', zh: '讲解这句话' },
  'side.sentences.noContext': {
    en: 'This word has no saved sentence. Paste one to generate a card.',
    zh: '该词没有保存的例句，请在句库粘贴一句来生成卡片。',
  },
```
**popup 区**——在 `popup.result.explain` 之后加:
```ts
  'popup.result.explainSentence': { en: '🃏 Sentence card', zh: '🃏 讲解卡片' },
```
**sentence 节标题 + 错误区**——在 STRINGS 末尾（`}` 闭合前）追加:
```ts
  // --- sentence card section labels (optional structured render) ---
  'sentence.section.translation': { en: 'Translation', zh: '译文' },
  'sentence.section.syntax': { en: 'Syntax', zh: '句法结构' },
  'sentence.section.keywords': { en: 'Key words', zh: '关键词与搭配' },
  'sentence.section.idiom': { en: 'Native expression', zh: '地道表达' },
  'sentence.section.examples': { en: 'Examples', zh: '举一反三' },
  'sentence.section.takeaway': { en: 'Memory point', zh: '记忆点' },
  'sentence.err.emptyResponse': { en: '(empty analysis)', zh: '（分析为空）' },
```

- [ ] **Step 3: typecheck 确认 StringKey 推导无误**

Run: `NODE_ENV=development npm run typecheck`
Expected: 无错误（新 key 自动进入 `StringKey` union）。

- [ ] **Step 4: commit**

```bash
git add src/shared/i18n.ts
git commit -m "feat(sentences): add i18n strings (en/zh) for sentence library"
```

---

### Task 4: 句库图标

**Files:**
- Modify: `src/shared/icons.tsx`

**Interfaces:**
- Produces: `SentenceCardIcon`（或名 `CardsIcon`）。Task 6 header 按钮消费。

- [ ] **Step 1: 在 icons.tsx 末尾（`UploadIcon` 之后）追加图标**

```tsx
export function CardsIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>)
}
```

- [ ] **Step 2: typecheck**

Run: `NODE_ENV=development npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: commit**

```bash
git add src/shared/icons.tsx
git commit -m "feat(sentences): add CardsIcon for sentence library"
```

---

### Task 5: store 扩展（状态 + actions + partialize）

**Files:**
- Modify: `src/shared/store.ts`

**Interfaces:**
- Consumes: `SentenceCard`, `normalizeSentence`, `makeSentenceCard`, `mergeSentenceCard`, `dedupeCards`, `newCardId` from Task 1；`newSrs` from srs。
- Produces: `sentences: SentenceCard[]` + `addSentence` / `updateSentence` / `removeSentence` / `replaceSentences` / `promoteSentenceToReview` / `updateSentenceSrs`。Task 6/7/8/9 消费。

- [ ] **Step 1: 加 import + 状态字段 + action 签名**

在 `store.ts` 顶部 import 区（line 8 `import { newEntryId, type GlossaryEntry } from './glossary'` 之后）加:
```ts
import { newCardId, normalizeSentence, makeSentenceCard, mergeSentenceCard, dedupeCards, type SentenceCard } from './sentences'
```
在 `AppState` 接口（glossary 字段 line 40 之后、`// Actions` 之前）加状态字段:
```ts
  // Sentence library — structured deep-analysis cards (Feature ④).
  sentences: SentenceCard[]
```
在 `replaceGlossary` 签名（line 68）之后加 action 签名:
```ts
  addSentence: (s: Omit<SentenceCard, 'id' | 'createdAt'> & { createdAt?: number }) => void
  updateSentence: (id: string, patch: Partial<SentenceCard>) => void
  removeSentence: (id: string) => void
  replaceSentences: (cards: SentenceCard[]) => void
  /** Opt a passive reference card into SRS review: srs null → newSrs(). */
  promoteSentenceToReview: (id: string) => void
  /** Advance/punish an already-reviewable card's SRS. No-op if srs is null. */
  updateSentenceSrs: (id: string, srs: SrsState) => void
```

- [ ] **Step 2: 加初始值 + 实现**

在 `create(...)` 的初始状态区（`glossary: [],` line 79 之后）加:
```ts
      sentences: [],
```
在 `replaceGlossary` 实现（line 210-230）之后、`}),` 闭合前加 actions:
```ts
      addSentence: (s) =>
        set((state) => {
          const idx = state.sentences.findIndex(
            (x) => normalizeSentence(x.sentence) === normalizeSentence(s.sentence)
          )
          if (idx === -1) {
            const card: SentenceCard = makeSentenceCard({ ...s, id: newCardId() })
            return { sentences: [card, ...state.sentences].slice(0, 1000) }
          }
          // merge: refresh analysis/translation/keywords/quote, preserve srs + earliest createdAt
          const existing = state.sentences[idx]
          const incoming = makeSentenceCard({ ...s, id: existing.id, createdAt: Date.now() })
          const merged = mergeSentenceCard(existing, incoming)
          const next = [...state.sentences]
          next[idx] = merged
          return { sentences: next }
        }),
      updateSentence: (id, patch) =>
        set((s) => ({
          sentences: s.sentences.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeSentence: (id) =>
        set((s) => ({ sentences: s.sentences.filter((x) => x.id !== id) })),
      replaceSentences: (cards) =>
        set(() => {
          const deduped = dedupeCards(cards)
          return { sentences: deduped.slice(0, 1000) }
        }),
      promoteSentenceToReview: (id) =>
        set((s) => ({
          sentences: s.sentences.map((c) =>
            c.id === id && c.srs === null ? { ...c, srs: newSrs() } : c
          ),
        })),
      updateSentenceSrs: (id, srs) =>
        set((s) => ({
          sentences: s.sentences.map((c) => (c.id === id ? { ...c, srs } : c)),
        })),
```

- [ ] **Step 3: partialize 加一行**

在 `partialize`（line 238-245）的 `glossary: state.glossary,` 之后加:
```ts
        sentences: state.sentences,
```

- [ ] **Step 4: typecheck + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test`
Expected: 无类型错误，既有测试全绿（store 改动不破坏现有）。

- [ ] **Step 5: commit**

```bash
git add src/shared/store.ts
git commit -m "feat(sentences): extend zustand store with sentences state + actions"
```

---

### Task 6: background 中转 + content 工具栏按钮（路径 A 闭环）

**Files:**
- Modify: `src/background.ts`
- Modify: `src/content.ts`

**Interfaces:**
- Consumes: `getSettings`, `completeOnce` from byok；`SENTENCE_CARD_SYSTEM_PROMPT`, `extractTranslation`, `extractKeywords`, `newCardId`, `makeSentenceCard` from Task 1；`tr` from i18n（content）。
- Produces: background 处理 `lector-explain-sentence` 消息 → 写 `chrome.storage.local.lectorSentences`；content 新增工具栏按钮 + `handleExplainSentence`。

- [ ] **Step 1: background.ts — 加消息分支**

在 `background.ts` 的 `chrome.runtime.onMessage.addListener` 回调中，`lector-save-word` 分支（line 56-59）之后、`return false` 之前加:
```ts
  if (message?.action === 'lector-explain-sentence') {
    handleExplainSentenceRelay(message).catch(() => {})
    return false
  }
```
在文件 `import` 区（line 10 之后）加:
```ts
import { SENTENCE_CARD_SYSTEM_PROMPT, extractTranslation, extractKeywords, newCardId } from './shared/sentences'
```
在 `handleSaveWordRelay` 函数之后（`openSidePanel` 之前）加新函数:
```ts
async function handleExplainSentenceRelay(message: {
  sentence: string
  quote: string
  url: string
  title: string
  blockId?: string
}) {
  const settings = await getSettings()
  if (!settings.apiKey) {
    // 无 key：不生成卡片，引导用户去侧栏配置（content 已弹提示，此处静默返回）。
    return
  }
  let analysis = ''
  try {
    analysis = await completeOnce(
      settings,
      SENTENCE_CARD_SYSTEM_PROMPT,
      message.sentence,
      { maxTokens: 1200, temperature: 0.4 }
    )
  } catch {
    analysis = '' // 空分析；卡片仍创建，UI 显示占位
  }
  const card = {
    id: newCardId(),
    sentence: message.sentence,
    translation: extractTranslation(analysis),
    analysis,
    keywords: extractKeywords(analysis),
    quote: message.quote,
    url: message.url,
    title: message.title,
    blockId: message.blockId,
    lang: 'en',
    createdAt: Date.now(),
    srs: null,
  }
  chrome.storage.local.get(['lectorSentences'], (r) => {
    const list = Array.isArray(r.lectorSentences) ? r.lectorSentences : []
    list.unshift(card)
    chrome.storage.local.set({ lectorSentences: list.slice(0, 50) })
  })
}
```

- [ ] **Step 2: content.ts — 加工具栏按钮**

在 `createToolbar`（content.ts line 223 `handleSaveWord` append 之后）加按钮:
```ts
  selectionToolbar.appendChild(mk('t-btn', tr('toolbar.explainSentence'), () => handleExplainSentence(text)))
```
在 `handleSaveWord` 函数（line 496-511）之后加新函数:
```ts
function handleExplainSentence(sentence: string) {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode?.parentElement
  const block = anchor?.closest('[data-lector-id]') as HTMLElement | null
  const blockId = block?.getAttribute('data-lector-id') || undefined
  const quote = (anchor?.textContent || sentence).slice(0, 200)
  void relayOrAlert({
    action: 'lector-explain-sentence',
    sentence,
    quote,
    url: location.href,
    title: document.title,
    blockId,
  })
  removeToolbar()
}
```

- [ ] **Step 3: typecheck + build**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build`
Expected: 无错误，build 产出（content 是 IIFE 单文件，确认无 import 报错）。

- [ ] **Step 4: commit**

```bash
git add src/background.ts src/content.ts
git commit -m "feat(sentences): add toolbar button + background relay (path A)"
```

---

### Task 7: 侧栏 onChanged drain（接 background 中转进 store）

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `useStore.getState().addSentence`（Task 5）；`SentenceCard` 类型。
- Produces: `lectorSentences` temp-key 自动 drain 进 store。

- [ ] **Step 1: 加 import**

在 App.tsx 顶部 import 区加（与既有 `VocabEntry`/`Highlight` import 并列）:
```ts
import type { SentenceCard } from '../shared/sentences'
```

- [ ] **Step 2: 在 onChanged 监听器加分支**

定位 `chrome.storage.onChanged` 的 `onStorage` 回调（约 line 141-161），在 `if (changes.lectorVocab) { ... }` 块之后、回调结束前加:
```ts
    if (changes.lectorSentences) {
      const list = (changes.lectorSentences.newValue as unknown as SentenceCard[]) || []
      const addSentence = useStore.getState().addSentence
      for (const c of list) addSentence(c)
      chrome.storage.local.remove('lectorSentences')
    }
```

- [ ] **Step 3: typecheck + build**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build`
Expected: 无错误。

- [ ] **Step 4: commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sentences): drain lectorSentences temp key into store"
```

---

### Task 8: SentencesDrawer 组件 + header 按钮

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `useStore`（sentences, addSentence, removeSentence, promoteSentenceToReview, updateSentenceSrs, replaceSentences）；`searchSentences`, `groupSentences`, `exportSentences`, `importSentences` from Task 1；`isDue`, `scheduleSrs`, `Grade`, `newSrs` from srs；`renderMarkdown`；`CardsIcon`, `XIcon`, `DownloadIcon`, `UploadIcon`, `SparklesIcon` from icons；`SentenceCard` 类型；i18n keys (Task 3)。
- Produces: 句库抽屉 UI（列表/搜索/删除/跳回原文/标记复习）+ header 图标按钮（带 due badge）。

- [ ] **Step 1: 加 show 状态 + store 选择器**

在 App.tsx 的 useState 区（约 line 84-90，`showGlossary` 之后）加:
```ts
const [showSentences, setShowSentences] = useState(false)
const [revealedSentences, setRevealedSentences] = useState<Set<string>>(new Set())
```
在 store 选择器区（`const glossary = useStore(...)` 附近）加:
```ts
const sentences = useStore((s) => s.sentences)
```

- [ ] **Step 2: 加 header 按钮**

在 header 按钮行，Glossary 按钮（约 line 459-469）之后加句库按钮:
```tsx
<button
  onClick={() => setShowSentences(true)}
  title={tr('side.sentences.title')}
  aria-label={tr('side.sentences.title')}
  className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
>
  <CardsIcon />
  {sentences.some((c) => c.srs && isDue(c.srs)) && (
    <span className="lector-due-badge absolute -top-0.5 -right-1">!</span>
  )}
</button>
```
在 import 区加 `CardsIcon`（若未导入）:
```ts
import { CardsIcon } from '../shared/icons'  // 追加到既有 icons import
```

- [ ] **Step 3: 加抽屉挂载**

在 GlossaryDrawer 挂载（约 line 819-829）之后加:
```tsx
{showSentences && (
  <SentencesDrawer
    sentences={sentences}
    revealed={revealedSentences}
    tr={tr}
    onClose={() => setShowSentences(false)}
    onToggleReveal={(id) =>
      setRevealedSentences((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    onRemove={(id) => removeSentence(id)}
    onPromote={(id) => promoteSentenceToReview(id)}
    onGrade={(c, g) => {
      if (c.srs) updateSentenceSrs(c.id, scheduleSrs(c.srs, g))
      setRevealedSentences((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
    }}
    onViewSource={(blockId, url) => {
      if (blockId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id
          if (tabId !== undefined) {
            chrome.tabs.sendMessage(tabId, { action: 'lector-jump-to', blockId }, () => {
              void chrome.runtime.lastError
            })
          }
        })
      } else if (url) {
        window.open(url, '_blank')
      }
    }}
  />
)}
```
（上方用到的 `removeSentence`/`promoteSentenceToReview`/`updateSentenceSrs` 从 store 取，在 App 顶部加选择器：）
```ts
const removeSentence = useStore((s) => s.removeSentence)
const promoteSentenceToReview = useStore((s) => s.promoteSentenceToReview)
const updateSentenceSrs = useStore((s) => s.updateSentenceSrs)
const replaceSentences = useStore((s) => s.replaceSentences)
```

- [ ] **Step 4: 实现 SentencesDrawer 组件**

在 App.tsx 文件底部（其它 Drawer 组件之后）加组件。需要 import: `searchSentences`, `groupSentences`, `exportSentences`, `importSentences` from `'../shared/sentences'`；`isDue`, `scheduleSrs`, `Grade`, `newSrs` from `'../shared/srs'`；`renderMarkdown` from `'./markdown'`；`DownloadIcon`, `UploadIcon`, `SparklesIcon`, `XIcon` from icons。

```tsx
interface SentencesDrawerProps {
  sentences: SentenceCard[]
  revealed: Set<string>
  tr: (key: StringKey) => string
  onClose: () => void
  onToggleReveal: (id: string) => void
  onRemove: (id: string) => void
  onPromote: (id: string) => void
  onGrade: (c: SentenceCard, grade: Grade) => void
  onViewSource: (blockId: string | undefined, url: string) => void
}

function SentencesDrawer(props: SentencesDrawerProps) {
  const { sentences, revealed, tr, onClose } = props
  const [query, setQuery] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const filtered = searchSentences(sentences, query)
  const groups = groupSentences(filtered)

  const handleGenerate = async () => {
    const text = pasteText.trim()
    if (!text) {
      setImportMsg({ ok: false, text: tr('side.sentences.pasteEmpty') })
      return
    }
    setGenerating(true)
    setImportMsg(null)
    try {
      const settings = useStore.getState().byok
      if (!settings.apiKey) {
        setImportMsg({ ok: false, text: tr('err.addKey') })
        return
      }
      const analysis = await completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, text, {
        maxTokens: 1200,
        temperature: 0.4,
      })
      useStore.getState().addSentence({
        sentence: text,
        translation: extractTranslation(analysis),
        analysis: analysis || '',
        keywords: extractKeywords(analysis),
        quote: '',
        url: '',
        title: tr('side.sentences.pasteTitle'),
        lang: 'en',
        srs: null,
      })
      setPasteText('')
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setGenerating(false)
    }
  }

  const handleExport = () => {
    const json = exportSentences(sentences)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lector-sentences.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = importSentences(String(reader.result || ''))
      if (!result.ok) {
        setImportMsg({ ok: false, text: tr('side.sentences.importFail').replace('{msg}', result.reason || '') })
        return
      }
      useStore.getState().replaceSentences(result.cards || [])
      setImportMsg({ ok: true, text: tr('side.sentences.importOk').replace('{n}', String(result.cards?.length || 0)) })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <Drawer title={tr('side.sentences.title')} onClose={onClose}>
      {sentences.length === 0 && !pasteText ? (
        <>
          <div className="px-3 py-2 border-b border-line">
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
          </div>
          <Empty text={tr('side.sentences.empty')} />
        </>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-line space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('side.sentences.search')}
              className="lector-input w-full text-[12px]"
            />
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
            <div className="flex gap-2">
              <button onClick={handleExport} className="lector-btn-secondary flex-1 text-[11px]">
                <DownloadIcon size={12} /> {tr('side.sentences.export')}
              </button>
              <label className="lector-btn-secondary flex-1 text-[11px] cursor-pointer text-center">
                <UploadIcon size={12} /> {tr('side.sentences.import')}
                <input type="file" accept="application/json" onChange={handleImport} className="hidden" />
              </label>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...groups.entries()].map(([key, cards]) => {
              const [title, url] = key.split('\u0000')
              return (
                <div key={key}>
                  <div className="px-3 py-1.5 bg-surface-muted text-[10px] font-medium text-ink-faint sticky top-0">
                    {title || tr('side.sentences.pasteTitle')}
                  </div>
                  {cards.map((c) => {
                    const due = c.srs ? isDue(c.srs) : false
                    const isRevealed = revealed.has(c.id)
                    return (
                      <div key={c.id} className="px-3 py-2.5 border-b border-line/60">
                        <div className="flex items-center gap-2">
                          <span className={`text-[12px] font-semibold ${due ? 'text-accent' : 'text-ink'}`}>
                            {c.sentence}
                          </span>
                          {due && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                              {tr('side.sentences.due')}
                            </span>
                          )}
                          {c.srs && (
                            <span className="text-[10px] text-ink-faint">
                              {c.srs.reps} {tr('side.sentences.reviews')}
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            {c.blockId || c.url ? (
                              <button
                                onClick={() => props.onViewSource(c.blockId, c.url)}
                                title={tr('side.sentences.viewSource')}
                                className="text-ink-faint hover:text-accent"
                              >
                                <SparklesIcon size={13} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => (c.srs ? null : props.onPromote(c.id))}
                              className={`text-[10px] ${c.srs ? 'text-accent' : 'text-ink-faint hover:text-accent'}`}
                            >
                              {c.srs ? tr('side.sentences.inReview') : tr('side.sentences.addToReview')}
                            </button>
                            <button onClick={() => props.onRemove(c.id)} className="text-ink-faint hover:text-red-500">
                              <XIcon size={15} />
                            </button>
                          </div>
                        </div>
                        {(c.translation || c.analysis) && (
                          <button
                            onClick={() => props.onToggleReveal(c.id)}
                            className="text-[10px] text-accent hover:underline mt-1"
                          >
                            {isRevealed ? tr('side.sentences.hideAnalysis') : tr('side.sentences.showAnalysis')}
                          </button>
                        )}
                        {isRevealed && (c.translation || c.analysis) && (
                          <div
                            className="lector-prose mt-2 text-[11px] leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.analysis || c.translation) }}
                          />
                        )}
                        {due && c.srs && (
                          <div className="flex gap-1.5 mt-2">
                            {(['again', 'hard', 'good', 'easy'] as Grade[]).map((g) => (
                              <button
                                key={g}
                                onClick={() => props.onGrade(c, g)}
                                className="flex-1 py-1.5 text-[10px] font-medium rounded-md border border-line hover:bg-surface-muted text-ink-soft"
                              >
                                {tr(`side.vocab.${g}` as StringKey)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Drawer>
  )
}

function PasteBox({
  value,
  onChange,
  onGenerate,
  generating,
  tr,
}: {
  value: string
  onChange: (v: string) => void
  onGenerate: () => void
  generating: boolean
  tr: (key: StringKey) => string
}) {
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr('side.sentences.pastePlaceholder')}
        rows={2}
        className="lector-input w-full text-[12px] resize-none"
      />
      <button
        onClick={onGenerate}
        disabled={generating}
        className="lector-btn-primary w-full text-[11px] disabled:opacity-50"
      >
        {generating ? tr('side.sentences.generating') : tr('side.sentences.pasteGenerate')}
      </button>
    </div>
  )
}

function ImportMsg({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <div className={`text-[10px] ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</div>
  )
}
```

注意：上方用到的额外 import 需补齐到 App.tsx 顶部：
```ts
import { searchSentences, groupSentences, exportSentences, importSentences, extractTranslation, extractKeywords, SENTENCE_CARD_SYSTEM_PROMPT } from '../shared/sentences'
import { completeOnce } from '../shared/byok'  // 若未导入
```

- [ ] **Step 5: typecheck + build**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build`
Expected: 无类型错误，build 成功。若有 lector-input/lector-btn-* 等 class 未定义，检查 index.css（这些是现有 utility class，应已存在；若 VocabDrawer 用了同名 class 则复用）。

- [ ] **Step 6: commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sentences): add SentencesDrawer + header button (paste/search/review/source)"
```

---

### Task 9: 联动入口（生词本/高亮 → 生成讲解）+ Anki 导出按钮

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `completeOnce`, `SENTENCE_CARD_SYSTEM_PROMPT`, `extractTranslation`, `extractKeywords`, `useStore.getState().addSentence`；`sentenceToAnkiNote`/`exportSentencesToAnki` from Task 2；`withAnkiDefaults`。
- Produces: VocabDrawer 卡片项「讲解这个词」按钮（vocab.context 非空时生成卡片）；高亮项「讲解这句话」按钮；SentencesDrawer 卡片项「发送到 Anki」按钮 + 批量导出。

- [ ] **Step 1: VocabDrawer 加「讲解这个词」按钮**

在 VocabDrawer 的卡片项（约 line 1107-1152），`onRemoveVocab` 按钮之前加按钮。需要先在 VocabDrawerProps 加一个 `onExplainVocab: (v: VocabEntry) => void` prop，并在 App 挂载处传入:
```tsx
onExplainVocab={(v) => {
  if (!v.context?.trim()) {
    alert(tr('side.sentences.noContext'))
    return
  }
  generateSentenceCard(v.context, v.url, v.title)
}}
```
其中 `generateSentenceCard` 是 App 内的一个 helper（复制 SentencesDrawer.handleGenerate 的核心逻辑，参数化输入）:
```ts
const generateSentenceCard = async (sentence: string, url: string, title: string) => {
  const settings = useStore.getState().byok
  if (!settings.apiKey) {
    alert(tr('err.addKey'))
    return
  }
  const analysis = await completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, sentence, {
    maxTokens: 1200,
    temperature: 0.4,
  })
  useStore.getState().addSentence({
    sentence,
    translation: extractTranslation(analysis),
    analysis: analysis || '',
    keywords: extractKeywords(analysis),
    quote: '',
    url,
    title,
    lang: 'en',
    srs: null,
  })
}
```
VocabDrawer 卡片项按钮 JSX:
```tsx
{v.context?.trim() && (
  <button
    onClick={() => props.onExplainVocab(v)}
    title={tr('side.sentences.fromVocab')}
    className="text-ink-faint hover:text-accent"
  >
    <SparklesIcon size={13} />
  </button>
)}
```

- [ ] **Step 2: 高亮项加「讲解这句话」按钮**

定位高亮列表项渲染（Highlights drawer 内联，约 line 752-787），在每项的操作区加按钮:
```tsx
<button
  onClick={() => generateSentenceCard(h.text, h.url, h.title)}
  title={tr('side.sentences.fromHighlight')}
  className="text-ink-faint hover:text-accent"
>
  <SparklesIcon size={13} />
</button>
```

- [ ] **Step 3: SentencesDrawer 加 Anki 导出**

在 SentencesDrawerProps 加 `onAnkiExport: (cards: SentenceCard[]) => void`，在抽屉顶部操作栏（导入导出按钮行）加一个按钮，并在每张卡片项加单卡导出。App 挂载处传:
```tsx
onAnkiExport={async (cards) => {
  const settings = useStore.getState().byok
  const cfg = withAnkiDefaults(settings.anki)
  const deckName = cfg.deckName === 'Lector::Vocabulary' ? 'Lector::Sentences' : cfg.deckName
  const r = await exportSentencesToAnki(cards, { ...cfg, deckName })
  alert(`Added ${r.added}, duplicated ${r.duplicated}, failed ${r.failed}`)
}}
```
抽屉顶部按钮（在导出/导入行旁）:
```tsx
<button
  onClick={() => props.onAnkiExport(filtered)}
  className="lector-btn-secondary flex-1 text-[11px]"
>
  {tr('side.sentences.toAnki')}
</button>
```

- [ ] **Step 4: typecheck + build + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无错误，全部测试绿。

- [ ] **Step 5: commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sentences): wire vocab/highlight → card generation + Anki export"
```

---

### Task 10: 手动验证清单 + 全量回归

**Files:**
- Modify: `docs/manual-verification-checklist.md`

- [ ] **Step 1: 追加 §14 验证清单**

在 `docs/manual-verification-checklist.md` 末尾追加:
```markdown
## §14 句库与深度讲解卡片（Feature ④）

1. **网页选中生成**：访问英文页面，选中一句完整句子 → 工具栏点「🃏 讲解句子」→
   打开侧栏句库抽屉 → 新卡片出现，6 节齐全（译文/句法/关键词搭配/地道表达/举一反三/记忆点）
2. **搜索**：句库顶部搜索框输入原句中的词 / 译文 / 关键词 → 命中过滤正确
3. **跳回原文**：卡片点「查看原文」→ 页面滚动到原 block（若有 blockId）
4. **粘贴生成**：句库抽屉粘贴框输入一句英文 → 点「生成卡片」→ 新卡片出现（无需开网页）
5. **复习 opt-in**：卡片点「加入复习」→ 标记变「复习中」→ 刷新后仍标记（持久化）→
   header 按钮出现 due badge → 抽屉复习区显示 → 点「显示讲解」翻面 → 四档评分 → 间隔推进
6. **联动-生词**：生词本卡片点「讲解这个词」→ 句库出现卡片（用 vocab.context 原句）；
   若该词无 context → 弹「无例句」提示
7. **联动-高亮**：高亮项点「讲解这句话」→ 句库出现卡片
8. **Anki 导出**：启动 Anki + AnkiConnect → 句库点「发送到 Anki」→ Anki 桌面端
   `Lector::Sentences` 牌组出现新卡（Front=原句，Back=译文+分析+来源）
9. **JSON 导出导入**：导出 lector-sentences.json → 清空句库 → 导入恢复 → 数量一致
10. **去重**：重复保存同一句 → 不重复入库，analysis 刷新但 srs 进度保留
11. **i18n**：切换中/英文 → 所有句库文案正确切换
12. **优雅降级**：未配置 API Key 时点「讲解句子」→ 弹「请添加 Key」引导
```

- [ ] **Step 2: 全量 typecheck + test + build**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test && NODE_ENV=development npm run build`
Expected: 全绿。

- [ ] **Step 3: commit**

```bash
git add docs/manual-verification-checklist.md
git commit -m "docs(sentences): add §14 manual verification checklist"
```

---

## 完成判据（对照 spec 成功标准）

- [x] Task 1: 纯模块 + 单测（6 节提取、去重、搜索、导入导出）
- [x] Task 2: Anki 导出映射
- [x] Task 3: i18n 全覆盖
- [x] Task 4: 图标
- [x] Task 5: store 状态 + 6 action + partialize
- [x] Task 6: 网页选中路径 A 闭环（工具栏→background→AI→store）
- [x] Task 7: onChanged drain
- [x] Task 8: 句库抽屉（搜索/列表/翻卡复习/跳回原文/粘贴生成/导入导出）
- [x] Task 9: 联动（生词/高亮→卡片）+ Anki 导出
- [x] Task 10: 验证清单 + 全量回归

## 风险与缓解

- **App.tsx 体积**：已 ~1876 行，SentencesDrawer 是独立函数组件（与 VocabDrawer 平级），不内联巨型 JSX。若审查时发现过大，可后续抽到独立文件（本期不拆，保持与既有 Drawer 一致）。
- **AI 输出不遵循 6 节**：提取器对缺节降级返回空值，卡片仍可用，用户可删除重生成。
- **completeOnce 在 sidepanel 调用**：粘贴/联动入口直接在 sidepanel 进程调 `completeOnce`（同进程，无需中转），与现有 chat 的 `streamChat` 同进程调用一致，无跨域问题。
- **Phase 2 彩色词性标注**：不在本期范围；spec 已留存升级路径（句法节加标记句 + markdown.ts 加 1 条内联规则）。
