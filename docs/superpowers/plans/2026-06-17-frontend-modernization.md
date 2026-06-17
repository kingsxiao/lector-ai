# 前端样式现代化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 sidepanel / popup / content 注入 UI 三面统一切换到 Editorial 暖中性设计语言（暖米白底 / 墨褐字 / 单色赭石强调 / 标题衬线 / SVG 线条图标），不改动任何纯逻辑层、后端、状态与协议。

**Architecture:** 新建设计 token 层（`src/styles/tokens.css` 的 `:root` 变量 + `tailwind.config.js` 的 `theme.extend` 语义映射）作为单一真源；新增 SVG 图标组件库 `src/shared/icons.tsx`；sidepanel 与 popup 按 token + 图标重构；content 维持 `.lector-` / `#lector-ai-*` 前缀作用域，就地引用同一套色值常量（禁用全局 `:root`，避免污染宿主页面）。

**Tech Stack:** React 18 · Tailwind 3.4 · TypeScript 5.5 · Vite 5 · vitest + jsdom · Playwright（真机 E2E）。

> 全程命令前缀 `NODE_ENV=development`（本机 shell 默认 production 会跳过 devDeps）。分支：`feat/frontend-modernization`（已建好）。

---

## 文件结构

| 文件 | 职责 | 操作 |
|---|---|---|
| `src/styles/tokens.css` | 设计 token 单一真源（`:root` 变量） | 新建 |
| `src/shared/icons.tsx` | SVG 线条图标组件集（纯展示、可单测） | 新建 |
| `tests/shared/icons.test.tsx` | 图标渲染测试 | 新建 |
| `tailwind.config.js` | `theme.extend` 注入语义 token | 修改 |
| `src/sidepanel/index.css` | `@import` tokens；prose 暖色版；滚动条；focus-ring；抽屉动画 | 修改 |
| `src/sidepanel/App.tsx` | 替换渐变/字号/emoji/抽屉过渡/focus | 修改 |
| `src/popup/index.css` | `@import` tokens | 修改 |
| `src/popup/App.tsx` | 套 token；去过花；emoji→SVG；版本号 | 修改 |
| `src/content.css` | 高亮 4 色降饱和；脉冲色 | 修改 |
| `src/content.ts` | 注入 UI 蓝紫/slate→暖中性赭石；去 scale | 修改 |

---

## Task 1: 设计 token 层

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `tailwind.config.js`
- Modify: `src/sidepanel/index.css`（顶部加一行 `@import`）
- Modify: `src/popup/index.css`（顶部加一行 `@import`）

- [ ] **Step 1: 新建 `src/styles/tokens.css`**

```css
/* Lector AI — Editorial 暖中性设计 token（单一真源）。
   被 sidepanel/index.css 与 popup/index.css @import。
   content.css 不 import：content script 注入到任意网页，禁用全局 :root，
   其样式就地引用下列色值常量，避免污染宿主页面。 */
:root {
  /* 色板 - 暖中性 */
  --bg: #FBF8F2;
  --surface: #FFFFFF;
  --surface-muted: #F5EFE3;
  --line: #E8DECC;
  --line-strong: #D9CBB0;
  --ink: #2B2620;
  --ink-soft: #6B6155;
  --ink-faint: #9A8E7A;
  --accent: #9C6B3C;
  --accent-hover: #875A2F;
  --accent-soft: #F2E6D2;
  --danger: #B4452F;
  --on-accent: #FFF8EE;

  /* 字体 */
  --font-serif: Georgia, 'Iowan Old Style', 'Source Serif Pro', 'Songti SC', serif;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', sans-serif;
  --font-mono: 'SF Mono', Menlo, Consolas, monospace;

  /* 圆角 */
  --r-sm: 6px;
  --r: 10px;
  --r-lg: 14px;
  --r-pill: 999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(60, 40, 15, 0.04);
  --shadow-lg: 0 10px 30px rgba(60, 40, 15, 0.12);
}
```

