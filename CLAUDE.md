# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Lector AI 是一个 **Chrome 扩展（Manifest V3）**——**纯客户端、BYOK（Bring Your Own Key）**。扩展读取当前页面，提供 AI 辅助阅读：与页面对话（SSE 流式）、摘要、翻译、沉浸式双语翻译，外加三个离线"知识"功能——引用溯源阅读、高亮→导出、SM-2 词汇本间隔重复。

**没有后端、没有数据库、没有账号。** 用户在扩展设置里填自己的 provider key（OpenAI / Anthropic / OpenRouter / DeepSeek / Groq / 任意 OpenAI 兼容入口……），密钥存在 `chrome.storage.local`，请求从浏览器**直接**发往用户选择的 provider——绝不经过我们。所有 AI 调用都在客户端（sidepanel 或 content script）发起。

## 常用命令

> ⚠️ **`NODE_ENV` 陷阱（务必先读）：** 本机 shell 以 `NODE_ENV=production` 运行，会让 `npm` 跳过 `devDependencies`（vitest、jsdom、typescript、vite、playwright 全在这里）。**所有** install/test/build 都要前置 `NODE_ENV=development`，例如 `NODE_ENV=development npm install`。否则 `vitest`/`vite` 根本解析不到。

| 任务 | 命令 |
|------|---------|
| 类型检查 | `npm run typecheck`（或 `NODE_ENV=development node_modules/.bin/tsc --noEmit`） |
| 构建扩展 | `NODE_ENV=development npm run build:extension` |
| Web 开发（sidepanel HTML） | `npm run dev` |
| 扩展监听器（按 `r` 重建） | `NODE_ENV=development npm run dev:extension` |
| 单元/集成测试 | `NODE_ENV=development npm test` |
| 监听模式测试 | `NODE_ENV=development npm run test:watch` |
| 跑单个测试文件/名称 | `NODE_ENV=development node_modules/.bin/vitest run <pattern>` |
| 真机浏览器 E2E | `NODE_ENV=development npm run build:extension && npm run test:browser` |

构建产物是 `dist/`——通过 `chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序` 加载。`build:extension` 先跑 `vite build`（sidepanel + background 两个 ES 入口），再用独立配置 `vite.content.config.ts` 把 content script 重新打成**单个自包含 IIFE 包**（MV3 content script 不能是 ES module），最后把 `manifest.json`/icons/`content.css` 拷进 `dist/` 根、把 sidepanel HTML 挪到根（见 `scripts/build-extension.mjs`）。

## 架构

### 纯逻辑 / DOM 分层（核心设计规则）

可复用的领域逻辑放在 **`src/shared/*.ts`**，是**零 DOM、零依赖的纯模块**，每个都配一个 vitest 测试：

- `citations.ts`——`[bN]`/`[N]` 引用的解析 / 渲染 / 跳转白名单
- `srs.ts`——SM-2 间隔重复调度器
- `highlights.ts`——高亮类型 + 去重 / 分组 / 搜索
- `vocabulary.ts`——词条类型 + 校验 / 合并 / 创建
- `exporters.ts`——Markdown/Obsidian/Notion 导出 Provider
- `promptTemplates.ts`——"/" 菜单模板的填充 / 过滤 / 校验
- `i18n.ts`——`StringKey` 强类型的双语（en/zh）字符串表
- `providers.ts`——19 家 provider 预设（baseUrl / modelsPath / 默认模型）+ `ByokSettings`
- `byok.ts`——**唯一的 AI 客户端**。`streamChat`（SSE 流式）、`completeOnce`（非流式包装）、`fetchModels`（一键拉取 `/models`）、`testConnection`、`getSettings`/`saveSettings`（读写 `chrome.storage.local`）

这些被 DOM/UI 层（`content.ts`、`sidepanel/App.tsx`、`background.ts`）消费。**禁止在 `src/shared/` 里 import DOM API 或 Chrome API**——正是这条边界让逻辑能在 jsdom 里做单元测试。新增领域逻辑先以纯函数形式落在这里。

### 扩展各面（`src/`）

