# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Lector AI 是一个 **Chrome 扩展（Manifest V3）** 加 **Vercel Serverless 后端**。扩展读取当前页面，提供 AI 辅助阅读：与页面对话（SSE 流式）、摘要、翻译、沉浸式双语翻译，外加三个离线"知识"功能——引用溯源阅读、高亮→导出、SM-2 词汇本间隔重复。

两层一起发布：
- **客户端（`src/`）**——由 Vite 打包成可加载的 `dist/` 扩展。
- **后端（`api/`）**——Vercel Serverless Functions，AI 走 OpenRouter。

## 常用命令

> ⚠️ **`NODE_ENV` 陷阱（务必先读）：** 本机 shell 以 `NODE_ENV=production` 运行，会让 `npm` 跳过 `devDependencies`（vitest、jsdom、typescript、vite、playwright 全在这里）。**所有** install/test/build 都要前置 `NODE_ENV=development`，例如 `NODE_ENV=development npm install`。否则 `vitest`/`vite` 根本解析不到。

| 任务 | 命令 |
|------|---------|
| 类型检查 | `npm run typecheck`（或 `NODE_ENV=development node_modules/.bin/tsc --noEmit`） |
| 构建扩展 | `NODE_ENV=development npm run build:extension` |
| Web 开发（popup/sidepanel HTML） | `npm run dev` |
| 扩展监听器（按 `r` 重建） | `NODE_ENV=development npm run dev:extension` |
| 单元/集成测试 | `NODE_ENV=development npm test` |
| 监听模式测试 | `NODE_ENV=development npm run test:watch` |
| 跑单个测试文件/名称 | `NODE_ENV=development node_modules/.bin/vitest run <pattern>` |
| 真机浏览器 E2E | `NODE_ENV=development npm run build:extension && npm run test:browser` |

构建产物是 `dist/`——通过 `chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序` 加载。`build:extension` 先跑 `vite build`，再把 HTML 入口挪到根目录、把 `manifest.json`/icons/`content.css` 拷进 `dist/` 根（见 `scripts/build-extension.mjs`）。Vite 有 4 个 rollup 入口：`popup`、`sidepanel`、`background`、`content`（见 `vite.config.ts`）。

## 架构

### 纯逻辑 / DOM 分层（核心设计规则）

可复用的领域逻辑放在 **`src/shared/*.ts`**，是**零 DOM、零依赖的纯模块**，每个都配一个 vitest 测试：

- `citations.ts`——`[bN]` 引用的解析 / 渲染 / 系统提示构建
- `srs.ts`——SM-2 间隔重复调度器
- `highlights.ts`——高亮类型 + 去重 / 分组 / 搜索
- `vocabulary.ts`——词条类型 + 校验 / 合并 / 创建
- `exporters.ts`——Markdown/Obsidian/Notion 导出 Provider

这些被 DOM/UI 层（`content.ts`、`sidepanel/App.tsx`、`store.ts`）消费。**禁止在 `src/shared/` 里 import DOM API 或 Chrome API**——正是这条边界让逻辑能在 jsdom 里做单元测试。新增领域逻辑先以纯函数形式落在这里。

### 扩展各面（`src/`）

- `background.ts`——MV3 service worker。负责：右键菜单、键盘命令（`Alt+H` 高亮、`Alt+S` 存词），以及**知识采集中继**（content script → `chrome.storage.local` 队列 `lectorHighlights`/`lectorVocab` → sidepanel 抽干并入 zustand）。还为内联选择工具栏代理 `/summarize`、`/translate`、`/chat` 调用。
- `content.ts`——注入到所有页面。页面抽取（一个迷你的 Readability 式打分器，挑出文字最密集的文章容器并剥离噪声）、选择工具栏、悬浮 FAB、内联双语翻译。给 live DOM 节点打 `data-lector-id="bN"` 标签，好让引用能跳回原处。
- `sidepanel/`——主 React 界面（对话、会话库、高亮抽屉、词汇 SRS 抽屉、鉴权）。`App.tsx` 较大，消费 shared 模块，并用 `renderCitations` 把引用角标渲染到 markdown 之上。
- `popup/`——次要 React 界面（URL 摘要 / 翻译）。维护不如 sidepanel 积极主动。
- `manifest.json`——MV3，v0.3.0，`sidePanel` + `activeTab` + `scripting` + `<all_urls>`。

### 状态与存储