- [ ] **Step 2: 重写 `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', muted: 'var(--surface-muted)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)', faint: 'var(--ink-faint)' },
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', soft: 'var(--accent-soft)', on: 'var(--on-accent)' },
        danger: 'var(--danger)',
      },
      fontFamily: {
        serif: 'var(--font-serif)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        lg: 'var(--shadow-lg)',
      },
      fontSize: {
        body: ['13px', '1.55'],
        meta: ['11px', '1.45'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: `src/sidepanel/index.css` 顶部插入 import**

在第 1 行 `@tailwind base;` **之前**插入：

```css
@import '../styles/tokens.css';
```

- [ ] **Step 4: `src/popup/index.css` 顶部插入 import**

在第 1 行 `@tailwind base;` **之前**插入：

```css
@import '../styles/tokens.css';
```

- [ ] **Step 5: 构建验证（token 可解析、tailwind 可生成语义类）**

Run: `NODE_ENV=development npm run build:extension 2>&1 | tail -20`
Expected: 构建成功，无 PostCSS/Tailwind 报错；`dist/` 生成。

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css tailwind.config.js src/sidepanel/index.css src/popup/index.css
git commit -m "feat(theme): 引入 Editorial 暖中性设计 token 层"
```

---

## Task 2: SVG 图标组件库

**Files:**
- Create: `src/shared/icons.tsx`
- Create: `tests/shared/icons.test.tsx`

- [ ] **Step 1: 新建 `src/shared/icons.tsx`**

```tsx
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function svgProps(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
}

export function LibraryIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>)
}
export function BookmarkIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>)
}
export function BookOpenIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>)
}
export function LanguagesIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" /></svg>)
}
export function LogOutIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>)
}
export function SendIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>)
}
export function PlusIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M5 12h14" /><path d="M12 5v14" /></svg>)
}
export function XIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>)
}
export function SettingsIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>)
}
export function FileTextIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>)
}
export function SparklesIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /><path d="M20 3v4" /><path d="M22 5h-4" /><path d="M4 17v2" /><path d="M5 18H3" /></svg>)
}
export function ListIcon({ size = 18, ...p }: IconProps) {
  return (<svg {...svgProps(size)} {...p}><path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" /></svg>)
}
```

- [ ] **Step 2: 新建测试 `tests/shared/icons.test.tsx`**

```tsx
import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon, LogOutIcon,
  SendIcon, PlusIcon, XIcon, SettingsIcon, FileTextIcon, SparklesIcon, ListIcon,
} from '../../src/shared/icons'

const icons = {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon, LogOutIcon,
  SendIcon, PlusIcon, XIcon, SettingsIcon, FileTextIcon, SparklesIcon, ListIcon,
}

describe('icons', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    test(`${name} renders an svg with stroke paths`, () => {
      const html = renderToStaticMarkup(<Icon />)
      expect(html).toContain('<svg')
      expect(html).toContain('stroke="currentColor"')
      expect(html).toContain('<path')
      expect(html).toContain('aria-hidden="true"')
    })
  }

  test('size prop sets width/height', () => {
    const html = renderToStaticMarkup(<SendIcon size={24} />)
    expect(html).toContain('width="24"')
    expect(html).toContain('height="24"')
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `NODE_ENV=development node_modules/.bin/vitest run tests/shared/icons.test.tsx`
Expected: PASS（13 个图标 + size = 14 个测试全绿）。

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 无错误（`renderToStaticMarkup` 类型在 `@types/react-dom` 内，已是 devDep）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/icons.tsx tests/shared/icons.test.tsx
git commit -m "feat(icons): 新增 SVG 线条图标组件库及测试"
```

---

## Task 3: sidepanel 全局样式（prose / 滚动条 / focus / 抽屉动画）

**Files:**
- Modify: `src/sidepanel/index.css`（替换 `body` 字体、`.lector-prose`、滚动条、新增 focus-ring 与抽屉动画）

- [ ] **Step 1: 替换 `src/sidepanel/index.css` 的 `body` 与 `.lector-prose` 段**

把现有 `body { font-family... }` 到 `.lector-prose strong { font-weight: 700; }` 整段替换为：

```css
body {
  font-family: var(--font-sans);
  color: var(--ink);
  background: var(--bg);
}

/* Prose styling for streamed Markdown assistant replies — 暖色版. */
.lector-prose {
  font-size: 13px;
  line-height: 1.65;
  color: var(--ink);
  word-wrap: break-word;
}
.lector-prose p { margin: 0 0 8px; }
.lector-prose p:last-child { margin-bottom: 0; }
.lector-prose h1, .lector-prose h2, .lector-prose h3 {
  font-family: var(--font-serif);
  font-weight: 700;
  margin: 14px 0 6px;
  line-height: 1.3;
  color: var(--ink);
}
.lector-prose h1 { font-size: 16px; }
.lector-prose h2 { font-size: 15px; }
.lector-prose h3 { font-size: 14px; }
.lector-prose ul, .lector-prose ol { margin: 0 0 8px; padding-left: 20px; }
.lector-prose li { margin: 2px 0; }
.lector-prose li::marker { color: var(--accent); }
.lector-prose code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--surface-muted);
  color: var(--accent-hover);
  padding: 1px 5px;
  border-radius: 4px;
}
.lector-prose pre {
  background: var(--ink);
  color: #F2E6D2;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0 0 8px;
}
.lector-prose pre code { background: transparent; color: inherit; padding: 0; }
.lector-prose blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 10px;
  color: var(--ink-soft);
  margin: 0 0 8px;
}
.lector-prose a { color: var(--accent); text-decoration: underline; }
.lector-prose strong { font-weight: 700; }
```

