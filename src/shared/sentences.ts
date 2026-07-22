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
