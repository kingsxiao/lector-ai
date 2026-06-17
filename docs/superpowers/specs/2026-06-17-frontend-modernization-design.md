# Lector AI — 前端样式现代化设计

**日期：** 2026-06-17
**状态：** 设计已确认，待实现

## 背景与目标

当前三个前端面（sidepanel、popup、content 注入 UI）使用纯 Tailwind 且**零自定义 token**（`tailwind.config.js` 的 `theme.extend` 为空），产生一组可观察的问题：

- **配色默认值化**：`blue-500→purple-600` 渐变反复出现在 logo、发送按钮、用户气泡、登录按钮、Pro 徽章——最"AI 工具默认"的搭配，缺乏个性。
- **emoji 当图标**（📚 🔖 ★ 译 ⎋ ⚙️ 📄 🌐 ✨）：跨平台渲染不一致，显廉价。
- **字号全用任意值** `[13px][12px][11px][10px][9px]`：未走 Tailwind 尺度，无层级节奏。
- **圆角/阴影各搞各的**：sidepanel 偏平淡，popup 反而过花（`shadow-blue-500/30`、`hover:scale-105`），两面风格不统一。
- **无暗色模式**；抽屉/弹窗无过渡动画（直接闪现）；focus 状态薄弱（只改 border 色、无 focus ring）——可访问性差。
- **两套渐变打架**：品牌蓝紫 + Pro 紫粉，视觉不聚焦。

**目标**：在**不改动任何纯逻辑层、后端、状态/协议**的前提下，建立统一的暖中性（Editorial）设计语言，使界面"现代而不花哨"，三面风格一致。仅做浅色（暗色留作后续独立 feature）。

## 设计方向（已确认）

**A · Editorial 暖中性**：

- 暖米白底 + 墨褐字 + 单色赭石强调。
- 标题/品牌用克制衬线，正文/UI 用现代无衬线。
- 助手气泡靠暖白卡 + 细暖边框 + 极轻阴影分层；用户气泡用赭石实底。
- **全局去渐变**（`blue→purple` / `purple→pink`）改单色赭石。
- **emoji 全部换 SVG 线条图标**（1.6px 描边、`currentColor`）。

范围：sidepanel + popup + content 注入 UI 三面统一；content 注入部分仅微调色调以匹配，不大改结构。

## 设计 Token

### 色板（暖中性）

| token | 值 | 用途 |
|---|---|---|
| `--bg` | `#FBF8F2` | 页面暖米白底 |
| `--surface` | `#FFFFFF` | 卡片 / header / composer |
| `--surface-2` | `#F5EFE3` | 次级面（hover、代码块底） |
| `--border` | `#E8DECC` | 暖边框 |
| `--border-strong` | `#D9CBB0` | 强边框 / 设备描边 |
| `--text` | `#2B2620` | 墨褐主文字 |
| `--text-2` | `#6B6155` | 次文字 |
| `--text-3` | `#9A8E7A` | 弱文字 / placeholder |
| `--accent` | `#9C6B3C` | 赭石强调（按钮 / 链接 / logo / 角标 / 用户气泡） |
| `--accent-hover` | `#875A2F` | 强调 hover |
| `--accent-soft` | `#F2E6D2` | 强调浅底（选中 / focus 环） |
| `--danger` | `#B4452F` | 暖红（错误 / due 徽章） |
| `--on-accent` | `#FFF8EE` | 强调色之上的文字 |

### 字体

- `--serif`：`Georgia, 'Iowan Old Style', 'Source Serif Pro', 'Songti SC', serif`（标题 / 品牌）
- `--sans`：`-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', sans-serif`（正文 / UI）
- `--mono`：`'SF Mono', Menlo, Consolas, monospace`（代码）

### 圆角 / 阴影

- 圆角：`--r-sm: 6px` / `--r: 10px` / `--r-lg: 14px` / `--r-pill: 999px`
- 阴影：`--shadow-sm: 0 1px 2px rgba(60,40,15,.04)`（卡片）/ `--shadow-lg: 0 10px 30px rgba(60,40,15,.12)`（抽屉 / 弹窗）

### 字号语义

替换散落的 `[13px][12px][11px][10px][9px]` 任意值：正文统一到 Tailwind 自定义尺度（如 `text-body` ≈ 13px / `text-meta` ≈ 11px），或直接用 `text-sm`/`text-xs` 档位 + 极少量 `text-[11px]` 用于元信息。目标是有节奏的层级，而非每个元素一个魔法数。

## 文件级方案

### 新增