- [ ] **Step 2: 替换滚动条段为暖色**

```css
/* Scrollbar polish */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); }
```

- [ ] **Step 3: 在文件末尾追加 focus-ring 工具类与抽屉/弹窗动画**

```css
/* Focus ring — 补足可访问性 */
.lector-focus:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* 抽屉 / 弹窗入场（克制的位移+淡入） */
@keyframes lectorSlideIn {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
}
.lector-anim-slide {
  animation: lectorSlideIn 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes lectorFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.lector-anim-fade {
  animation: lectorFadeIn 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .lector-anim-slide, .lector-anim-fade { animation: none; }
}
```

- [ ] **Step 4: 构建验证**

Run: `NODE_ENV=development npm run build:extension 2>&1 | tail -10`
Expected: 成功，无 CSS 报错。

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/index.css
git commit -m "feat(sidepanel): prose/滚动条/focus/动画 暖色化"
```

---

## Task 4: sidepanel 组件改造（App.tsx）

**Files:**
- Modify: `src/sidepanel/App.tsx`

> 本任务是**按映射表批量替换 + 几处结构微调**。先全局替换类名/emoji，再给抽屉与图标栏加动画/focus 类。

- [ ] **Step 1: 顶部加图标 import**

在第 9 行（`import type { VocabEntry } ...`）之后插入：

```tsx
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon, LogOutIcon,
  SendIcon, PlusIcon, XIcon,
} from '../shared/icons'
```

- [ ] **Step 2: 颜色/字号类名批量替换（按表，整文件 replace-all）**

| 旧 | 新 |
|---|---|
| `bg-slate-50` | `bg-bg` |
| `bg-white` | `bg-surface` |
| `bg-slate-100` | `bg-surface-muted` |
| `hover:bg-slate-50` | `hover:bg-surface-muted` |
| `border-slate-200` | `border-line` |
| `border-slate-100` | `border-line/60` |
| `text-slate-800` | `text-ink` |
| `text-slate-700` | `text-ink` |
| `text-slate-600` | `text-ink-soft` |
| `text-slate-500` | `text-ink-soft` |
| `text-slate-400` | `text-ink-faint` |
| `text-blue-500` | `text-accent` |
| `text-blue-600` | `text-accent` |
| `hover:text-blue-700`/`hover:text-blue-800` | `hover:text-accent-hover` |
| `hover:border-blue-300` / `hover:bg-blue-50` | `hover:border-accent/50` / `hover:bg-accent-soft` |
| `bg-amber-400`（highlights 小圆点） | `bg-accent` |
| `text-amber-600` | `text-accent` |
| `text-red-500` / `hover:text-red-500` | `text-danger` / `hover:text-danger` |
| `shadow-2xl` | `shadow-lg` |
| `text-[13px]` | `text-body` |
| `text-[11px]` | `text-meta` |
| `text-[10px]` | `text-meta` |

> `text-[12px]` 替换为 `text-xs`（同 12px）；徽章 `text-[9px]`、空状态 `text-xl`/`text-sm` 保留。

- [ ] **Step 3: 去渐变 → 单色赭石（按表 replace-all）**

| 旧 | 新 |
|---|---|
| `bg-gradient-to-br from-blue-500 to-purple-600` | `bg-accent` |
| `bg-gradient-to-r from-blue-500 to-purple-600` | `bg-accent` |
| `bg-gradient-to-r from-purple-500 to-pink-500`（Pro 徽章） | `bg-accent` |
| `bg-blue-500`（Sign In 按钮） | `bg-accent` |
| `hover:bg-blue-600` | `hover:bg-accent-hover` |
| `bg-slate-200`（spinner 底） | `bg-line` |
| `border-t-blue-500`（spinner 顶） | `border-t-accent` |

- [ ] **Step 4: 替换 emoji 为图标组件**

| 位置 | 旧 | 新 |
|---|---|---|
| header Library 按钮 | `📚` | `<LibraryIcon />` |
| header Highlights 按钮 | `🔖` | `<BookmarkIcon />` |
| header Vocab 按钮 | `★` | `<BookOpenIcon />` |
| header 双语按钮 | `译` | `<LanguagesIcon />` |
| header 登出按钮 | `⎋` | `<LogOutIcon />` |
| composer 发送按钮 | `<span className="text-sm">↑</span>` | `<SendIcon size={16} />` |
| composer `+ New chat` | `+ 新对话` 文本 | `<PlusIcon size={11} />` 前缀 + 文本 |
| 三个抽屉/弹窗的 `✕` | `✕` | `<XIcon size={15} />` |

示例——header Library 按钮改造后：

```tsx
<button
  onClick={() => setShowLibrary(true)}
  title="Library"
  className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center"
