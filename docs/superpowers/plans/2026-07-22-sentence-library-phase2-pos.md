# Phase 2: 彩色词性标注 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让句库卡片的「句法结构」节支持逐词彩色词性标注(对标 Trancy 王牌卖点)。

**Architecture:** 改 prompt 让模型在「句法结构」节额外输出一行标记句(如 `[n]quick[/n] [a]brown[/a]`);给 markdown.ts 加 1 条内联渲染规则把标记转成带颜色 class 的 span;index.css 加 8 个词性颜色 class。全程在 XSS-safe 的 escape-after 管道内。

**Tech Stack:** TypeScript + Vitest + CSS(无新依赖)。

## Global Constraints

- **XSS 安全**:`renderMarkdown` 先 `escapeHtml` 再插标签,词性标记规则必须在 escape 之后执行(标记本身是模型输出的文本,可能含恶意内容)。
- **向后兼容**:旧卡片(句法节无标记句)必须正常渲染,不报错、不显示乱码。标记规则是"有则上色,无则原样"。
- **范围**:只动「句法结构」节。标记是通用内联规则(任何 Markdown 文本里的 `[x]...[/x]` 都会上色),但只有句法节的 prompt 会要求模型输出。
- **NODE_ENV**:命令前置 `NODE_ENV=development`。
- **词性缩写固定 8 类**:`n`(名词)/`v`(动词)/`a`(形容词)/`d`(副词)/`p`(介词)/`c`(连词)/`r`(代词)/`t`(冠词)。未知缩写不上色(降级为原文本)。
- **配色**:8 色需在 Lector 暖中性 ochre 主题内和谐,不彩虹化。每个词性文字用该色,背景用极淡同色,保证可读性。

---

### Task P2-1: markdown.ts 词性标记内联规则 + 测试(TDD)

**Files:**
- Modify: `src/sidepanel/markdown.ts`(`renderInline` 函数,约 line 18-34)
- Test: `tests/markdown.test.ts`(append)

**Interfaces:**
- Produces:`renderInline` 新增一条规则,把 `[x]content[/x]`(x 为 n/v/a/d/p/c/r/t)转成 `<span class="lector-pos lector-pos-x">content</span>`。content 先经 escape(已在函数开头执行),再被 span 包裹。

**标记格式**:`[n]word[/n]` → 名词蓝色。模型在句法节输出这种格式。规则用正则 `/\[(n|v|a|d|p|c|r|t)\]([^\[]*?)\[\/\1\]/g`,只匹配 8 个已知缩写,未知字母不上色(降级)。

- [ ] **Step 1: 写失败测试**

Append to `tests/markdown.test.ts`:

```ts
describe('POS color tags', () => {
  it('renders [n]word[/n] as a colored noun span', () => {
    const out = renderMarkdown('[n]fox[/n]')
    expect(out).toContain('<span class="lector-pos lector-pos-n">fox</span>')
  })

  it('renders all 8 POS types with their class', () => {
    const tagged = '[n]fox[/n] [v]runs[/v] [a]quick[/a] [d]fast[/d] [p]on[/p] [c]and[/c] [r]she[/r] [t]the[/t]'
    const out = renderMarkdown(tagged)
    expect(out).toContain('lector-pos-n">fox')
    expect(out).toContain('lector-pos-v">runs')
    expect(out).toContain('lector-pos-a">quick')
    expect(out).toContain('lector-pos-d">fast')
    expect(out).toContain('lector-pos-p">on')
    expect(out).toContain('lector-pos-c">and')
    expect(out).toContain('lector-pos-r">she')
    expect(out).toContain('lector-pos-t">the')
  })

  it('does NOT colorize unknown tag letters (degrades to plain text)', () => {
    const out = renderMarkdown('[x]unknown[/x]')
    expect(out).not.toContain('lector-pos')
    // 标记符号保留为可见文本(未被消费),不报错
    expect(out).toContain('[x]unknown[/x]')
  })

  it('works inside a sentence with surrounding plain words', () => {
    const out = renderMarkdown('The [n]fox[/n] jumps.')
    expect(out).toContain('lector-pos-n">fox')
    expect(out).toContain('The ')
    expect(out).toContain(' jumps.')
  })

  it('escapes HTML inside the tagged word (XSS-safe)', () => {
    const out = renderMarkdown('[n]<script>[/n]')
    expect(out).toContain('lector-pos-n">&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })

  it('renders correctly when analysis has no POS tags (backward compat)', () => {
    const out = renderMarkdown('## 句法结构\n\n主谓宾结构清晰。')
    expect(out).toContain('主谓宾结构清晰。')
    expect(out).not.toContain('lector-pos')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- markdown`
