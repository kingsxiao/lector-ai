# Phase 5: CEFR 难度分级 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 句库卡片带 CEFR 难度标签(A1-C2),句库抽屉可按难度过滤,帮助学习者选适合自己水平的句子。

**Architecture:** prompt 新增「## 难度」节让 AI 输出 CEFR 等级 → `extractCefr` 正则提取 → `SentenceCard.cefr` 字段存储 → 卡片显示彩色 badge + 抽屉加难度过滤下拉。

**Tech Stack:** TypeScript + Vitest。

## Global Constraints

- **NODE_ENV**:命令前置 `NODE_ENV=development`。
- **CEFR 等级固定 6 档**:`A1`/`A2`/`B1`/`B2`/`C1`/`C2`。未知/提取失败为 `null`(向后兼容旧卡)。
- **提取稳健**:`extractCefr` 用正则锚定 `## 难度` 节,容忍节内多余文字,失败返回 `null`。
- **向后兼容**:旧卡片(无 cefr 字段)的 `cefr` 为 `undefined`/`null`,正常显示,过滤时归入「全部」。
- **i18n**:难度过滤标签 + badge 用现有等级名(CEFR 是国际通用,A1-C2 不翻译)。

---

### Task P5-1: cefr 数据模型 + 提取 + prompt 改造 + 测试(TDD)

**Files:**
- Modify: `src/shared/sentences.ts`(SentenceCard 加 cefr 字段、extractCefr、importSentences 校验、prompt 加难度节)
- Test: `tests/sentences.test.ts`(append)

**Interfaces:**
- Produces:`SentenceCard.cefr: CefrLevel | null`,`CefrLevel` 类型,`extractCefr` 函数,prompt 多一节。后续 P5-3 UI 消费。

- [ ] **Step 1: 写失败测试**

Append to `tests/sentences.test.ts`:
```ts
describe('CEFR level (Phase 5)', () => {
  const ANALYSIS_WITH_CEFR = `## 译文
测试句子。

## 难度
B2

## 句法结构
[n]test[/n]`

  it('extractCefr extracts the level from 难度 section', () => {
    expect(extractCefr(ANALYSIS_WITH_CEFR)).toBe('B2')
  })

  it('extractCefr returns null when section missing', () => {
    expect(extractCefr('## 译文\n\nx')).toBeNull()
  })

  it('extractCefr tolerates extra text around the level', () => {
    const a = `## 难度\n\nThis sentence is B1 level.`
    expect(extractCefr(a)).toBe('B1')
  })

  it('extractCefr returns null for invalid level', () => {
    const a = `## 难度\n\nXYZ`
    expect(extractCefr(a)).toBeNull()
  })

  it('extractCefr handles all 6 valid levels', () => {
    for (const lvl of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) {
      expect(extractCefr(`## 难度\n\n${lvl}`)).toBe(lvl)
    }
  })

  it('SENTENCE_CARD_SYSTEM_PROMPT includes a 难度 section instructing CEFR output', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 难度')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('A1')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('C2')
  })
})
```
Also add `extractCefr` to the import line at the top of the test file.

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- sentences`
Expected: FAIL — `extractCefr` 未导出。

- [ ] **Step 3: 实现**

在 `src/shared/sentences.ts`:

(a) 加类型(在 `SentenceCard` 接口之前):
```ts
/** CEFR 难度等级(欧洲语言共同参考框架)。*/
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
```

(b) `SentenceCard` 接口加字段(在 `lang` 之后):
```ts
  /** CEFR 难度等级,从「## 难度」节提取。未知/旧卡为 null。*/
  cefr: CefrLevel | null
```

(c) 加提取函数(在 `extractKeywords` 之后):
```ts
const VALID_CEFR = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

/**
 * 从「## 难度」节提取 CEFR 等级。容忍节内多余文字(取首个匹配的有效等级)。
 * 缺节或无有效等级返回 null。
 */
export function extractCefr(analysis: string): CefrLevel | null {
  const section = analysis.match(/##\s*难度\s*\n([\s\S]*?)(?=\n##\s|$)/)?.[1] ?? ''
  const m = section.match(/\b(A1|A2|B1|B2|C1|C2)\b/)
  return m ? (m[1] as CefrLevel) : null
}
```

(d) `makeSentenceCard` 工厂——它当前用 `...partial` 展开,若 partial 含 cefr 则自动带入;但为防漏,在工厂里补默认值。实际上 `makeSentenceCard` 用 `Omit<SentenceCard, 'srs' | 'createdAt'>`,partial 已要求 cefr 字段。无需改工厂(partial 必须提供 cefr)。

(e) `importSentences`——在解析循环里加:
```ts
    const cefrRaw = typeof r.cefr === 'string' ? r.cefr : null
    const cefr = cefrRaw && VALID_CEFR.has(cefrRaw) ? (cefrRaw as CefrLevel) : null
```
并在 push 的对象里加 `cefr`。