- `background.ts`——MV3 service worker。职责（BYOK 下刻意最小）：右键菜单（标题按存储的语言偏好 i18n）、键盘命令（`Alt+H` 高亮、`Alt+S` 存词）转发给 content script、打开 side panel，以及**知识采集中继**（content script → `chrome.storage.local` 队列 `lectorHighlights`/`lectorVocab` → sidepanel 抽干并入 zustand）。存词时用用户自己的 key 调一次翻译（BYOK）。
- `content.ts`——注入到所有页面（单个 IIFE 包）。页面抽取（一个迷你的 Readability 式打分器，挑出文字最密集的文章容器并剥离噪声）、选择工具栏（翻译/解释/摘要/提问/高亮/存词）、悬浮 FAB、内联双语翻译（逐段，best-effort，首个错误回报给 sidepanel）。给 live DOM 节点打 `data-lector-id="bN"` 标签，让引用能跳回原处。
- `sidepanel/`——主 React 界面（对话、会话库、高亮抽屉、词汇 SRS 抽屉、模板抽屉、BYOK 设置）。`App.tsx` 消费 shared 模块，用 `renderCitations` 把引用角标渲染到 markdown 之上，角标点击跳回页面原块。
- `manifest.json`——MV3，v0.3.0，`sidePanel` + `activeTab` + `storage` + `contextMenus` + `tabs` + `<all_urls>` host。`action.default_icon` 指向 `icons/`。

### 状态与存储

- **Zustand store**（`src/shared/store.ts`）配 `persist` 中间件 → `localStorage`（`lector-ai-storage`）。持有 BYOK 设置、用量提示、对话会话、高亮、词汇、模板。
- **知识同步是队列式，不是共享 store：** content script 无法直接碰 zustand，所以它 `sendMessage` 给 background worker，后者把 `lectorHighlights`/`lectorVocab` 写入 `chrome.storage.local`；sidepanel 监听 `chrome.storage.onChanged`，合并进 zustand（去重、保留 SRS 进度），然后抽干队列。新增"采集物"时务必沿用这个中继模式。
- **BYOK 设置双写：** zustand（UI 用）+ `chrome.storage.local.lector_byok_settings`（content/background 读）。sidepanel 启动时从 storage 拉一次同步进 zustand；设置改动时 `saveSettings` 写回 storage（注意从 `useStore.getState()` 读最新值，避免闭包陈旧）。

### BYOK / SSE 协议

所有 AI 调用走 `src/shared/byok.ts`。两种 wire format：
- **openai**：`POST {baseUrl}/chat/completions`，`stream:true`，解析 `data:` 行里的 `choices[0].delta.content`（OpenAI / OpenRouter / DeepSeek / Groq / 自定义兼容入口）。
- **anthropic**：`POST {baseUrl}/v1/messages`，`stream:true`，system 单独传，解析 `content_block_delta` 里的 `delta.text`。

`readSSE` 把 SSE 字节流按 `\n` 切行、`data:` 取载荷、`[DONE]` 结束，跨 chunk 的半截 JSON 靠 try/catch + 下一轮补全。`streamChat(onToken)` 把增量回调给 UI 做流式渲染；`completeOnce` 是它的非流式包装（translate/summarize/explain/testConnection 用）。

引用溯源：content script 抽取的块带 `b0/b1/…` id；sidepanel 的系统提示把块编号成 `[0] [1] …`，要求模型只引用这些编号；`renderCitations` 把 `[N]`/`[bN]` 角标白名单限制在当前页的块 id（`b${N}`），点击发 `lector-jump-to` 消息让 content script 滚动到对应 `data-lector-id` 节点。

## 测试

- **vitest + jsdom**，`tests/**/*.test.{ts,tsx}`。配置：`vitest.config.ts`，`globals: false`，`setupFiles: ['tests/setup-env.ts']`。
- BYOK 后无后端，`tests/setup-env.ts` 已无环境变量要设（保留为空占位）。shared 纯逻辑模块零副作用，直接 import 测。
- `tests/content.test.ts` / `tests/extract.test.ts` import `src/content.ts`（它在 import 期注入样式并 console.log），在 jsdom 里跑抽取/工具栏逻辑。
- **`tests/browser/*.mjs`** 是真机浏览器 E2E（Playwright 驱动 macOS 上路径硬编码的真实 Chrome），用 mock 后端伺服真实 `dist/` 产物——**先跑 `build:extension`**。可只跑子集：`npm run test:browser:{content,sidepanel,background}`。

## 易踩坑点

- **shell 里 `NODE_ENV=production`** 会搞坏开发工具链——见上方命令说明。
- **content script 必须是单个 IIFE 包**——`vite.content.config.ts` 用 `inlineDynamicImports` 把 byok/i18n 全内联进 `content.js`，不能有 chunk import 或 dynamic import（MV3 content_scripts 不支持 `type:"module"`）。
- **provider 列表是预设兜底**——真正的模型列表由用户点"拉取模型列表"实时 `GET {baseUrl}/models` 获取；`providers.ts` 里的 `models` 只是 fetch 失败前的占位。
- `tsconfig.json` 的 `include` 只有 `src`（`noEmit`）；打包是 Vite 的活。测试文件由 vitest 自己的 `include` 覆盖。
