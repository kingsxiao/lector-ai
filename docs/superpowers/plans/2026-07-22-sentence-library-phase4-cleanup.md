# Phase 4: 打磨清理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 清掉 Phase 1/2/3 review 记录的 4 个收尾缺口,提升完成度。零功能新增,全部是质量改进。

**Architecture:** per-card Anki 按钮(一行)、Anki 结果文案 i18n、generateSentenceCard/handleGenerate DRY 重构(抽公共 helper)、importSentences 加 SrsState 字段校验。

**Tech Stack:** TypeScript + Vitest。

## Global Constraints

- **NODE_ENV**:命令前置 `NODE_ENV=development`。
- **不破坏现有行为**:所有改动是等价重构或补强,不得改变既有卡片/Anki/导入导出的可观察行为。
- **i18n**:新字符串加进 `src/shared/i18n.ts`(en/zh)。
- **纯模块**:`importSentences` 校验逻辑在 `src/shared/sentences.ts`,配单测。

---

### Task P4-1: per-card Anki 导出 + Anki 结果文案 i18n

**Files:**
- Modify: `src/shared/i18n.ts`(加结果文案键)
- Modify: `src/sidepanel/App.tsx`(每卡 Anki 按钮 + 替换硬编码 alert)

**背景**:现在句库只有「批量发送到 Anki」按钮(`props.onAnkiExport(filtered)`,App.tsx:2166)。每张卡片没有单独导出入口。另外 onAnkiExport 的结果 alert 硬编码英文(`Added N, duplicated N, failed N`,App.tsx:959)。

- [ ] **Step 1: 加 i18n 键**

在 `src/shared/i18n.ts` 的 `side.sentences.*` 区块(或 `stats.*` 之后)加:
```ts
  'side.sentences.toAnkiOne': { en: 'Send this card to Anki', zh: '这张卡片发送到 Anki' },
  'anki.result': { en: 'Added {added}, duplicated {dup}, failed {fail}', zh: '新增 {added}，重复 {dup}，失败 {fail}' },
```

- [ ] **Step 2: 替换硬编码 alert**

在 `src/sidepanel/App.tsx` 的 onAnkiExport handler(约 line 953-960),把:
```tsx
              alert(`Added ${r.added}, duplicated ${r.duplicated}, failed ${r.failed}`)
```
改为:
```tsx
              alert(tr('anki.result').replace('{added}', String(r.added)).replace('{dup}', String(r.duplicated)).replace('{fail}', String(r.failed)))
```

- [ ] **Step 3: 每张卡片加 Anki 按钮**

在 `SentencesDrawer` 的卡片项渲染区(约 line 2180-2230,卡片操作按钮组:查看原文/加入复习/删除),在「加入复习」按钮旁边加一个单卡 Anki 按钮。找到卡片项的操作 div(`ml-auto flex items-center gap-1`),在其中加:
```tsx
                            <button
                              onClick={() => props.onAnkiExport([c])}
                              title={tr('side.sentences.toAnkiOne')}
                              className="text-ink-faint hover:text-accent"
                            >
                              <DownloadIcon size={13} />
                            </button>
```
(DownloadIcon 应已导入——句库导入导出按钮用了它。若未导入则加 import。)

- [ ] **Step 4: typecheck + build + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无错,209 测试全绿。

- [ ] **Step 5: commit**

```bash
git add src/shared/i18n.ts src/sidepanel/App.tsx
git commit -m "feat(sentences): per-card Anki export + i18n result message (Phase 4)"
```

---

### Task P4-2: generateSentenceCard / handleGenerate DRY 重构

**Files:**
- Modify: `src/sidepanel/App.tsx`

**背景**:`generateSentenceCard`(App.tsx:255-280,App 作用域,用 alert 报错)和 `SentencesDrawer.handleGenerate`(App.tsx:2053-2088,用 importMsg 报错)共享 ~10 行核心逻辑(completeOnce → extractTranslation/extractKeywords → addSentence)。重构:抽一个纯核心 helper,两者各自包自己的报错 UX。

- [ ] **Step 1: 抽公共核心 helper**

在 `src/sidepanel/App.tsx`,把 `generateSentenceCard` 改造为调用一个内部 helper。在 `generateSentenceCard` 之前(或之后)加:
```tsx
  // Shared core: call AI + build + save a sentence card. Returns success boolean.
  // Callers wrap their own error UX (alert vs inline ImportMsg).
  const runSentenceAnalysis = async (sentence: string, url: string, title: string): Promise<boolean> => {
    const settings = useStore.getState().byok
    if (!settings.apiKey) return false
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
    return true
  }
```

然后 `generateSentenceCard` 改为:
```tsx
  const generateSentenceCard = async (sentence: string, url: string, title: string) => {
    const settings = useStore.getState().byok
    if (!settings.apiKey) {
      alert(tr('err.addKey'))
      return
    }
    try {
      await runSentenceAnalysis(sentence, url, title)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }
```

- [ ] **Step 2: handleGenerate 复用 helper**