(f) prompt 加节——在 `## 译文` 之后、`## 难度` 是新节。在 `## 译文\n<...>` 之后插入:
```

## 难度
<output ONE word: the CEFR level of this sentence — one of A1, A2, B1, B2, C1, C2>
```
(放在译文之后、句法结构之前。这样难度成为第 2 节,句法第 3 节,以此类推。)

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `NODE_ENV=development npm test -- sentences && NODE_ENV=development npm run typecheck`
Expected: 全绿。但注意:`makeSentenceCard` 的所有调用点(background.ts、App.tsx runSentenceAnalysis)现在必须提供 cefr 字段——typecheck 会报错。下一步 P5-2 修这些调用点。**本 task 先只改 sentences.ts + 测试,接受 typecheck 暂时报调用点错误**(或在本 task 里同时修调用点——见下)。

实际上为避免 typecheck 断裂,本 task 同时更新调用点:`src/background.ts` 的 card 对象和 `src/sidepanel/App.tsx` 的 `runSentenceAnalysis` 都加 `cefr: extractCefr(analysis)`。

- background.ts `handleExplainSentenceRelay`:card 对象加 `cefr: extractCefr(analysis)`(需 import extractCefr)。
- App.tsx `runSentenceAnalysis`:addSentence 调用加 `cefr: extractCefr(analysis)`(需 import extractCefr)。

- [ ] **Step 5: commit**

```bash
git add src/shared/sentences.ts src/background.ts src/sidepanel/App.tsx tests/sentences.test.ts
git commit -m "feat(sentences): CEFR level field + extraction + prompt section (Phase 5)"
```

---

### Task P5-2: i18n + 卡片 CEFR badge + 抽屉难度过滤

**Files:**
- Modify: `src/shared/i18n.ts`
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: 加 i18n 键**

在 `src/shared/i18n.ts` 的 `side.sentences.*` 区块加:
```ts
  'side.sentences.filterAll': { en: 'All levels', zh: '全部难度' },
```

- [ ] **Step 2: 卡片显示 CEFR badge**

在 `src/sidepanel/App.tsx` 的 SentencesDrawer 卡片项(句子文字旁边,due badge 附近),加 CEFR badge:
```tsx
                          {c.cefr && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-ink/10 text-ink-soft font-medium">
                              {c.cefr}
                            </span>
                          )}
```

- [ ] **Step 3: 抽屉加难度过滤下拉**

在 SentencesDrawer 顶部搜索框旁,加一个难度过滤 select。需要:
- 加 state:`const [cefrFilter, setCefrFilter] = useState<string>('')`(空=全部)
- 过滤逻辑:在 `searchSentences` 结果之后再按 cefr 过滤:
```tsx
  const cefrFiltered = cefrFilter ? filtered.filter((c) => c.cefr === cefrFilter) : filtered
  const groups = groupSentences(cefrFiltered)
```
- UI(搜索框下方):
```tsx
            <select
              value={cefrFilter}
              onChange={(e) => setCefrFilter(e.target.value)}
              className="lector-input w-full text-[12px]"
              aria-label={tr('side.sentences.filterAll')}
            >
              <option value="">{tr('side.sentences.filterAll')}</option>
              {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
```
(用 `lector-input` 同款 inline 样式——若该 class 不存在,用 SentencesDrawer 其它 input 用的同款 inline Tailwind。)

- [ ] **Step 4: typecheck + build + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无错,全绿。

- [ ] **Step 5: commit**

```bash
git add src/shared/i18n.ts src/sidepanel/App.tsx
git commit -m "feat(sentences): CEFR badge on cards + difficulty filter in drawer (Phase 5)"
```

---

### Task P5-3: 验证清单 + 全量回归

**Files:**
- Modify: `docs/manual-verification-checklist.md`

- [ ] **Step 1: 追加 §16 验证项**

```markdown
## §16 CEFR 难度分级（Feature ④ Phase 5）

21. **难度 badge**：生成新卡片 → 卡片显示 CEFR badge（A1-C2 之一）→
    难度合理（简单句 A1-A2，复杂长句 B2-C1）
22. **难度过滤**：句库抽屉选某难度（如 B2）→ 只显示该难度卡片 →
    选「全部难度」恢复全部
23. **向后兼容**：旧卡片（无难度）→ 无 badge 显示，过滤归入「全部」
```
也在回报模板加 `§16 难度（Phase 5）：16.1 ☐  16.2 ☐  16.3 ☐`。

- [ ] **Step 2: 全量回归**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test && NODE_ENV=development npm run build`
Expected: 全绿。

- [ ] **Step 3: commit**

```bash
git add docs/manual-verification-checklist.md
git commit -m "docs(sentences): add §16 CEFR verification checklist (Phase 5)"
```

---

## 完成判据

- [x] P5-1: cefr 字段 + extractCefr + prompt 难度节 + 调用点更新 + 6 测试
- [x] P5-2: 卡片 badge + 抽屉难度过滤下拉
- [x] P5-3: 验证清单 §16 + 全量回归

## 风险

- **AI 判错难度**:CEFR 判定有主观性,AI 可能不准。缓解——这只是辅助标签,用户可忽略;不影响卡片可用性。
- **typecheck 断裂**:加 cefr 必填字段会让所有 `makeSentenceCard`/addSentence 调用点报错。P5-1 必须同时修 background.ts + App.tsx 调用点。
- **过滤 state**:`cefrFilter` 是组件内 state,切抽屉会重置——可接受(与搜索框 query 同生命周期)。
