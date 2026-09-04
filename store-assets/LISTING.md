# Chrome Web Store 上架资料 / Listing — Lector AI

> 直接复制粘贴到开发者后台对应字段。中英文都已备好。
> 版本 0.6.0 · 所有素材在 `store-assets/` 目录。

---

## 图形素材 / Graphic Assets

| 字段 | 文件 | 规格 | 必填 |
|---|---|---|---|
| 商店图标 Store icon | `icons/icon-128.png` | 128×128 PNG | ✅ |
| 宣传图（小）Small promo tile | `icons/promo-small.png` | 440×280 PNG | ✅ |
| 宣传图（大）Marquee promo tile | `icons/promo-marquee.png` | 1400×560 PNG | 选填 |
| 截图 1 · 侧边栏对话（引用角标） | `screenshots/01-chat.png` | 1280×800 PNG | ✅ |
| 截图 2 · 段内双语翻译（v0.6 状态浮条） | `screenshots/02-bilingual.png` | 1280×800 PNG | ✅ |
| 截图 3 · 划词查词卡片（v0.5 学习闭环） | `screenshots/03-lookup.png` | 1280×800 PNG | ✅ |
| 截图 4 · 单词卡 + 到期复习 SRS | `screenshots/04-review.png` | 1280×800 PNG | ✅ |
| 截图 5 · 自带密钥 BYOK 设置 | `screenshots/05-byok.png` | 1280×800 PNG | ✅ |

> 截图均为 **1280×800、8-bit RGB（无透明通道）PNG**，由 `scripts/capture-store-assets.mjs`
> 在无头 Chrome 中驱动 **真实生产 bundle**（dist/ 的 sidepanel.js + content.js）拍摄：
> 界面、译文、查词卡、SRS 按钮全部是产品真实渲染，非示意图拼贴。
> 重拍：`npm run build:extension && node scripts/capture-store-assets.mjs`（支持 `--only 01-chat`）。
> 商店图标与工具栏图标同步重绘（衬线 L + 星芒 + 文字线，`icons/icon.svg` 经
> `python3 generate-icons.py` 生成 16/32/48/128 全套）；下次发版 build 会自动带上新图标。

---

## 名称 / Name
```
Lector AI — Smart Reading Assistant
```

---

## 简短说明 / Summary（≤132 字符，含空格）

**中文：**
```
浏览器侧边栏 AI 阅读助手：与任意网页对话、双语翻译、划词释义、单词卡片。自带 Key，免费无注册。
```
（46 个中文字符，远低于限制）

**English：**
```
Chat with any page, translate bilingually, explain selections, and learn vocab — right from your browser side panel. BYOK, free.
```
（127 字符 ✅）

---

## 详细说明 / Description（≤16,000 字符）

### 中文版

```
Lector AI 是一款驻留在浏览器侧边栏的 AI 阅读伴侣，让你「和文章对话」。

👉 完全免费 · 无需注册 · 无需订阅。你只需填入自己的 AI 提供商 Key（OpenAI、Anthropic、DeepSeek、通义千问、智谱等 19 个预设，或任意 OpenAI 兼容入口），直接向你的提供商付费。你的 Key 永远不会离开浏览器。

✨ 核心功能

• 侧边栏对话 —— 阅读时常驻打开，基于当前文章正文进行问答。
• 与本页对话 —— 助手基于清洗后的文章正文推理，答案带段落引用（citation）。
• 流式 Markdown 回复 —— 快速、排版优美的回答。
• 划词工具栏 —— 任意选中文本即可：翻译 / 释义 / 总结 / 追问。
• 段内双语翻译 —— 沉浸式逐段翻译（Immersive-Translate 风格），支持中、英、日、韩、法、德、西、俄、葡、意、越、阿 12 种语言；翻译实时流式渲染。
• 单词与例句卡片 —— 一键收藏，自动生成释义、词性、CEFR 等级、例句，支持 Anki 导出。
• 间隔重复复习（SRS）—— 按记忆曲线安排单词复习。
• 阅读库 —— 对话记录本地保存，随时回看。

🔑 自带 Key（BYOK）

1. 打开侧边栏（点工具栏图标）。
2. 点 ⚙️ 设置。
3. 选择提供商，粘贴你的 Key。
4. 点「⬇ 拉取模型列表」实时获取该账号下可用的全部模型，再选一个。
5. 点「测试连接」验证，点「完成」。

支持 19 个预设提供商 + 任意自定义 host（Ollama / vLLM / LM Studio / 自建网关……）：
海外：OpenAI · Anthropic · OpenRouter · Groq · Together · Mistral · xAI (Grok) · Perplexity · Fireworks
国内：DeepSeek · 通义千问 · 文心一言 · 豆包 · 智谱 GLM · Moonshot (Kimi) · 硅基流动 · MiniMax · 零一万物 · 阶步星辰

🔒 隐私

• 你的 API Key 仅存储在浏览器本地（chrome.storage.local）。
• 请求从你的浏览器直达你选择的 AI 提供商。
• 全程没有 Lector 服务器介入——不代理、不记录。
• 对话历史（阅读库）同样保存在本地。

无需后端、无需数据库、无需账号。
```

