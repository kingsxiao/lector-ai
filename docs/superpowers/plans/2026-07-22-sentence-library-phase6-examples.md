# Phase 6: 例句一键生成卡片 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 句库卡片的「举一反三」例句旁加「生成讲解」按钮,一键把例句转成一张新的句子讲解卡片,复用现有 `runSentenceAnalysis` 流程。

**设计决策**:例句是完整英文句子(通常 >60 字符),不适合塞入 vocab 的 word 字段(vocab 设计假设 word 是短词,validateWord 拒绝 >60 字符)。最优雅的方案是**把例句转成新的 sentence card**(复用 runSentenceAnalysis),而不是 vocab entry。这样:
- 不破坏 vocab 数据模型
- 例句新卡片和原卡片并列在句库,可独立复习/标注 CEFR
- 完全复用现有生成+存储+渲染流程

**Architecture:** `extractExamples(analysis)` 从「## 举一反三」节提取例句数组(纯函数+测试);卡片分析展开时,每个例句旁显示「生成讲解」按钮,点击调 `runSentenceAnalysis(example, '', title)`。

**Tech Stack:** TypeScript + Vitest。

## Global Constraints

- **NODE_ENV**:命令前置 `NODE_ENV=development`。
- **提取稳健**:`extractExamples` 用正则锚定「## 举一反三」节的有序列表项(`1. ` `2. ` `3. `),失败返回空数组。向后兼容(无例句节→空数组)。
- **不破坏 vocab 模型**:例句走 sentence card 流程,不碰 vocab。
- **i18n**:新按钮文案加 en/zh。

---

### Task P6-1: extractExamples 纯函数 + 测试(TDD)

**Files:**
- Modify: `src/shared/sentences.ts`(加 extractExamples)
- Test: `tests/sentences.test.ts`(append)

- [ ] **Step 1: 写失败测试**

Append to `tests/sentences.test.ts`(加 `extractExamples` 到 import):
```ts
describe('extractExamples (Phase 6)', () => {
  const ANALYSIS = `## 译文
测试。

## 举一反三
1. This is the first example sentence.
2. Here is another fresh example to reuse.
3. A third example rounds it out.

