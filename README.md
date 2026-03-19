# Lector AI - Smart Reading Assistant

AI-powered Chrome extension for summarizing webpages, translating content, and enhancing your reading experience.

## 🚀 Features

- **Smart Summarization** - One-click article summaries using GPT-4o
- **Instant Translation** - Translate any text on the web
- **Writing Enhancement** - AI-powered writing assistance anywhere
- **Cross-platform** - Works on all Chrome-based browsers

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript |
| Styling | TailwindCSS |
| State | Zustand |
| Backend | Vercel Serverless Functions |
| AI | OpenAI GPT-4o / Claude |
| Database | Supabase |
| Payments | LemonSqueezy |

## 📁 Project Structure

```
lector-ai/
├── src/
│   ├── manifest.json      # Chrome extension manifest
│   ├── background.ts     # Service worker
│   ├── content.ts        # Content script
│   ├── content.css       # Content styles
│   ├── popup/            # Popup UI (React)
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   └── shared/            # Shared utilities
│       ├── api.ts
│       └── store.ts
├── api/                  # Vercel serverless functions
│   ├── summarize/
│   └── translate/
└── public/               # Static assets
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- OpenAI API key (or Anthropic API key)
- Vercel account

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd lector-ai

# Install dependencies
npm install

# Create environment variables
cp .env.example .env.local
```

### Configuration

Create a `.env.local` file with your API keys:

```env
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
```

### Development

```bash
# Start the development server
npm run dev

# Build for production
npm run build
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

## 🔧 Loading the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder after building

## 📈 Roadmap

- [ ] User authentication (Supabase)
- [ ] Payment integration (LemonSqueezy)
- [ ] Chrome Web Store publication
- [ ] Multi-language support
- [ ] Team collaboration features

## 📄 License

MIT
