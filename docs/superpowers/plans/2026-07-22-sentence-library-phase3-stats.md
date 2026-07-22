# Phase 3: 复习统计仪表盘 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在句库抽屉和生词本抽屉顶部各加一个复习统计条,显示 4 个指标(待复习/已掌握/总复习次数/平均掌握度),给学习者正反馈。

**Architecture:** 新增纯模块 `src/shared/stats.ts`(从 SRS 状态数组计算指标,零依赖)+ i18n 键 + 两个抽屉顶部各渲染一个 `StatsBar` 内联组件。指标全从现有 `SrsState` 字段计算,**不动存储**,零风险。

**Tech Stack:** TypeScript + React + Vitest。

## Global Constraints

- **纯模块约定**:`src/shared/stats.ts` 不得 import DOM/chrome API,纯函数配单测。
- **不动存储**:所有指标从现有 `SrsState`(`due`/`interval`/`ease`/`reps`/`lapses`)计算,不新增持久化字段。这保证零数据迁移风险。
- **i18n**:新字符串加进 `src/shared/i18n.ts`(en/zh),`StringKey` 编译期检查。
- **NODE_ENV**:命令前置 `NODE_ENV=development`。
- **指标定义(固定)**:
  - **待复习 (due)**:`isDue(srs)` 为真的卡片数。句库只算 `srs !== null` 的卡片(被动参考卡不计)。
  - **已掌握 (mastered)**:`srs.reps >= 3` 的卡片数(复习过 3 次以上视为初步掌握)。句库同样只算 `srs !== null`。
  - **总复习次数 (reviews)**:所有卡片 `srs.reps` 之和。
  - **平均掌握度 (retention)**:所有 `srs !== null` 卡片的 `srs.ease` 平均值,保留 1 位小数(ease 越高越熟练,SM-2 默认 2.5)。
- **显示位置**:句库抽屉顶部 + 生词本抽屉顶部各一个统计条(Drawer title 之后、空状态/列表之前)。空抽屉(无卡片)不显示统计条。

---

### Task P3-1: 纯模块 stats.ts + 单测(TDD)

**Files:**
- Create: `src/shared/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Consumes:`SrsState` from `./srs`,`isDue` from `./srs`。
- Produces:`ReviewStats` 接口 + `computeReviewStats(items)` 函数。Task P3-3 的两个抽屉消费。

- [ ] **Step 1: 写失败测试**

Create `tests/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeReviewStats, type Reviewable } from '../src/shared/stats'

// 一个带 srs 的可复习项。srs=null 表示被动参考(不计入统计)。
const item = (
  id: string,
  srs: { due: number; interval: number; ease: number; reps: number; lapses: number } | null
): Reviewable => ({ id, srs })

const srs = (over: Partial<{ due: number; interval: number; ease: number; reps: number; lapses: number }> = {}) => ({
  due: over.due ?? Date.now() + 86400000, // 未来 = 不 due
  interval: over.interval ?? 1,
  ease: over.ease ?? 2.5,
  reps: over.reps ?? 0,
  lapses: over.lapses ?? 0,
})