## 记忆点
记住。`

  it('extracts the 3 numbered examples from 举一反三', () => {
    const out = extractExamples(ANALYSIS)
    expect(out).toEqual([
      'This is the first example sentence.',
      'Here is another fresh example to reuse.',
      'A third example rounds it out.',
    ])
  })

  it('returns empty array when section missing', () => {
    expect(extractExamples('## 译文\n\nx')).toEqual([])
  })

  it('returns empty array when no numbered items', () => {
    expect(extractExamples('## 举一反三\n\nNo items here.')).toEqual([])
  })

  it('trims whitespace from each example', () => {
    const a = `## 举一反三\n\n1.   spaced example  `
    expect(extractExamples(a)).toEqual(['spaced example'])
  })

  it('stops at the next H2 section', () => {
    const a = `## 举一反三\n\n1. First example.\n\n## 记忆点\n\n1. not an example`
    expect(extractExamples(a)).toEqual(['First example.'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- sentences`
Expected: FAIL — `extractExamples` 未导出。

- [ ] **Step 3: 实现**

在 `src/shared/sentences.ts`,在 `extractCefr` 之后加:
```ts
/**
 * 从「## 举一反三」节提取有序列表例句。返回去空白后的例句数组。
 * 缺节或无有序项返回空数组。节边界是下一个 `## ` 或文末。
 */
export function extractExamples(analysis: string): string[] {
  const section = analysis.match(/##\s*举一反三\s*\n([\s\S]*?)(?=\n##\s|$)/)?.[1] ?? ''
  const out: string[] = []
  for (const line of section.split('\n')) {
    const m = line.match(/^\s*\d+\.\s+(.*)$/)
    if (m && m[1].trim()) out.push(m[1].trim())
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `NODE_ENV=development npm test -- sentences && NODE_ENV=development npm run typecheck`
Expected: 全绿(5 个新测试),typecheck 无错。

- [ ] **Step 5: commit**

```bash
git add src/shared/sentences.ts tests/sentences.test.ts
git commit -m "feat(sentences): extractExamples to pull example sentences from 举一反三 (Phase 6)"
```

---

### Task P6-2: 例句「生成讲解」按钮 + i18n

**Files:**
- Modify: `src/shared/i18n.ts`
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: 加 i18n 键**

在 `src/shared/i18n.ts` 的 `side.sentences.*` 区块加:
```ts
  'side.sentences.makeCard': { en: 'Make card', zh: '生成卡片' },
  'side.sentences.examples': { en: 'Examples', zh: '举一反三' },
```

- [ ] **Step 2: 卡片分析展开区显示例句 + 按钮**

在 `src/sidepanel/App.tsx` 的 SentencesDrawer,当卡片分析展开时(`isRevealed && renderMarkdown(...)`)。当前是整段 renderMarkdown 渲染 analysis。改为:在 renderMarkdown 下方,加一个例句区——用 `extractExamples(c.analysis)` 提取例句,每个例句显示为一行 + 「生成讲解」按钮。

找到卡片展开渲染处(约 `{isRevealed && (c.translation || c.analysis) && (...)}`),在那个 renderMarkdown div 之后加:
```tsx
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px]">
                                <span className="text-ink-soft flex-1">{ex}</span>
                                <button
                                  onClick={() => onMakeCard(ex, c.title)}
                                  title={tr('side.sentences.makeCard')}
                                  className="text-accent hover:underline text-[10px] flex-shrink-0"
                                >
                                  {tr('side.sentences.makeCard')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
```

需要:
- import `extractExamples` from `../shared/sentences`(加到现有 import)。
- `onMakeCard` 作为 SentencesDrawer 的新 prop,签名 `(sentence: string, title: string) => void`。在 SentencesDrawerProps 接口加这个 prop。
- App 挂载处传入:`onMakeCard={(sentence, title) => generateSentenceCard(sentence, '', title)}`(复用 App 作用域的 generateSentenceCard,url 传空,title 用原卡片标题)。

- [ ] **Step 3: typecheck + build + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无错,全绿。

- [ ] **Step 4: commit**

```bash
git add src/shared/i18n.ts src/sidepanel/App.tsx
git commit -m "feat(sentences): make-card button on each example sentence (Phase 6)"
```

---

### Task P6-3: 验证清单 + 全量回归

**Files:**
- Modify: `docs/manual-verification-checklist.md`

- [ ] **Step 1: 追加 §17**

```markdown
## §17 例句生成卡片（Feature ④ Phase 6）

24. **例句生成**：展开一张卡片 → 举一反三例句旁有「生成卡片」按钮 →
    点击 → 句库出现新卡片（基于该例句）→ 新卡片 6 节齐全
25. **多例句**：每条例句都有独立按钮 → 各自生成独立卡片
26. **无例句降级**：卡片无举一反三节 → 不显示例句区（不报错）
```
也在回报模板加 `§17 例句（Phase 6）：17.1 ☐  17.2 ☐  17.3 ☐`。

- [ ] **Step 2: 全量回归**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test && NODE_ENV=development npm run build`
Expected: 全绿。

- [ ] **Step 3: commit**

```bash
git add docs/manual-verification-checklist.md
git commit -m "docs(sentences): add §17 example-to-card verification checklist (Phase 6)"
```

---

## 完成判据

- [x] P6-1: extractExamples + 5 测试
- [x] P6-2: 例句「生成讲解」按钮(复用 generateSentenceCard)
- [x] P6-3: 验证清单 §17 + 全量回归

## 风险

- **例句提取误匹配**:若模型在「举一反三」节用了非 `1. 2. 3.` 格式(如 `- `),提取会漏。缓解——prompt 明确要求有序列表;漏了则不显示按钮(降级,不报错)。
- **重复生成**:同一例句点两次会生成两张同句卡片——但 `addSentence` 内部按归一化句子去重 merge,所以第二次会刷新而非重复。安全。
- **App.tsx 体积**:再加例句区渲染,但它是卡片展开区内的条件块,~10 行,可控。