>
  <LibraryIcon />
</button>
```

> 发送按钮的 spinner 保留（streaming 时）；spinner 类名按 Step 3 表换暖色。

- [ ] **Step 5: 三个抽屉面板加 slide 动画类**

把 `Library` / `Highlights` / `Vocab` 抽屉遮罩与面板改为：

```tsx
<div className="absolute inset-0 bg-ink/30 z-40 lector-anim-fade" onClick={...}>
  <div className="absolute right-0 top-0 bottom-0 w-[320px] bg-surface shadow-lg flex flex-col lector-anim-slide">
```

（`w-[300px]` 的 Library 抽屉保留其宽度，仅追加动画类与 `bg-surface shadow-lg`。）

- [ ] **Step 6: auth 弹窗加 fade 动画 + focus**

遮罩 `bg-black/40` → `bg-ink/40` 并加 `lector-anim-fade`；面板加 `lector-anim-slide`；表单 input 加 `lector-focus`。

- [ ] **Step 7: 用户气泡/助手气泡圆角统一到 token**

- 用户气泡：`rounded-2xl rounded-br-md` → `rounded-lg rounded-br-sm`
- 助手气泡：`rounded-2xl rounded-bl-md` → `rounded-lg rounded-bl-sm`

- [ ] **Step 8: 类型检查 + 构建**

Run: `npm run typecheck && NODE_ENV=development npm run build:extension 2>&1 | tail -10`
Expected: 均通过。

- [ ] **Step 9: 单元测试不破**

Run: `NODE_ENV=development npm test 2>&1 | tail -15`
Expected: 全绿。

- [ ] **Step 10: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sidepanel): App 切换到暖中性 token + SVG 图标 + 抽屉动画"
```

---

## Task 5: popup 改造

**Files:**
- Modify: `src/popup/App.tsx`
- Modify: `src/popup/index.css`（import 已在 Task 1 加）

- [ ] **Step 1: 顶部加图标 import**

在 `src/popup/App.tsx` import 区追加：

```tsx
import {
  SettingsIcon, FileTextIcon, LanguagesIcon, SparklesIcon, ListIcon, XIcon,
} from '../shared/icons'
```

- [ ] **Step 2: 去过花 + 套 token（按表 replace-all）**

| 旧 | 新 |
|---|---|
| `bg-gradient-to-br from-slate-100 to-blue-50` | `bg-bg` |
| `bg-gradient-to-r from-blue-500 to-purple-600` | `bg-accent` |
| `hover:from-blue-600 hover:to-purple-700` | `hover:bg-accent-hover` |
| `bg-gradient-to-r from-purple-500 to-pink-500` | `bg-accent` |
| `hover:from-purple-600 hover:to-pink-600` | `hover:bg-accent-hover` |
| `bg-gradient-to-br from-blue-50 to-purple-50`（结果卡） | `bg-surface-muted` |
| `bg-gradient-to-r from-purple-100 to-pink-100`（限额卡） | `bg-accent-soft` |
| `shadow-lg shadow-blue-500/30` / `hover:shadow-xl hover:shadow-blue-500/40` | `shadow-sm` |
| `shadow-lg shadow-purple-500/30` | `shadow-sm` |
| `hover:scale-105` | （删除） |
| `text-blue-600` | `text-accent` |
| `text-gray-800`/`text-gray-700` | `text-ink` |
| `text-gray-600`/`text-gray-500` | `text-ink-soft` |
| `text-gray-400` | `text-ink-faint` |
| `text-blue-500`/`hover:text-blue-700` | `text-accent`/`hover:text-accent-hover` |
| `text-purple-700`/`text-purple-500`/`text-purple-600` | `text-accent` |
| `bg-gray-100`/`hover:bg-gray-200` | `bg-surface-muted`/`hover:bg-line` |
| `bg-gray-50` | `bg-surface-muted` |
| `border-2 border-transparent` | `border border-line` |
| `focus:border-blue-400` | `focus:border-accent` |
| `border-blue-100`/`border-blue-200/50`/`border-purple-200` | `border-accent/30`/`border-line`/`border-accent/40` |
| `bg-blue-500`（Sign In / logo） | `bg-accent` |
| `bg-blue-400`（要点小圆） | `bg-accent` |
| `bg-purple-500`（translation 图标底） | `bg-accent` |
| `rounded-3xl`/`rounded-2xl` | `rounded-lg` |

