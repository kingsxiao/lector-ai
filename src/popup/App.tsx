import { useState, useEffect } from 'react'
import { summarizeUrl, translateText as apiTranslateText } from '../shared/api'
import { useStore } from '../shared/store'

const API_BASE = 'https://lector-ai-two.vercel.app/api'
const FREE_LIMIT = 5

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [keyPoints, setKeyPoints] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [apiBase, setApiBase] = useState('https://lector-ai-two.vercel.app/api')
  const [activeTab, setActiveTab] = useState<'summarize' | 'translate'>('summarize')
  const [translateText, setTranslateText] = useState('')
  const [translatedResult, setTranslatedResult] = useState('')
  const [targetLang, setTargetLang] = useState('English')
  
  const { user, accessToken, isPro, usageCount, incrementUsage, setUser, setPro, logout } = useStore()

  useEffect(() => {
    chrome.storage.local.get(['apiBase'], (result) => {
      if (result.apiBase) setApiBase(result.apiBase as string)
    })

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        if (!tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('edge://')) {
          setUrl(tabs[0].url)
        }
      }
    })
  }, [])

  const handleSummarize = async () => {
    if (!url) return
    if (!isPro && usageCount >= FREE_LIMIT) {
      setError('Daily limit reached. Sign in for more free uses, or upgrade to Pro!')
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
    if (!isPro && usageCount >= FREE_LIMIT) {
      setError('Daily limit reached. Sign in for more free uses, or upgrade to Pro!')
      return
    }

    setLoading(true)
    setError('')

    try {
      const currentApiBase = apiBase || 'https://lector-ai-two.vercel.app/api'
      const response = await fetch(`${currentApiBase}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: translateText, targetLang })
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Request failed: ${response.status}`)
      }
      
      const data = await response.json()
      setTranslatedResult(data.translatedText || '')
      incrementUsage()
    } catch (err) {
      console.error('Translate error:', err)
      setError(err instanceof Error ? err.message : 'Failed to translate. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)

    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
    const payload = authMode === 'login' 
      ? { email: authEmail, password: authPassword }
      : { email: authEmail, password: authPassword }

    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (!response.ok) {
        setAuthError(data.error || 'Authentication failed')
        return
      }

      if (authMode === 'login') {
        setUser({ id: data.user.id, email: data.user.email }, data.accessToken)
        if (data.user.id) {
          await checkProStatus(data.accessToken)
        }
      } else {
        setAuthError('Account created! Please log in.')
        setAuthMode('login')
      }
      
      setShowAuth(false)
    } catch {
      setAuthError('Network error. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const checkProStatus = async (token: string) => {
    try {
      const response = await fetch(`${apiBase}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setPro(data.isPro || false)
      }
    } catch (e) {
      console.error('Failed to check pro status:', e)
    }
  }

  const handleUpgrade = async () => {
    if (!accessToken) {
      setShowAuth(true)
      setAuthMode('login')
      return
    }

    try {
      const response = await fetch(`${apiBase}/subscription/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })
      
      const data = await response.json()
      
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank')
      } else {
        setError('Failed to create checkout. Please try again.')
      }
    } catch {
      setError('Failed to open checkout. Please try again.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (activeTab === 'summarize') handleSummarize()
    }
  }

  const languages = ['English', 'Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Portuguese', 'Russian', 'Arabic']

  const getRemainingUses = () => {
    if (isPro) return '∞'
    return FREE_LIMIT - usageCount
  }

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
              <span className="px-3 py-1 text-[10px] font-medium rounded-full bg-gray-100 text-gray-500">{getRemainingUses()}/{FREE_LIMIT} free</span>
            )}
            {user ? (
              <button onClick={() => setShowSettings(true)} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all hover:scale-105">
                ⚙️
              </button>
            ) : (
              <button onClick={() => setShowAuth(true)} className="px-3 py-1.5 text-[10px] font-medium rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-all">
                Sign In
              </button>
            )}
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

        {!isPro && usageCount >= FREE_LIMIT && (
          <div className="mt-4 p-4 bg-gradient-to-r from-purple-100 to-pink-100 rounded-xl border border-purple-200">
            <div className="text-center">
              <p className="text-sm font-bold text-purple-700 mb-1">Daily limit reached</p>
              <p className="text-xs text-purple-500 mb-3">Sign in for 5 more free uses, or upgrade to Pro!</p>
              <button onClick={() => setShowAuth(true)} className="w-full py-2 mb-2 bg-white text-purple-600 rounded-xl text-xs font-semibold hover:bg-purple-50 transition-all border border-purple-200">
                Sign In for Free Uses
              </button>
              <button onClick={handleUpgrade} className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-xs font-semibold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/30">
                Upgrade to Pro - $9/month
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={(e) => {
          if (e.target === e.currentTarget) setShowAuth(false)
        }}>
          <div className="bg-white m-4 p-5 rounded-3xl shadow-2xl w-[320px]">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-gray-800">
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h2>
              <button onClick={() => setShowAuth(false)} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all hover:scale-105">✕</button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition-all"
                />
              </div>

              {authError && (
                <p className="text-xs text-red-500 text-center">{authError}</p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-500/30"
              >
                {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login')
                  setAuthError('')
                }}
                className="text-xs text-blue-500 hover:text-blue-700"
              >
                {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm" onClick={(e) => {
          if (e.target === e.currentTarget) setShowSettings(false)
        }}>
          <div className="bg-white m-4 p-5 rounded-3xl shadow-2xl w-[320px]">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-gray-800">⚙️ Settings</h2>
              <button onClick={() => setShowSettings(false)} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all hover:scale-105">✕</button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-500 mb-1">Account</p>
                <p className="text-sm font-medium text-gray-800 truncate">{user?.email}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Status: {isPro ? <span className="text-purple-500 font-medium">Pro</span> : 'Free'}
                </p>
              </div>

              {!isPro && (
                <button
                  onClick={handleUpgrade}
                  className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/30"
                >
                  Upgrade to Pro
                </button>
              )}

              <button
                onClick={() => {
                  logout()
                  setShowSettings(false)
                }}
                className="w-full py-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-3 flex items-center justify-between text-[10px] text-gray-400">
        <span>Powered by OpenRouter</span>
        <span>v0.1.0</span>
      </div>
    </div>
  )
}

export default App
