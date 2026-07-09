# Lector AI — Bring-Your-Own-Key Reading Companion

A Chrome side-panel AI assistant that **reads the page with you**: chat, summarize,
translate, explain, and learn — right next to any article.

**Free forever. No signup. No subscription.** You bring your own AI provider key
(OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint) and pay your
provider directly. Your key never leaves your browser.

## ✨ Features

- **Side panel chat** — a persistent surface that stays open while you read
- **Chat with this page** — the assistant reasons over the cleaned article text
- **Streamed Markdown replies** — fast, formatted answers
- **Selection toolbar** — translate / explain / summarize / ask on any text
- **Inline bilingual translation** — paragraph-level, Immersive-Translate style
- **Reading library** — saved conversations, stored locally
- **BYOK** — OpenAI · Anthropic · OpenRouter · Custom (DeepSeek, Groq, Together, Ollama, …)

## 🔑 Bring Your Own Key

1. Open the side panel (click the toolbar icon, or the floating **L** button).
2. Click ⚙️ **Settings**.
3. Pick a provider, paste your key, choose a model.
4. Click **Test connection** to verify, then **Done**.

Get a key:
- **OpenAI:** https://platform.openai.com/api-keys
- **Anthropic:** https://console.anthropic.com/settings/keys
- **OpenRouter** (one key, all models — recommended): https://openrouter.ai/keys
- **Custom:** any OpenAI-compatible base URL (e.g. `https://api.deepseek.com/v1`)

Your key is stored in `chrome.storage.local` on your machine and is sent only to
the provider you choose — never to us. If you share a machine, clear storage or
use a separate browser profile.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 18 + TypeScript + TailwindCSS |
| State | Zustand (persisted) |
| AI | Your provider — OpenAI / Anthropic / OpenRouter / OpenAI-compatible |
| Build | Vite |

No backend. No database. No accounts.

## 📁 Project Structure

```
lector-ai/
├── src/
│   ├── manifest.json         # MV3 manifest (side panel + content script)
│   ├── background.ts         # Service worker — opens panel, context menus
│   ├── content.ts            # Page extraction, selection toolbar, bilingual
│   ├── content.css
│   ├── sidepanel/            # Side panel UI (React)
│   │   ├── App.tsx           # Chat + settings drawer + library
│   │   ├── main.tsx
│   │   ├── index.html
│   │   ├── index.css
│   │   └── markdown.ts       # Dependency-free Markdown renderer
│   └── shared/
│       ├── providers.ts      # Provider definitions + model lists
│       ├── byok.ts           # Key storage + streaming client + test connection
│       └── store.ts          # Zustand store (BYOK settings + library)
├── scripts/
│   ├── build-extension.mjs
│   └── dev-extension.mjs
└── public/icons/
```

## 🚀 Getting Started

```bash
npm install
npm run build:extension
```

Then load it:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist` folder

### Development

```bash
npm run dev:extension   # watch + rebuild on demand (press r + Enter to rebuild)
```

## 🔒 Privacy

- Your API key is stored only in your browser's local storage.
- Requests go directly from your browser to your chosen AI provider.
- There is no Lector server in the path — nothing is proxied or logged by us.
- Conversation history (the reading library) is also stored locally.

## 📄 License

MIT
