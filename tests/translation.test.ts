import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  detectScript,
  resolveTargetLang,
  detectSourceLang,
  getLanguage,
  isValidLangCode,
  searchLanguages,
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
  isTranslationLikelyUnchanged,
  maxTokensForChunk,
  filterGlossaryForDirection,
  runConcurrent,
  shouldTranslateBlock,
  splitBlockForTranslation,
  MAX_BLOCK_LEN,
  TRANSLATABLE_TAGS,
  EXCLUDED_ANCESTOR_TAGS,
  appendHistory,
  newHistoryId,
  BATCH_SEP,
  buildBatchPrompt,
  parseBatchResult,
  isValidDisplayMode,
  type TargetLangCode,
  type TranslationHistoryEntry,
  type BlockCandidate,
} from '../src/shared/translation'
import type { GlossaryEntry } from '../src/shared/glossary'

const ge = (id: string, source: string, target: string, enabled = true): GlossaryEntry => ({
  id, source, target, enabled, createdAt: 1000,
})

describe('LANGUAGES', () => {
  it('has 100+ entries with unique codes and non-empty speechCode', () => {
    // Expanded from 12 → 100+ to match Immersive Translate's language breadth.
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(100)
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length) // all unique
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
  it('resolves extended catalog entries (thai)', () => {
    expect(getLanguage('th').en).toBe('Thai')
    expect(getLanguage('th').speechCode).toBe('th-TH')
  })
})

describe('isValidLangCode', () => {
  it('accepts codes present in the catalog', () => {
    expect(isValidLangCode('zh')).toBe(true)
    expect(isValidLangCode('th')).toBe(true)
    expect(isValidLangCode('zh-TW')).toBe(true)
  })
  it('rejects unknown codes and non-strings', () => {
    expect(isValidLangCode('xx')).toBe(false)
    expect(isValidLangCode(undefined)).toBe(false)
    expect(isValidLangCode(123)).toBe(false)
  })
})

describe('searchLanguages', () => {
  it('returns the full catalog for an empty query', () => {
    expect(searchLanguages('').length).toBe(LANGUAGES.length)
  })
  it('matches by code, English name, or Chinese name', () => {
    expect(searchLanguages('th').map((l) => l.code)).toContain('th')
    expect(searchLanguages('Thai').map((l) => l.code)).toContain('th')
    expect(searchLanguages('泰语').map((l) => l.code)).toContain('th')
  })
  it('is case-insensitive', () => {
    expect(searchLanguages('FRENCH').map((l) => l.code)).toContain('fr')
  })
})

describe('detectSourceLang', () => {
  it('maps dominant scripts to a representative source code', () => {
    expect(detectSourceLang('Hello world')).toBe('en')
    expect(detectSourceLang('你好世界')).toBe('zh')
    expect(detectSourceLang('Привет')).toBe('ru')
    expect(detectSourceLang('สวัสดี')).toBe('th')
    expect(detectSourceLang('नमस्ते')).toBe('hi')
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
  // Extended script coverage (Phase 1): Hebrew, Greek, Devanagari, Thai so the
  // 'auto' translation direction is correct for a much wider source set.
  it('detects hebrew', () => {
    expect(detectScript('שלום עולם זה טקסט')).toBe('hebrew')
  })
  it('detects greek', () => {
    expect(detectScript('Γεια σας κόσμε αυτό είναι κείμενο')).toBe('greek')
  })
  it('detects devanagari', () => {
    expect(detectScript('नमस्ते दुनिया यह एक पाठ है')).toBe('devanagari')
  })
  it('detects thai', () => {
    expect(detectScript('สวัสดีชาวโลกนี่คือข้อความ')).toBe('thai')
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
  // Regression: an overwhelmingly-English page with a stray CJK char (footer
  // copyright, nav label) must still resolve to Chinese — NOT flip to English.
  // The old bilingual path built a probe string from page.lang (set by a
  // single-char-CJK detectLang), which inverted the direction and translated
  // English to English. resolveTargetLang itself is count-based and robust;
  // this test locks that in.
  it('auto + mostly-latin text with a stray CJK char -> zh', () => {
    const mostlyEnglish = 'Software engineering is the application of engineering. 你好'
    expect(resolveTargetLang('auto', mostlyEnglish)).toBe('zh')
  })
  it('auto + mostly-CJK text with stray latin -> en', () => {
    const mostlyChinese = '这是一个中文段落，讲述软件工程 ABC 的内容。'
    expect(resolveTargetLang('auto', mostlyChinese)).toBe('en')
  })
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

  // Regression: English pages sometimes "translated" back to English because
  // the model over-applied "Keep code blocks, URLs, and HTML tags
  // untranslated" to markup-heavy / technical blocks and echoed the source.
  // The prompt must HARD-require output in the target language so the model
  // never returns the source-language text as-is. This is the single most
  // effective guard against the English→English symptom.
  it('hard-requires output in the target language', () => {
    const p = buildTranslateSystemPrompt('zh', '')
    // Must name the target language as the REQUIRED output language.
    expect(p).toMatch(/must|MUST|entire output|output .{0,20}in/i)
    expect(p.toLowerCase()).toContain('chinese')
  })
  it('keeps glossary translation directive when glossary present', () => {
    const p = buildTranslateSystemPrompt('zh', 'GLOSSARY:\n- API → 接口')
    // Even with glossary, the hard output-language requirement must remain.
    expect(p.toLowerCase()).toContain('chinese')
  })

  // The old prompt told the model to "Keep code blocks, URLs, and HTML tags
  // untranslated" — which is correct for actual code, but when a block is
  // mostly inline <code>/links the model over-applied it and returned the
  // English prose unchanged. Narrowing to "leave code/URLs verbatim but
  // translate surrounding prose" plus a strong target-language requirement
  // closes the gap. Verify the prompt no longer makes a blanket "keep
  // untranslated" claim that would suppress translating prose.
  it('does not blanket-instruct to leave content untranslated', () => {
    const p = buildTranslateSystemPrompt('zh', '')
    // A blanket "Keep ... untranslated" with no qualifier lets the model
    // short-circuit on markup-heavy blocks. The new wording should avoid the
    // unqualified directive.
    expect(p).not.toMatch(/keep .{0,40}untranslated/i)
  })
})

describe('buildTranslateUserPrompt', () => {
  it('echoes the source text unchanged when no source hint', () => {
    // Backwards-compat: callers that pass only text get it back verbatim.
    const u = buildTranslateUserPrompt('Hello world')
    expect(u).toContain('Hello world')
  })
})

describe('isTranslationLikelyUnchanged', () => {
  // The English→English regression: even with a strong prompt, some models
  // echo the source verbatim on ambiguous / short / markup-heavy blocks.
  // The page translator retries such chunks with a forceful "must translate"
  // prefix. This pure detector decides when that retry is warranted.
  it('flags an English source echoed verbatim when target is Chinese', () => {
    const src = 'Trust is the foundation of every successful software product.'
    expect(isTranslationLikelyUnchanged(src, src, 'zh')).toBe(true)
    expect(isTranslationLikelyUnchanged(src, '  ' + src + '  ', 'zh')).toBe(true) // whitespace-tolerant
  })
  it('does NOT flag when the output is genuinely translated', () => {
    const src = 'Trust is the foundation of every successful software product.'
    const out = '信任是每个成功软件产品的基石。'
    expect(isTranslationLikelyUnchanged(src, out, 'zh')).toBe(false)
  })
  it('does NOT flag a partial translation that differs substantially', () => {
    const src = 'The quick brown fox jumps over the lazy dog near the riverbank.'
    // A real translation would share almost no words; even a half-translation
    // that changed >30% of the text is not "unchanged".
    const out = 'The quick brown 狐狸 jumps over the 懒狗 by the riverbank.'
    expect(isTranslationLikelyUnchanged(src, out, 'zh')).toBe(false)
  })
  it('flags case-only / punctuation-only differences as unchanged', () => {
    const src = 'Configuration Options Reference'
    expect(isTranslationLikelyUnchanged(src, 'configuration options reference.', 'zh')).toBe(true)
  })
  it('does NOT flag when source and target share a script (e.g. en→en is allowed)', () => {
    // If the user explicitly asked to translate English to English (or the
    // direction couldn't be inferred), echoing is not a failure — don't retry
    // forever. We only flag when the target is a DIFFERENT script from the
    // source, i.e. a real translation was expected.
    const src = 'Hello world'
    expect(isTranslationLikelyUnchanged(src, src, 'en')).toBe(false)
  })
  it('does NOT flag very short sources (too noisy to judge)', () => {
    // A 3-char source like "API" legitimately has no translation; retrying
    // would loop. Only judge sources long enough to be meaningful.
    expect(isTranslationLikelyUnchanged('API', 'API', 'zh')).toBe(false)
  })
  it('flags CJK source echoed verbatim when target is English', () => {
    const src = '信任是每个成功软件产品的基石。'
    expect(isTranslationLikelyUnchanged(src, src, 'en')).toBe(true)
  })
})

describe('maxTokensForChunk', () => {
  // The "翻译不全" (incomplete translation) regression: the per-chunk
  // maxTokens was capped at 1000, but page blocks are split up to
  // MAX_BLOCK_LEN (2000) chars. A 2000-char English block can translate to
  // ~1500-2500 Chinese characters (~1200-1800 tokens), so the old 1000 cap
  // truncated mid-sentence and the user saw partial translations. The budget
  // must scale with the source length and be large enough to fit a full
  // translation of the largest possible chunk.
  it('scales with source length (longer source → more output tokens)', () => {
    const small = maxTokensForChunk(50)
    const large = maxTokensForChunk(MAX_BLOCK_LEN)
    expect(large).toBeGreaterThan(small)
  })
  it('a MAX_BLOCK_LEN chunk gets enough tokens to translate fully', () => {
    // Need at least ~1.2x the source char count in tokens to safely cover a
    // Chinese translation of a 2000-char English block without truncation.
    const budget = maxTokensForChunk(MAX_BLOCK_LEN)
    expect(budget).toBeGreaterThanOrEqual(2000)
  })
  it('a very short chunk still gets a sensible minimum (≥300)', () => {
    // Headings / short labels need headroom for the model's framing; a 200
    // floor was too tight and produced empty-looking responses on tiny blocks.
    expect(maxTokensForChunk(10)).toBeGreaterThanOrEqual(300)
  })
  it('never returns a budget below the minimum even for empty input', () => {
    expect(maxTokensForChunk(0)).toBeGreaterThanOrEqual(300)
  })
  it('is bounded above so a runaway estimate does not request absurd budgets', () => {
    expect(maxTokensForChunk(MAX_BLOCK_LEN * 4)).toBeLessThanOrEqual(4000)
  })
})

describe('filterGlossaryForDirection', () => {
  it('keeps cjk-source entries when translating to en', () => {
    const entries = [
      ge('1', '大语言模型', 'LLM'),
      ge('2', 'RAG', '检索增强生成'),
    ]
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
  it('returns all enabled when target is neither zh nor en', () => {
    const entries = [ge('1', 'A', 'B'), ge('2', 'C', 'D')]
    const out = filterGlossaryForDirection(entries, 'ja')
    expect(out).toHaveLength(2)
  })
  it('drops disabled entries', () => {
    const entries = [ge('1', 'RAG', '检索增强生成', false)]
    expect(filterGlossaryForDirection(entries, 'zh')).toHaveLength(0)
  })
})

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
    expect((results[0] as { value: number }).value).toBe(2)
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
    expect(started.length).toBeLessThan(items.length)
    const aborted = results.filter((r) => !r.ok)
    expect(aborted.length).toBeGreaterThan(0)
  })
})

describe('shouldTranslateBlock', () => {
  const cand = (over: Partial<BlockCandidate>): BlockCandidate => ({
    text: 'Hello world this is a normal paragraph with enough text',
    tag: 'P',
    isInsideExcluded: false,
    isAlreadyTranslated: false,
    textRatio: 0.9,
    ...over,
  })
  it('accepts a normal paragraph', () => {
    expect(shouldTranslateBlock(cand({}))).toBe(true)
  })
  it('rejects too-short text', () => {
    expect(shouldTranslateBlock(cand({ text: 'hi' }))).toBe(false)
  })
  it('accepts long text (splitting is the caller\'s job, not the filter\'s)', () => {
    // Long blocks used to be rejected outright; they are now accepted and the
    // caller (runBilingualTranslation) splits them into chunks before sending.
    expect(shouldTranslateBlock(cand({ text: 'x'.repeat(2001) }))).toBe(true)
    expect(shouldTranslateBlock(cand({ text: 'x'.repeat(8000) }))).toBe(true)
  })
  it('rejects excluded ancestor', () => {
    expect(shouldTranslateBlock(cand({ isInsideExcluded: true }))).toBe(false)
  })
  it('rejects already-translated', () => {
    expect(shouldTranslateBlock(cand({ isAlreadyTranslated: true }))).toBe(false)
  })
  it('rejects low text ratio (below 0.4)', () => {
    expect(shouldTranslateBlock(cand({ textRatio: 0.35 }))).toBe(false)
  })
  it('accepts text ratio of 0.4 (relaxed for markup-heavy tech docs)', () => {
    // Technical docs have inline <code>/<a> that bloat outerHTML; the previous
    // 0.6 threshold dropped ~half the blocks on a code site.
    expect(shouldTranslateBlock(cand({ textRatio: 0.4 }))).toBe(true)
    expect(shouldTranslateBlock(cand({ textRatio: 0.5 }))).toBe(true)
  })
  it('rejects non-translatable tag', () => {
    expect(shouldTranslateBlock(cand({ tag: 'DIV' }))).toBe(false)
  })
  it('accepts a heading', () => {
    expect(shouldTranslateBlock(cand({ tag: 'H2', text: 'A meaningful heading here' }))).toBe(true)
  })
})

describe('splitBlockForTranslation', () => {
  it('returns [] for empty / whitespace-only text', () => {
    expect(splitBlockForTranslation('')).toEqual([])
    expect(splitBlockForTranslation('   \n\n  ')).toEqual([])
  })
  it('returns a single chunk when text fits under the limit', () => {
    const text = 'Hello world this is a short paragraph.'
    expect(splitBlockForTranslation(text)).toEqual([text])
  })
  it('returns exactly one chunk when text length equals the limit', () => {
    const text = 'x'.repeat(MAX_BLOCK_LEN)
    expect(splitBlockForTranslation(text)).toEqual([text])
  })
  it('splits a long paragraph at sentence boundaries', () => {
    // Build a paragraph whose sentences are small but total exceeds the limit.
    const sentence = 'This is one sentence that is reasonably short. '
    const text = sentence.repeat(80) // ~4000 chars, many sentence boundaries
    const chunks = splitBlockForTranslation(text)
    expect(chunks.length).toBeGreaterThan(1)
    // Every chunk must respect the limit.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_BLOCK_LEN)
    // Chunks concatenate back to the trimmed original (leading/trailing
    // whitespace is intentionally dropped — nothing else is lost).
    expect(chunks.join('')).toBe(text.trim())
    // Each chunk (except possibly the last) ends at a sentence boundary.
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]).toMatch(/[.!?。！？]\s*$/)
    }
  })
  it('hard-splits when there is no sentence boundary', () => {
    const text = 'x'.repeat(MAX_BLOCK_LEN * 2 + 17)
    const chunks = splitBlockForTranslation(text)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_BLOCK_LEN)
    expect(chunks.join('')).toBe(text)
  })
  it('respects an explicit maxLen override', () => {
    const text = 'a. b. c. d. e. f. g. h.'
    const chunks = splitBlockForTranslation(text, 8)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8)
    expect(chunks.join('')).toBe(text)
  })
})

describe('tag lists', () => {
  it('TRANSLATABLE_TAGS includes core block tags', () => {
    expect(TRANSLATABLE_TAGS.has('P')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('H1')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('LI')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('BLOCKQUOTE')).toBe(true)
  })
  it('EXCLUDED_ANCESTOR_TAGS includes code/pre/script', () => {
    expect(EXCLUDED_ANCESTOR_TAGS.has('CODE')).toBe(true)
    expect(EXCLUDED_ANCESTOR_TAGS.has('PRE')).toBe(true)
    expect(EXCLUDED_ANCESTOR_TAGS.has('SCRIPT')).toBe(true)
  })
})

describe('appendHistory', () => {
  const he = (id: string, source: string, target: string, targetLang: TargetLangCode, createdAt = 1000): TranslationHistoryEntry => ({
    id, source, target, sourceLang: 'auto', targetLang, kind: 'selection', url: 'https://x', createdAt,
  })
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
    expect(isValidDisplayMode('xxx')).toBe(false)
  })
})