describe('computeReviewStats', () => {
  it('returns zeros for an empty list', () => {
    const r = computeReviewStats([])
    expect(r.due).toBe(0)
    expect(r.mastered).toBe(0)
    expect(r.totalReviews).toBe(0)
    expect(r.avgEase).toBe(0)
  })

  it('counts due items (isDue true)', () => {
    const items = [
      item('1', srs({ due: Date.now() - 1000 })), // 过去 = due
      item('2', srs({ due: Date.now() + 1000 })), // 未来 = not due
      item('3', srs({ due: Date.now() - 5000 })), // 过去 = due
    ]
    expect(computeReviewStats(items).due).toBe(2)
  })

  it('counts mastered items (reps >= 3)', () => {
    const items = [
      item('1', srs({ reps: 5 })),
      item('2', srs({ reps: 3 })), // 边界:恰好 3 算掌握
      item('3', srs({ reps: 2 })), // 不算
      item('4', srs({ reps: 0 })),
    ]
    expect(computeReviewStats(items).mastered).toBe(2)
  })

  it('sums total reviews (sum of reps)', () => {
    const items = [
      item('1', srs({ reps: 5 })),
      item('2', srs({ reps: 3 })),
      item('3', srs({ reps: 0 })),
    ]
    expect(computeReviewStats(items).totalReviews).toBe(8)
  })

  it('averages ease across reviewable items, 1 decimal', () => {
    const items = [
      item('1', srs({ ease: 2.5 })),
      item('2', srs({ ease: 2.3 })),
      item('3', srs({ ease: 2.7 })),
    ]
    // (2.5+2.3+2.7)/3 = 2.5
    expect(computeReviewStats(items).avgEase).toBe(2.5)
  })

  it('rounds avgEase to 1 decimal', () => {
    const items = [item('1', srs({ ease: 2.54 })), item('2', srs({ ease: 2.37 }))]
    // (2.54+2.37)/2 = 2.455 → 2.5 (banker's rounding may vary; assert 1 decimal place)
    const r = computeReviewStats(items)
    expect(r.avgEase).toBe(Math.round(2.455 * 10) / 10)
  })

  it('ignores items with srs=null (passive reference)', () => {
    const items = [
      item('1', srs({ reps: 5, ease: 2.5, due: Date.now() - 1000 })),
      item('2', null), // 被动参考,不计
      item('3', srs({ reps: 3, ease: 2.6 })),
    ]
    const r = computeReviewStats(items)
    expect(r.due).toBe(1) // 只有 item 1 due
    expect(r.mastered).toBe(2)
    expect(r.totalReviews).toBe(8) // 5+3
    expect(r.avgEase).toBe(2.6) // (2.5+2.6)/2 = 2.55 → 2.6
  })

  it('returns avgEase 0 when no reviewable items', () => {
    const items = [item('1', null), item('2', null)]
    expect(computeReviewStats(items).avgEase).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- stats`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `src/shared/stats.ts`**

```ts
// 复习统计指标计算(Feature ④ Phase 3).
//
// Pure functions, zero deps. 从一组可复习项的 SrsState 计算聚合指标,
// 用于句库/生词本抽屉顶部的统计条,给学习者正反馈。
//
// 所有指标从现有 SrsState 字段计算,不新增持久化字段,零数据迁移风险。

import { isDue, type SrsState } from './srs'

/** 一个可复习项:只要有 srs 字段(SrsState 或 null)即可参与统计。*/
export interface Reviewable {
  srs: SrsState | null
}

/** 聚合统计结果。*/
export interface ReviewStats {
  /** 待复习数(isDue 为真)。仅算 srs !== null 的项。*/
  due: number
  /** 已掌握数(reps >= 3,视为初步掌握)。*/
  mastered: number
  /** 总复习次数(所有项 reps 之和)。*/
  totalReviews: number
  /** 平均掌握度(所有 srs!==null 项的 ease 均值,1 位小数)。无项时为 0。*/
  avgEase: number
}

/** 掌握阈值:复习过 3 次以上视为初步掌握。*/
const MASTERED_REPS = 3

/**
 * 计算一组可复习项的聚合统计。srs 为 null 的项(被动参考)被跳过。
 * 纯函数,不 mutate 输入。
 */
export function computeReviewStats(items: Reviewable[]): ReviewStats {
  let due = 0
  let mastered = 0
  let totalReviews = 0
  let easeSum = 0
  let reviewableCount = 0

  for (const it of items) {
    if (!it.srs) continue
    reviewableCount += 1
    totalReviews += it.srs.reps
    easeSum += it.srs.ease
    if (isDue(it.srs)) due += 1
    if (it.srs.reps >= MASTERED_REPS) mastered += 1
  }

  const avgEase = reviewableCount > 0 ? Math.round((easeSum / reviewableCount) * 10) / 10 : 0

  return { due, mastered, totalReviews, avgEase }
}
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `NODE_ENV=development npm test -- stats && NODE_ENV=development npm run typecheck`
Expected: 8 个 stats 测试全绿,typecheck 无错。

- [ ] **Step 5: commit**

```bash
git add src/shared/stats.ts tests/stats.test.ts
git commit -m "feat(stats): add pure review-stats computation module + tests (Phase 3)"
```

---

### Task P3-2: i18n 字符串

**Files:**
- Modify: `src/shared/i18n.ts`

- [ ] **Step 1: 添加字符串**

在 `side.sentences.*` 区块(或 `side.vocab.*` 之后)追加统计相关键。找到 `side.vocab.easy` 之后插入:

```ts
  // --- side panel: review stats bar (Feature ④ Phase 3) ---
  'stats.due': { en: 'Due', zh: '待复习' },
  'stats.mastered': { en: 'Mastered', zh: '已掌握' },
  'stats.reviews': { en: 'Reviews', zh: '复习次数' },
  'stats.retention': { en: 'Retention', zh: '掌握度' },
```

- [ ] **Step 2: typecheck**

Run: `NODE_ENV=development npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: commit**

```bash
git add src/shared/i18n.ts
git commit -m "feat(stats): add i18n strings for review stats bar (Phase 3)"
```

---

### Task P3-3: 句库 + 生词本抽屉顶部统计条

**Files:**
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes:`computeReviewStats` + `Reviewable` from Task P3-1;i18n keys from P3-2;现有 `sentences`/`vocab` store selectors。
- Produces:两个抽屉顶部各渲染一个 `StatsBar`(内联组件或直接 JSX)。

- [ ] **Step 1: 加 import**

在 App.tsx 顶部 import 区加:
```ts
import { computeReviewStats } from '../shared/stats'
```

- [ ] **Step 2: 加 StatsBar 内联组件**

在 App.tsx 底部(其它 helper 组件如 PasteBox/ImportMsg 附近)加一个共享的统计条组件:

```tsx
function StatsBar({ stats, tr }: { stats: ReviewStats; tr: (key: StringKey) => string }) {
  const Cell = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col items-center">
      <span className="text-[15px] font-bold text-accent leading-tight">{value}</span>
      <span className="text-[9px] text-ink-faint">{label}</span>
    </div>
  )
  return (
    <div className="flex justify-around px-3 py-2 border-b border-line">
      <Cell label={tr('stats.due')} value={stats.due} />
      <Cell label={tr('stats.mastered')} value={stats.mastered} />
      <Cell label={tr('stats.reviews')} value={stats.totalReviews} />
      <Cell label={tr('stats.retention')} value={stats.avgEase.toFixed(1)} />
    </div>
  )
}
```

需在 import 区加 `ReviewStats` 类型(与 `computeReviewStats` 同一 import):
```ts
import { computeReviewStats, type ReviewStats } from '../shared/stats'
```
`StringKey` 应已在文件内导入(其它组件用)。

- [ ] **Step 3: 句库抽屉插入统计条**

在 `SentencesDrawer` 函数(约 line 2041),`<Drawer title={...} onClose={...}>` 之后、`{sentences.length === 0 && !pasteText ? (` 之前,插入:

```tsx
        {sentences.filter((c) => c.srs).length > 0 && (
          <StatsBar stats={computeReviewStats(sentences)} tr={tr} />
        )}
```

(只在有复习卡片时显示;空抽屉不显示统计条。`computeReviewStats` 内部会跳过 srs=null 的被动参考卡。)

- [ ] **Step 4: 生词本抽屉插入统计条**

在 `VocabDrawer` 函数(约 line 1139),`<Drawer title={tr('side.vocab.title')} onClose={onClose}>` 之后、`{vocab.length === 0 ? (` 之前,插入:

```tsx
        {vocab.length > 0 && <StatsBar stats={computeReviewStats(vocab)} tr={tr} />}
```

(vocab 每项都有 srs,非空即显示。)

注意:VocabDrawer 的 props 里需确认 `tr` 可用(它已接收 `tr` prop)。若 VocabDrawer 未传 `tr`,检查其 props 接口——它应该已有 `tr`(用于 again/hard/good/easy 按钮)。

- [ ] **Step 5: typecheck + build + test**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: 无类型错误,build 成功,全部测试绿。

- [ ] **Step 6: commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(stats): add review stats bar to SentencesDrawer + VocabDrawer (Phase 3)"
```

---

### Task P3-4: 验证清单 + 全量回归

**Files:**
- Modify: `docs/manual-verification-checklist.md`

- [ ] **Step 1: 追加验证项**

在 §14 末尾(或新增 §15)追加:

```markdown
## §15 复习统计仪表盘（Feature ④ Phase 3）

16. **句库统计条**：句库抽屉顶部显示 4 个指标(待复习/已掌握/复习次数/掌握度)→
    数值与实际卡片状态一致(手动核对几张卡片)
17. **生词本统计条**：生词本抽屉顶部同样显示统计条 → 数值正确
18. **空抽屉不显示**：清空句库后 → 统计条不显示(无卡片时)
19. **被动参考不计**：句库里未加入复习的卡片(srs=null)→ 不计入统计
20. **复习后实时更新**：复习一张卡片评分后 → 统计数值实时变化(待复习减1、复习次数+1)
```

- [ ] **Step 2: 全量回归**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test && NODE_ENV=development npm run build`
Expected: 全绿。

- [ ] **Step 3: commit**

```bash
git add docs/manual-verification-checklist.md
git commit -m "docs(stats): add §15 review stats verification checklist (Phase 3)"
```

---

## 完成判据

- [x] P3-1: stats.ts 纯模块 + 8 个测试
- [x] P3-2: 4 个 i18n 键
- [x] P3-3: 句库 + 生词本抽屉顶部统计条(4 指标)
- [x] P3-4: 验证清单 §15 + 全量回归

## 风险

- **指标定义主观性**:"已掌握 = reps≥3" 是启发式阈值,非严格标准。这是合理的简化(SM-2 里 reps≥3 意味着间隔已增长几次)。若用户觉得阈值不对,后续可配置化(本期固定)。
- **avgEase 含义不直观**:ease 是 SM-2 内部参数(默认 2.5),普通用户可能不理解"掌握度 2.5"。缓解——标签用"掌握度/Retention"而非"Ease",数值直观(越高越好)。若反馈仍不直观,可改显示百分比((ease-1.3)/1.2*100)——本期保留原始值,YAGNI。
- **App.tsx 体积**:再加一个 StatsBar 内联组件,但它是 ~15 行的独立函数,与 PasteBox/ImportMsg 平级,不内联巨型 JSX。