- **`src/styles/tokens.css`** — 全部 `:root` 变量（上表）。由 `sidepanel/index.css`、`popup/index.css` `@import`。
- **`src/shared/icons.tsx`** — SVG 线条图标组件集（lucide 风，`stroke-width=1.6`、`currentColor`、24×24 viewBox）。清单：`Library, Bookmark, BookOpen, Languages, LogOut, Send, Plus, X, Settings, Sparkles, ChevronLeft` 等。
  - **边界说明**：此文件为无状态纯展示组件，仅 `import React`、不触碰 `document`/`window`/`chrome` 任何 API，输出确定性 JSX，可在 jsdom 内做渲染快照单测——符合 `src/shared/` "纯模块、可单测" 的边界（shared 禁止的是 DOM/Chrome API 业务逻辑，本组件不含）。

### 修改

- **`tailwind.config.js`** — `theme.extend` 注入语义色 / 字体 / 圆角 / 阴影，映射到上述 CSS 变量。同步把 `content` glob 确认覆盖 `src/styles/`、`src/shared/icons.tsx`。
- **`src/sidepanel/index.css`** — `@import '../styles/tokens.css'`；重写 `.lector-prose` 为暖色版（inline code 暖底 `--surface-2`、pre 代码块深暖底 `--text` + 暖字、blockquote 赭石左边框、链接赭石）；滚动条暖色化；新增 focus-ring 工具类、抽屉 slide-in 关键帧、`@media (prefers-reduced-motion)`。
- **`src/sidepanel/App.tsx`** — 替换全部 `bg-gradient-to-* from-blue-500 to-purple-600` → 单色赭石语义类；字号任意值 → 语义尺度；所有 emoji → `<Icon .../>`；三个抽屉 + auth 弹窗加 `translate-x`/`opacity` 过渡；补 `:focus-visible`；统一圆角到 token。
- **`src/popup/index.css`** — `@import` tokens.css。
- **`src/popup/App.tsx`** — 套用同套 token；**去掉过度的** `shadow-blue-500/30`、`hover:scale-105`、紫粉渐变，拉齐到 sidepanel 的克制度；emoji → SVG；修正页脚版本号 `v0.1.0` → `v0.3.0`。
- **`src/content.css`** — 高亮 4 色（黄/绿/粉/蓝）降饱和融入暖中性；脉冲动画色微调。**保持 `.lector-` 前缀作用域，不引入全局 `:root`**。
- **`src/content.ts`** — 选择工具栏、悬浮 FAB、双语翻译条的 className 改用暖中性（就地引用同一套色值常量；content 不能用全局 token，见风险节）。

### 不改（YAGNI）

- `src/shared/*.ts` 纯逻辑（citations / srs / highlights / vocabulary / exporters / store / api / config / markdown）— 一行不动。
- `api/` 后端。
- `src/background.ts` 的中继 / 菜单 / 命令逻辑（background 无 UI）。
- zustand store 与 content→background→storage 知识中继协议。
- `/chat` SSE 帧协议。
- 暗色模式（后续独立 feature）。

## 动画与可访问性（克制）

- **抽屉 / 弹窗**：`translate-x(8px→0)` + `opacity(0→1)`，180ms `cubic-bezier(0.16,1,0.3,1)`；`@media (prefers-reduced-motion: reduce)` 下退化为无动画直接显示。
- **focus**：`:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }`，补足现有"只改 border"的可访问性短板。
- **hover**：仅背景/边框色过渡（150ms），**不用 `transform: scale`**（避免花哨）。
- **spinner**：保留，边框色暖化（`--border` + `--accent` 顶边）。

## 验证

- [ ] `npm run typecheck` 通过。
- [ ] `NODE_ENV=development npm run build:extension` 通过；`dist/` 布局匹配 `manifest.json` 引用。
- [ ] 现有 vitest 全绿（shared 纯逻辑不受影响）。
- [ ] 复用 `tests/browser/` playwright E2E，补关键状态截图：sidepanel 空状态 / 对话中（含 prose + `[b1]` 角标）/ 抽屉打开 / auth 弹窗；popup summarize 与 translate 两 tab。
- [ ] 手动走 `docs/manual-verification-checklist.md` 样式相关项（对本地 `api/` 部署测试；默认生产后端不一定在线）。

## 风险

- **content.css 作用域**：content script 注入到任意网页，**禁用全局 `:root` 与全局类名**，所有样式必须 `.lector-` 前缀——否则会污染宿主页面样式或被宿主覆盖。token 在 content 侧只能以就地色值常量形式引用。
- **衬线字体跨平台**：Georgia / Iowan Old Style 在 macOS 表现好，Windows / Linux 回退到通用衬线；可接受（标题衬线是锦上添花，回退不影响任何功能）。
- **任意值清理的紧凑度**：sidepanel 是窄面板，把 `[13px]` 等替换为语义尺度时需逐处核对不破坏紧凑布局。
- **图标组件归属**：`src/shared/icons.tsx` 引入 `.tsx` 到目前全是 `.ts` 纯逻辑的 shared 目录；若 review 认为破坏 shared 纯逻辑语义，可零成本迁移到新建的 `src/components/icons.tsx`。