- **Zustand store**（`src/shared/store.ts`）配 `persist` 中间件 → `localStorage`（`lector-ai-storage`）。持有鉴权、用量提示、对话会话、高亮、词汇。
- **知识同步是队列式，不是共享 store：** content script 无法直接碰 zustand，所以它 `sendMessage` 给 background worker，后者把 `lectorHighlights`/`lectorVocab` 写入 `chrome.storage.local`；sidepanel 监听 `chrome.storage.onChanged`，合并进 zustand（去重、保留 SRS 进度），然后抽干队列。新增"采集物"时务必沿用这个中继模式。
- **API base 可运行时配置**，通过 `chrome.storage.local.apiBase`（默认 `https://lector-ai-two.vercel.app/api`，见 `src/shared/config.ts`）。

### 后端（`api/`）

- `_lib/openrouter.ts`——**唯一的 AI 抽象**。`callOpenRouter`（非流式）和 `streamChat`（SSE）。在模块加载时读取 `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`。
- `_lib/ratelimit.ts`——每日配额。登录用户按人（`FREE_DAILY_LIMIT=20`），匿名按 IP（`ANON_DAILY_LIMIT=5`），Pro 免限。**优雅降级：** 未配置 Supabase 时返回 `allowed: true, enforced: false`，本地开发无需 DB 也能跑。
- `_lib/supabase.ts`——用原生 `fetch` 调 Supabase REST/GoTrue。**故意不引入 `@supabase/supabase-js`**（保持冷启动快）。schema 见 `db/schema.sql`。
- 端点：`POST /summarize`、`POST /translate`（非流式）、`POST /chat`（**SSE 流式**）、`POST /auth/{login,register}`、`GET /auth/me`、`POST /subscription/create`、`POST /webhook/lemonsqueezy`。

### 对话 / SSE 协议

`/api/chat` 输出 Server-Sent Events：`data:` 行依次为 `{type:'meta', remaining}` → `{type:'token', delta}`（重复多次）→ `{type:'done'}` 或 `{type:'error', error}`，以 `[DONE]` 结尾。background worker（`readSseToText`）和 sidepanel（`handleSend`）解析的是同一套帧格式。引用溯源：客户端传 `pageBlocks`（来自 content script 的 id+text）；系统提示给每块前缀 `[bN]`，要求模型只引用这些 id；`renderCitations` 把角标白名单限制在当前页的块 id。

## 测试

- **vitest + jsdom**，`tests/**/*.test.ts`。配置：`vitest.config.ts`，`globals: false`，`setupFiles: ['tests/setup-env.ts']`。
- `tests/setup-env.ts` 在**源码 import 之前**设好 `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` 默认值——handler 在模块加载时读这些常量，因此需要测"未配置"分支的测试必须显式清空它们。
- API handler 测试（`tests/api/`）用 `tests/api/_helpers.ts`：mock `req`/`res` + stub `globalThis.fetch`，无需联网/密钥。会跑真实 handler 代码（method/CORS/OPTIONS/校验/限流/SSE/错误）。
- **`tests/browser/*.mjs`** 是真机浏览器 E2E（Playwright 驱动 macOS 上路径硬编码的真实 Chrome）。它们用 mock 后端伺服真实 `dist/` 产物——**先跑 `build:extension`**。可只跑子集：`npm run test:browser:{content,sidepanel,background}`。

## 仓库内参考文档

- `docs/superpowers/plans/` 与 `docs/superpowers/specs/`——三个竞争性功能（引用阅读、高亮、SM-2 词汇）的设计 + 实现计划。现已实现，可用于了解意图。
- `docs/manual-verification-checklist.md`——详尽的中文 Chrome QA 清单。**指出默认生产后端（`lector-ai-two.vercel.app`）当前不可用**——AI 功能需要自建本地后端，或把 `chrome.storage.local.apiBase` 指向你的部署。

## 易踩坑点

- **`README.md` 已过时。** 它声称 AI 后端是 "OpenAI GPT-4o / Claude"——实际代码全部走 **OpenRouter**（`OPENROUTER_API_KEY`/`OPENROUTER_MODEL`）。以代码和 `.env.example` 为准，别信 README 的技术栈表。
- **shell 里 `NODE_ENV=production`** 会搞坏开发工具链——见上方命令说明。
- **默认后端不一定在线。** 凡是改动 AI 端点，都对本地 `api/` 部署测试，别依赖硬编码的默认 URL。
- `tsconfig.json` 的 `include` 同时含 `src` 和 `api`（让后端能 import `src/shared/*` 纯模块），且是 `noEmit`；打包是 Vite 的活。