把 `SentencesDrawer.handleGenerate`(App.tsx:2053-2088)改造为复用 `runSentenceAnalysis`。但注意:`handleGenerate` 在 SentencesDrawer 组件内,而 `runSentenceAnalysis` 在 App 作用域——需要通过 prop 传入,或把 helper 提到模块顶层(纯函数无 hook 依赖,只依赖 useStore.getState())。

最简方案:把 `runSentenceAnalysis` 改成不依赖闭包的模块级函数(它只用 `useStore.getState()` 和导入的函数,无 React state)。移到 App 组件外:
```tsx
// Module-level helper (no closure deps — uses useStore.getState()).
async function runSentenceAnalysis(sentence: string, url: string, title: string): Promise<boolean> {
  const settings = useStore.getState().byok
  if (!settings.apiKey) return false
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
  return true
}
```
然后 `generateSentenceCard`(App 内)和 `handleGenerate`(SentencesDrawer 内)都调它。App 内的 `generateSentenceCard` 删掉 `runSentenceAnalysis` 内联定义,直接调模块级的。handleGenerate 改为:
```tsx
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
      await runSentenceAnalysis(text, '', tr('side.sentences.pasteTitle'))
      setPasteText('')
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setGenerating(false)
    }
  }
```

- [ ] **Step 3: typecheck + build + test + 行为等价验证**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无错,209 测试全绿。重构是行为等价的(同样的 completeOnce 参数、同样的 addSentence 字段)。

- [ ] **Step 4: commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "refactor(sentences): extract runSentenceAnalysis to dedup card generation (Phase 4)"
```

---

### Task P4-3: importSentences 加 SrsState 字段校验

**Files:**
- Modify: `src/shared/sentences.ts`(`importSentences` 函数,约 line 232)
- Test: `tests/sentences.test.ts`(append)

**背景**:现在 `importSentences` 只检查 `r.srs` 是 object 就 `as SrsState`,不校验 `due/interval/ease/reps/lapses` 是数字。损坏的 `{srs: {due:'abc'}}` 会通过,后续 scheduleSrs/isDue 可能产生 NaN。

- [ ] **Step 1: 写失败测试**

Append to `tests/sentences.test.ts`:
```ts
describe('importSentences — SrsState validation', () => {
  it('rejects srs with non-numeric fields (falls back to null)', () => {
    const dirty = [
      {
        id: 's1', sentence: 'A valid sentence.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 'not-a-number', interval: 1, ease: 2.5, reps: 0, lapses: 0 },
      },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toBeNull()
  })

  it('keeps valid srs intact', () => {
    const valid = [
      {
        id: 's1', sentence: 'A valid sentence.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 123456, interval: 5, ease: 2.5, reps: 3, lapses: 1 },
      },
    ]
    const r = importSentences(JSON.stringify(valid))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toEqual({ due: 123456, interval: 5, ease: 2.5, reps: 3, lapses: 1 })
  })

  it('rejects srs missing required numeric fields', () => {
    const dirty = [
      {
        id: 's1', sentence: 'A valid sentence.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 123, interval: 1 }, // 缺 ease/reps/lapses
      },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.cards?.[0].srs).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- sentences`
Expected: 第一个测试 FAIL(`srs` 当前被接受而非降级为 null)。

- [ ] **Step 3: 实现校验**

在 `src/shared/sentences.ts` 的 `importSentences` 函数,把:
```ts
    const srs = r.srs && typeof r.srs === 'object' ? (r.srs as SrsState) : null
```
改为:
```ts
    const srs = isValidSrsState(r.srs) ? (r.srs as SrsState) : null
```
并在 `importSentences` 之前(或文件靠近 SrsState import 处)加一个校验 helper:
```ts
/** 校验导入的 srs 对象是否所有数值字段都是数字。损坏的降级为 null。*/
function isValidSrsState(v: unknown): v is SrsState {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    typeof s.due === 'number' &&
    typeof s.interval === 'number' &&
    typeof s.ease === 'number' &&
    typeof s.reps === 'number' &&
    typeof s.lapses === 'number'
  )
}
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `NODE_ENV=development npm test && NODE_ENV=development npm run typecheck`
Expected: 全绿(sentences 新增 3 个),typecheck 无错。

- [ ] **Step 5: commit**

```bash
git add src/shared/sentences.ts tests/sentences.test.ts
git commit -m "fix(sentences): validate SrsState fields on import (reject non-numeric) (Phase 4)"
```

---

## 完成判据

- [x] P4-1: per-card Anki 按钮 + Anki 结果 i18n
- [x] P4-2: runSentenceAnalysis DRY 重构(行为等价)
- [x] P4-3: importSentences SrsState 校验 + 3 测试

## 风险

- **P4-2 重构风险**:抽出 helper 后行为必须等价(同样的 completeOnce 参数、addSentence 字段)。关键验证点:handleGenerate 的 url/title 与原逻辑一致('' 和 pasteTitle)。typecheck + 既有测试是回归网。
- **P4-3 校验副作用**:旧的 `r.srs as SrsState` 对合法导入数据无影响(合法 srs 字段都是数字)。只拦截损坏数据,不影响正常导入。