> `backdrop-blur-sm` 保留（克制，可留）。

- [ ] **Step 3: emoji → SVG 图标**

| 旧 | 新 |
|---|---|
| `📄 Summarize` | `<FileTextIcon size={14} /> Summarize` |
| `🌐 Translate` | `<LanguagesIcon size={14} /> Translate` |
| `✨ Summarize Article` | `<SparklesIcon size={15} /> Summarize Article` |
| `🌐 Translate Text` | `<LanguagesIcon size={15} /> Translate Text` |
| `📋`（Summary 标题前小图标 span） | `<ListIcon size={13} />` |
| `A文`（translation 标题小图标） | `<LanguagesIcon size={13} />` |
| `⚙️`（设置按钮 / Settings 标题） | `<SettingsIcon />` |
| `✕`（关闭） | `<XIcon size={16} />` |

- [ ] **Step 4: 修正页脚版本号**

`src/popup/App.tsx` 页脚 `v0.1.0` → `v0.3.0`（与 `manifest.json` 一致）。

- [ ] **Step 5: 类型检查 + 构建 + 测试**

Run: `npm run typecheck && NODE_ENV=development npm run build:extension 2>&1 | tail -10 && NODE_ENV=development npm test 2>&1 | tail -10`
Expected: 全通过。

- [ ] **Step 6: Commit**

```bash
git add src/popup/App.tsx src/popup/index.css
git commit -m "feat(popup): 套暖中性 token，去过花特效，emoji 换 SVG，修版本号"
```

---

## Task 6: content 注入 UI 色调微调

**Files:**
- Modify: `src/content.css`
- Modify: `src/content.ts`

> content 注入到任意网页，**禁全局 `:root`**，就地用色值常量。色值与 tokens.css 保持一致。

- [ ] **Step 1: `src/content.css` 高亮 4 色降饱和、脉冲色微调**

把现有高亮段替换为：

```css
mark.lector-hl {
  background: linear-gradient(transparent 55%, rgba(217, 180, 125, 0.5) 55%);
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
mark.lector-hl-green {
  background: linear-gradient(transparent 55%, rgba(156, 175, 108, 0.5) 55%);
}
mark.lector-hl-pink {
  background: linear-gradient(transparent 55%, rgba(200, 132, 132, 0.45) 55%);
}
mark.lector-hl-blue {
  background: linear-gradient(transparent 55%, rgba(124, 152, 170, 0.5) 55%);
}
```

脉冲动画降饱和：

```css
@keyframes lectorPulse {
  0% { background-color: rgba(217, 180, 125, 0.55); }
  100% { background-color: transparent; }
}
```

`lector-ai-popup` 滚动条暖色化：

```css
.lector-ai-popup::-webkit-scrollbar-track { background: #F5EFE3; border-radius: 3px; }
.lector-ai-popup::-webkit-scrollbar-thumb { background: #D9CBB0; border-radius: 3px; }
```

- [ ] **Step 2: `src/content.ts` 注入 `<style>`（`style.textContent` 模板字符串）蓝紫→赭石、slate→暖中性**

按表 replace-all：

