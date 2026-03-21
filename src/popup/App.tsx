import { useState, useEffect } from 'react'
import { summarizeUrl, translateText as apiTranslateText } from '../shared/api'
import { useStore } from '../shared/store'

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [keyPoints, setKeyPoints] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [apiBase, setApiBase] = useState('https://your-app.vercel.app/api')
  const [activeTab, setActiveTab] = useState<'summarize' | 'translate'>('summarize')
  const [translateText, setTranslateText] = useState('')
  const [translatedResult, setTranslatedResult] = useState('')
  const [targetLang, setTargetLang] = useState('English')
  const { usageCount, isPro, incrementUsage } = useStore()

  useEffect(() => {
    // 获取保存的 API Base
    chrome.storage.local.get(['apiBase'], (result) => {
      if (result.apiBase) setApiBase(result.apiBase as string)
    })

    // 自动获取当前标签页的 URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        // 排除 chrome:// 和 edge:// 等内部页面
        if (!tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('edge://')) {
          setUrl(tabs[0].url)
        }
      }
    })
  }, [])

  const handleSummarize = async () => {
    if (!url) return
    if (!isPro && usageCount >= 3) {
      setError('Daily limit reached. Upgrade to Pro for unlimited access.')
      return
    }

    setLoading(true)
    setError('')
    setSummary('')
    setKeyPoints([])

    try {
      const result = await summarizeUrl(url)
      setSummary(result.summary)
      setKeyPoints(result.keyPoints || [])
      incrementUsage()
    } catch {
      setError('Failed to summarize. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleTranslate = async () => {
    if (!translateText.trim()) return
    if (!isPro && usageCount >= 3) {
      setError('Daily limit reached. Upgrade to Pro for unlimited access.')
      return
    }

    setLoading(true)
    setError('')
    setTranslatedResult('')

    try {
      const result = await apiTranslateText(translateText, targetLang)
      setTranslatedResult(result)
      incrementUsage()
    } catch {
      setError('Failed to translate. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (activeTab === 'summarize') handleSummarize()
      if (activeTab === 'translate' && e.ctrlKey) handleTranslate() // Ctrl+Enter for translation
    }
  }

  const languages = ['English', 'Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Portuguese', 'Russian', 'Arabic']

  return (
    <div className="w-[360px] bg-gradient-to-br from-slate-100 to-blue-50 min-h-[400px] overflow-hidden rounded-2xl" style={{ borderRadius: '16px' }}>
      <div className="bg-white m-2 p-4 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg" style={{ borderRadius: '12px' }}>L</div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">Lector AI</h1>
              <p className="text-[10px] text-gray-400">Smart Reading Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPro ? (
              <span className="px-3 py-1 text-[10px] font-medium rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md">Pro</span>
            ) : (
              <span className="px-3 py-1 text-[10px] font-medium rounded-full bg-gray-100 text-gray-500">{3 - usageCount}/3 free</span>
            )}
            <button onClick={() => setShowSettings(true)} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all hover:scale-105">
              ⚙️
            </button>
          </div>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
          <button onClick={() => setActiveTab('summarize')} className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'summarize' ? 'bg-white text-blue-600 shadow-md' : 'text-gray-500 hover:text-gray-700'}`}>
            📄 Summarize
          </button>
          <button onClick={() => setActiveTab('translate')} className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'translate' ? 'bg-white text-blue-600 shadow-md' : 'text-gray-500 hover:text-gray-700'}`}>
            🌐 Translate
          </button>
        </div>

        {activeTab === 'summarize' ? (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste article URL here..."
                className="w-full px-4 py-3.5 pr-10 bg-gray-50 border-2 border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition-all"
              />
              {url && (
                <button onClick={() => setUrl('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-300 hover:text-gray-700 transition-colors">✕</button>
              )}
            </div>

            <button
              onClick={handleSummarize}
              disabled={loading || !url}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-blue-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  Analyzing...
                </>
              ) : (
                <>✨ Summarize Article</>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={translateText}
              onChange={(e) => setTranslateText(e.target.value)}
              placeholder="Enter text to translate..."
              rows={4}
              className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm resize-none focus:outline-none focus:border-blue-400 focus:bg-white transition-all"
            />
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition-all cursor-pointer"
            >
              {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
            </select>
            <button 
              onClick={handleTranslate}
              disabled={loading || !translateText.trim()}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-blue-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  Translating...
                </>
              ) : (
                <>🌐 Translate Text</>
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-xs text-red-600 text-center">{error}</p>
          </div>
        )}

        {activeTab === 'summarize' && summary && (
          <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-100">
            <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-blue-500 text-white text-xs flex items-center justify-center">📋</span> Summary
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">{summary}</p>

            {keyPoints.length > 0 && (
              <div className="mt-3 pt-3 border-t border-blue-200/50">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Key Points:</h4>
                <ul className="space-y-1.5">
                  {keyPoints.map((point, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'translate' && translatedResult && (
          <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-100">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-purple-500 text-white text-xs flex items-center justify-center">A文</span> Translation
              </h3>
              <button 
                onClick={() => navigator.clipboard.writeText(translatedResult)}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{translatedResult}</p>
          </div>
        )}

        {!isPro && usageCount >= 3 && (
          <div className="mt-4 p-4 bg-gradient-to-r from-purple-100 to-pink-100 rounded-xl border border-purple-200">
            <div className="text-center">
              <p className="text-sm font-bold text-purple-700 mb-1">Daily limit reached</p>
              <p className="text-xs text-purple-500 mb-3">Upgrade to Pro for unlimited summaries</p>
              <button className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-xs font-semibold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/30">
                Upgrade to Pro - $9/month
              </button>
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white m-4 p-5 rounded-3xl shadow-2xl w-[320px]">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-gray-800">⚙️ Settings</h2>
              <button onClick={() => setShowSettings(false)} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all hover:scale-105">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">API Base URL</label>
                <input
                  type="url"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="https://your-api.vercel.app/api"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition-all"
                />
                <p className="text-[10px] text-gray-400 mt-1.5">部署到 Vercel 后替换为你的 API 地址</p>
              </div>

              <button
                onClick={() => {
                  chrome.storage.local.set({ apiBase })
                  setShowSettings(false)
                }}
                className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg shadow-blue-500/30"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-3 flex items-center justify-between text-[10px] text-gray-400">
        <span>Powered by Gemini</span>
        <span>v0.1.0</span>
      </div>
    </div>
  )
}

export default App