### English版

```
Lector AI is a browser side-panel AI companion that reads the page with you.

👉 Free forever. No signup. No subscription. Bring your own AI provider key (OpenAI, Anthropic, DeepSeek, Qwen, Zhipu, and 19 presets — or any OpenAI-compatible endpoint) and pay your provider directly. Your key never leaves your browser.

✨ Features

• Side-panel chat — a persistent surface that stays open while you read.
• Chat with this page — the assistant reasons over the cleaned article text, with paragraph-level citations.
• Streamed Markdown replies — fast, beautifully formatted answers.
• Selection toolbar — translate / explain / summarize / ask on any selected text.
• Inline bilingual translation — paragraph-level, immersive-style translation in 12 languages (Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, Vietnamese, Arabic), rendered live as tokens stream.
• Vocabulary & sentence cards — save any word to auto-generate definition, part of speech, CEFR level, and examples. Export to Anki.
• Spaced-repetition review (SRS) — vocabulary scheduled on a memory curve.
• Reading library — conversations saved locally for later.

🔑 Bring Your Own Key (BYOK)

1. Open the side panel (click the toolbar icon).
2. Click ⚙️ Settings.
3. Pick a provider, paste your key.
4. Click "⬇ Fetch models" to pull the live catalog, then choose a model.
5. Click "Test connection" to verify, then "Done".

19 presets + any custom host (Ollama / vLLM / LM Studio / your own gateway…).

🔒 Privacy

• Your API key is stored only in your browser's local storage.
• Requests go directly from your browser to your chosen AI provider.
• There is no Lector server in the path — nothing is proxied or logged.
• Conversation history is also stored locally.

No backend. No database. No accounts.
```

---

## 类别 / Category
```
效率工具 / Productivity
```

## 语言 / Language
```
English（建议）+ 中文（简体）
（界面 i18n 支持中英双语，跟随浏览器语言自动切换）
```

## 图形/隐私素材里的“图形资产”
见本文档顶部表格，全部位于 `store-assets/` 目录。

---

## 权限说明（用于“权限理由”字段，按需填写）

后台会逐项询问每个权限的理由，建议回答：

| 权限 | 理由 / Justification |
|---|---|
| `activeTab` / `tabs` | 获取当前页面的标题、URL 与正文，供「与本页对话」与「双语翻译」功能使用。 |
| `storage` | 本地保存用户的 BYOK 设置、阅读库（对话历史）、单词卡片与偏好。 |
| `contextMenus` | 右键菜单：「用 Lector AI 翻译 / 释义 / 总结」所选文本。 |
| `sidePanel` | 在浏览器侧边栏中承载 Lector AI 的对话界面（本扩展的核心交互形态）。 |
| `host_permissions: <all_urls>` | 「与本页对话」和「段内双语翻译」需要读取用户在任意网页上阅读的文章正文。扩展只读取当前激活页面的内容，不会后台抓取。 |

## 单一用途说明 / Single Purpose（≤132 字符）

**中文：**
```
在浏览器侧边栏提供 AI 阅读助手：与网页对话、双语翻译、划词释义与单词学习。
```
**English：**
```
An AI reading assistant in the browser side panel: chat with pages, bilingual translation, and vocab learning.
```

---

---

## 🔗 开发者网站 / Developer Website（必填，需可验证的 URL）

```
https://github.com/kingsxiao/lector-ai
```
> 要求填「来自开发者/公司网站或有效社交媒体账户的有效且可验证的网址」。GitHub 仓库即可满足。
> 如果你已有个人网站 / 其他社媒，可替换为那个链接。

---