| 旧 | 新 |
|---|---|
| `linear-gradient(135deg,#667eea 0%,#764ba2 100%)` | `#9C6B3C` |
| `#667eea` | `#9C6B3C` |
| `rgba(102,126,234,...)` | `rgba(156,107,60,...)`（保留各自透明度） |
| `rgba(118,75,162,...)` | `rgba(135,90,47,...)` |
| `#334155` | `#2B2620` |
| `#475569` | `#6B6155` |
| `#64748b` | `#6B6155` |
| `#c7d2fe`（bilingual 左边框） | `#9C6B3C` |
| `#e2e8f0` | `#E8DECC` |
| `#f1f5f9` / `#f8fafc` | `#F5EFE3` |
| `#94a3b8` | `#9A8E7A` |
| `transform: scale(1.05)` / `transform:scale(1.02)` | （删除该声明） |
| emoji `🌐` `📄` `💡`（titleMap / toolbar） | 去掉 emoji留文字：`'翻译结果'` `'摘要结果'` `'解释'`；toolbar `'翻译'` |

FAB 关键帧 `lectorFabPulse` 的 box-shadow 改用赭石阴影色（按上表 rgba）。

- [ ] **Step 3: `src/content.ts` 内联 `style.cssText`（selectionToolbar / loadingPopup / spinner / resultPopup / closeBtn / footer）**

同样按 Step 2 表替换其中出现的 `#667eea`/`#764ba2`/`#e2e8f0`/`#f1f5f9` 等色值。spinner（约 269 行）`border:2px solid #e2e8f0;border-top-color:#667eea` → `border:2px solid #E8DECC;border-top-color:#9C6B3C`。

- [ ] **Step 4: 类型检查 + 构建**

Run: `npm run typecheck && NODE_ENV=development npm run build:extension 2>&1 | tail -10`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/content.css src/content.ts
git commit -m "feat(content): 注入 UI 切换暖中性赭石，高亮降饱和，去 scale hover"
```

---

## Task 7: 全量验证与视觉回归

**Files:**
- Run-only（无新代码文件）

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: 0 error。

- [ ] **Step 2: 构建**

Run: `NODE_ENV=development npm run build:extension 2>&1 | tail -10`
Expected: 成功；`dist/` 含 `manifest.json`、popup/sidepanel HTML 在根、icons、content.css。

- [ ] **Step 3: 全量单元测试**

Run: `NODE_ENV=development npm test 2>&1 | tail -20`
Expected: 全绿（shared 逻辑 + icons）。

- [ ] **Step 4: 真机 E2E（可选，需本地后端或 mock）**

Run: `NODE_ENV=development npm run build:extension && npm run test:browser 2>&1 | tail -30`
Expected: content/sidepanel/background E2E 通过。若默认后端不可用，跳过 AI 交互相关、仅验证 UI 渲染与样式加载不报错。

- [ ] **Step 5: 手动 QA（加载 dist/）**

`chrome://extensions → 开发者模式 → 加载已解压 → 选 dist/`。逐项确认：
- [ ] sidepanel：header 图标为 SVG 线条、赭石强调、衬线标题；助手气泡 prose 暖色（代码块深暖底、blockquote 赭石左边框、`[b1]` 角标赭石）；抽屉有滑入动画；输入框 focus 有软环。
- [ ] popup：两 tab、按钮单色赭石无渐变、无 hover scale、SVG 图标、页脚 v0.3.0。
- [ ] content：选中文本工具栏赭石、FAB 赭石、翻译结果卡暖中性；高亮 4 色柔和；无紫色。

- [ ] **Step 6: 最终 Commit（若有 QA 修复）**

```bash
git add -A
git commit -m "test(frontend): 全量验证通过 — typecheck/build/vitest/手动 QA"
```

---

## Self-Review（plan 写完后自检）

**Spec 覆盖：**
- 设计 token（色板/字体/圆角/阴影/字号）→ Task 1 ✓
- SVG 图标库 `src/shared/icons.tsx` → Task 2 ✓
- sidepanel prose/动画/focus → Task 3 ✓；App.tsx 替换 → Task 4 ✓
- popup 套 token + 去过花 + emoji→SVG + 版本号 → Task 5 ✓
- content.css 高亮降饱和 + content.ts 色调 → Task 6 ✓
- 验证（typecheck/build/vitest/playwright/手动）→ Task 7 ✓
- content.css 作用域隔离（无全局 :root）→ Task 6 注明 ✓
- YAGNI（不改 shared 逻辑/后端/协议/暗色）→ 全程未涉及 ✓

**占位符扫描：** 无 TBD/TODO；每个步骤含具体代码、命令或映射表。

**类型/命名一致：** token 变量名（`--accent`/`--ink` 等）在 tokens.css、tailwind config、index.css、映射表中一致；图标组件名在 icons.tsx、测试、Task 4/5 映射表中一致（`LibraryIcon` 等）。