Expected: FAIL — `[n]fox[/n]` 未被转成 span。

- [ ] **Step 3: 实现规则**

在 `src/sidepanel/markdown.ts` 的 `renderInline` 函数中,**在 escapeHtml 之后、inline code 之前**加一条规则(因为标记内容要先 escape)。定位:`renderInline` 函数体,`let out = escapeHtml(s)` 之后:

```ts
function renderInline(s: string): string {
  let out = escapeHtml(s)
  // POS color tags [n]word[/n] → colored span (only the 8 known codes).
  // Runs before other inline rules; content already escaped above so XSS-safe.
  out = out.replace(
    /\[(n|v|a|d|p|c|r|t)\]([^\[]*?)\[\/\1\]/g,
    (_m, code, text) => `<span class="lector-pos lector-pos-${code}">${text}</span>`
  )
  // inline code first so its content isn't re-processed
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // italic
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
  // links
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })
  return out
}
```

注意:POS 标记正则 `[^\[]*?` 匹配到下一个 `[` 为止,避免贪婪跨标签。链接正则用的是 `\[([^\]]+)\]` 形式——POS 标记的 `[n]` 是单字母且后跟 `]`,而链接是 `[text](url)` 形式,二者不冲突(POS 标记先执行,消费掉 `[x]...[/x]`;剩余的 `[text](...)` 链接走链接规则)。但需验证 `[t]the[/t]` 不会被误判——因为 POS 正则要求 `[x]...[/x]` 配对,而链接是 `[x](url)`,不配对所以安全。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `NODE_ENV=development npm test -- markdown && NODE_ENV=development npm run typecheck`
Expected: markdown 测试全绿(含新增 6 个),typecheck 无错。

- [ ] **Step 5: commit**

```bash
git add src/sidepanel/markdown.ts tests/markdown.test.ts
git commit -m "feat(sentences): POS color tag rendering in markdown (Phase 2)"
```

---

### Task P2-2: 8 个词性颜色 CSS class

**Files:**
- Modify: `src/sidepanel/index.css`(append,after `.lector-prose strong` 约行 63)

**配色方案**(暖中性主题内,文字用饱和色,背景极淡):
- `n` 名词:`#2B5FA8` 蓝 / bg `#EAF1FB`
- `v` 动词:`#B4452F` 红(复用 --danger)/ bg `#FBEEEA`
- `a` 形容词:`#3E7B47` 绿 / bg `#EAF3EC`
- `d` 副词:`#7B3E9E` 紫 / bg `#F3EAFA`
- `p` 介词:`#A85E1E` 橙(复用 --accent 色系)/ bg `#FBF0E4`
- `c` 连词:`#6B6155` 灰(复用 --ink-soft)/ bg `#F5EFE3`(复用 --surface-muted)
- `r` 代词:`#1F7A8C` 青 / bg `#E8F4F6`
- `t` 冠词:`#A8478F` 粉 / bg `#FAEAF4`

- [ ] **Step 1: 追加 CSS**

在 `src/sidepanel/index.css` 的 `.lector-prose strong { font-weight: 700; }` 之后追加:

```css
/* POS color tags (Feature ④ Phase 2) — 逐词词性标注 */
.lector-pos {
  border-radius: 3px;
  padding: 1px 2px;
  font-weight: 600;
}
.lector-pos-n { color: #2B5FA8; background: #EAF1FB; }
.lector-pos-v { color: #B4452F; background: #FBEEEA; }
.lector-pos-a { color: #3E7B47; background: #EAF3EC; }
.lector-pos-d { color: #7B3E9E; background: #F3EAFA; }
.lector-pos-p { color: #A85E1E; background: #FBF0E4; }
.lector-pos-c { color: #6B6155; background: #F5EFE3; }
.lector-pos-r { color: #1F7A8C; background: #E8F4F6; }
.lector-pos-t { color: #A8478F; background: #FAEAF4; }
```

- [ ] **Step 2: build 验证 + 全量回归**

Run: `NODE_ENV=development npm run build && NODE_ENV=development npm test`
Expected: build 成功(CSS 编译通过),193+ 测试全绿。

- [ ] **Step 3: commit**

```bash
git add src/sidepanel/index.css
git commit -m "feat(sentences): POS color CSS classes (8 types, warm-theme palette)"
```

---

### Task P2-3: prompt 改造 + 句法节测试

**Files:**
- Modify: `src/shared/sentences.ts`(`SENTENCE_CARD_SYSTEM_PROMPT` 的 `## 句法结构` 节,line 253-254)
- Test: `tests/sentences.test.ts`(append prompt 断言)