## 🔗 支持网址 / Support URL（选填，但强烈建议填）

```
https://github.com/kingsxiao/lector-ai/issues
```
> 用户反馈/提问的入口。填了之后商店页面会显示「支持」按钮。
> （建议提交前在 GitHub Issues 里建一个 Issue 模板，或至少确保仓库是 public 的——当前已是 public。）

---

## 📝 联系邮箱 / Contact Email（必填，开发者后台“账户”里设置，不在商品页）

填一个你能收到商店审核通知的邮箱（通常是你注册开发者账号的 Google 账号邮箱）。商品页不会展示。

---

## 🆕 更新说明 / Release Notes（这是首发版本 0.3.0）

> 首发，所以写成「新上线」的口吻。

### 中文版（建议）

```
🎉 Lector AI 首次上线！

一款驻留在浏览器侧边栏的 AI 阅读伴侣，让你真正「和文章对话」。

• 侧边栏对话：基于当前文章正文问答，答案带段落引用
• 流式 Markdown 回复，快速且排版优美
• 段内双语翻译（沉浸式逐段翻译），支持中/英/日/韩/法/德/西/俄/葡/意/越/阿 12 种语言，实时流式渲染
• 划词工具栏：选中任意文本即可 翻译 / 释义 / 总结 / 追问
• 单词与例句卡片：自动生成释义、词性、CEFR 等级、例句，支持 Anki 导出
• 间隔重复复习（SRS）：按记忆曲线安排复习
• 阅读库：对话记录本地保存
• 自带 Key（BYOK）：19 个提供商预设 + 任意自定义 host，完全免费、无需注册
• 隐私优先：你的 Key 与请求直连你选择的 AI 提供商，全程无 Lector 服务器

快捷键：Alt+H 高亮 · Alt+S 存词 · Alt+T 整页翻译
```

### English版

```
🎉 Lector AI launches!

An AI reading companion that lives in your browser side panel — read smarter, in any language.

• Side-panel chat over the current article, with paragraph-level citations
• Streamed, beautifully formatted Markdown replies
• Inline bilingual translation (immersive, paragraph-by-paragraph) in 12 languages — Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, Vietnamese, Arabic — rendered live as tokens stream
• Selection toolbar: translate / explain / summarize / ask on any text
• Vocabulary & sentence cards with auto-generated definitions, part of speech, CEFR level, and examples — exportable to Anki
• Spaced-repetition review (SRS)
• Reading library: conversations saved locally
• Bring Your Own Key: 19 provider presets + any custom host — free, no signup
• Privacy-first: your key and requests go directly to your chosen AI provider; no Lector server in the path

Shortcuts: Alt+H highlight · Alt+S save word · Alt+T translate page
```

---

## 提交检查清单 / Submission Checklist

- [x] `dist.zip` 已剔除 `key` 字段，`manifest.json` 位于 zip 根目录
- [x] 单元测试 321/321 通过，typecheck/build 通过
- [x] 版本号 0.3.0 三处一致（package.json / src/manifest.json / dist/manifest.json）
- [x] 商店图标 128×128（2026-09 重绘：衬线 L + 星芒 + 文字线）
- [x] 小宣传图 440×280 / 大宣传图 1400×560（2026-09 重绘）
- [x] 截图 ×5（1280×800、8-bit RGB 无透明；真实产品 UI 实拍，覆盖 v0.5/0.6 新功能）
- [ ] 上传后填写隐私实践问卷（见下）

## 隐私实践 / Privacy Practices

提交时需填写“隐私实践”问卷。本扩展属于「有限使用」，要点：

- ✅ **不收集个人身份信息**。
- ✅ 不向 Lector 的服务器发送任何数据（因为没有服务器）。
- ⚠️ **用户提供的 API Key 与对话内容**会发送到**用户自己选择**的第三方 AI 提供商（OpenAI 等），但这些数据由用户自行控制，不经过 Lector。
- ✅ 所有本地数据（Key、阅读库、单词卡片）使用 `chrome.storage.local` 存储，可由用户随时清除。

权限勾选对应数据用途时：
- `storage` → "本地存储设置与数据"（选「不用于……」中除本地存储外的项；本质是本地，不上报）。
- 其余权限不涉及数据上报。

> 如果你不确定，可在隐私实践页声明：**本扩展不上传任何用户数据至开发者或其第三方服务器；用户的 AI 请求直连用户自选的 AI 提供商。**
```