**目标**:让模型在「句法结构」节**先输出一行标记句**(逐词标词性),再输出主谓宾/从句拆解说明。

- [ ] **Step 1: 写失败测试**

Append to `tests/sentences.test.ts`:

```ts
describe('SENTENCE_CARD_SYSTEM_PROMPT — POS tags (Phase 2)', () => {
  it('instructs the model to output a POS-tagged sentence in 句法结构', () => {
    // prompt 必须说明标记格式 + 8 个缩写
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[n]')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[/n]')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[v]')
    // 必须列出全部 8 个缩写
    for (const code of ['n', 'v', 'a', 'd', 'p', 'c', 'r', 't']) {
      expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain(`[${code}]`)
    }
  })

  it('keeps 句法结构 as the second H2 section', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 句法结构')
    // 顺序:译文 → 句法结构
    const yi = SENTENCE_CARD_SYSTEM_PROMPT.indexOf('## 译文')
    const ju = SENTENCE_CARD_SYSTEM_PROMPT.indexOf('## 句法结构')
    expect(yi).toBeLessThan(ju)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `NODE_ENV=development npm test -- sentences`
Expected: FAIL — prompt 当前不含 `[n]` 标记格式说明。

- [ ] **Step 3: 改造 prompt**

在 `src/shared/sentences.ts` 的 `SENTENCE_CARD_SYSTEM_PROMPT`,把 `## 句法结构` 节(约 line 253-254)从:
```
## 句法结构
<break down 主谓宾 / clause structure / grammar points; 2-4 short lines or bullets>
```
改为:
```
## 句法结构
First, output ONE line: the sentence with each word wrapped in a POS tag using
this format: [n]noun[/n] [v]verb[/v] [a]adjective[/a] [d]adverb[/d] [p]preposition[/p]
[c]conjunction[/c] [r]pronoun[/r] [t]article[/t]. Tag every content word. Then
break down 主谓宾 / clause structure / grammar points in 2-4 short lines or bullets.
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `NODE_ENV=development npm test && NODE_ENV=development npm run typecheck && NODE_ENV=development npm run build`
Expected: 全部测试绿(sentences 新增 2 个),typecheck/build 无错。

- [ ] **Step 5: commit**

```bash
git add src/shared/sentences.ts tests/sentences.test.ts
git commit -m "feat(sentences): prompt outputs POS-tagged sentence in 句法结构 (Phase 2)"
```

---

### Task P2-4: 手动验证清单更新 + 回归

**Files:**
- Modify: `docs/manual-verification-checklist.md`(§14 追加)

- [ ] **Step 1: 追加验证项**

在 §14 末尾追加:
```markdown
13. **彩色词性标注**:生成新卡片(网页选中或粘贴)→ 展开句法结构 →
    首行逐词彩色标注(名词蓝/动词红/形容词绿等 8 色)→ 鼠标无异常
14. **向后兼容**:查看 Phase 2 之前生成的旧卡片 → 句法结构正常显示
    (无标记句则原样渲染,不报错、不显示 `[n]` 乱码)
15. **配色可读性**:8 色在浅色背景下文字清晰可辨,不刺眼
```

- [ ] **Step 2: 全量回归**

Run: `NODE_ENV=development npm run typecheck && NODE_ENV=development npm test && NODE_ENV=development npm run build`
Expected: 全绿。

- [ ] **Step 3: commit**

```bash
git add docs/manual-verification-checklist.md
git commit -m "docs(sentences): add Phase 2 POS verification items to §14"
```

---

## 完成判据

- [x] P2-1: markdown `[x]...[/x]` → 彩色 span(8 类),XSS-safe,向后兼容,6 个新测试
- [x] P2-2: 8 个词性颜色 CSS class(暖主题配色)
- [x] P2-3: prompt 句法节要求输出标记句,2 个新测试
- [x] P2-4: 验证清单 §14.13-15 + 全量回归

## 风险

- **模型不遵循标记格式**:小模型可能漏标或格式错。缓解——标记规则对缺失降级为原文本(向后兼容);用户可重新生成。Phase 2 是视觉增强,不影响核心卡片可用性。
- **词性判断错误**:AI 可能标错词性(如把动名词标成名词)。这是模型能力问题,非渲染 bug;用户可忽略颜色看文字。
- **链接正则与 POS 正则冲突**:POS 标记 `[n]...[/n]` 与 Markdown 链接 `[text](url)` 形式不同(POS 需配对 `[/x]`,链接需 `(url)`),POS 正则先执行消费配对标记,剩余单 `[` 不影响链接规则。测试覆盖混合场景验证。
