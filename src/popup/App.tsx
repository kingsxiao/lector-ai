import { useState, useEffect } from 'react'
import { summarizeUrl, translateText } from '../shared/api'
import { useStore } from '../shared/store'
import { getApiBase } from '../shared/config'
import {
  SettingsIcon, FileTextIcon, LanguagesIcon, SparklesIcon, ListIcon, XIcon,
} from '../shared/icons'

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
  const [activeTab, setActiveTab] = useState<'summarize' | 'translate'>('summarize')
  const [translateTextInput, setTranslateTextInput] = useState('')
  const [translatedResult, setTranslatedResult] = useState('')
  const [targetLang, setTargetLang] = useState('English')
  
  const { user, accessToken, isPro, usageCount, incrementUsage, setUser, setPro, logout } = useStore()

  useEffect(() => {
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
    if (!translateTextInput.trim()) return
    if (!isPro && usageCount >= FREE_LIMIT) {
      setError('Daily limit reached. Sign in for more free uses, or upgrade to Pro!')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await translateText(translateTextInput, targetLang)
      setTranslatedResult(result)
      incrementUsage()
    } catch (err) {
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
    const payload = { email: authEmail, password: authPassword }

    try {
      const apiBase = await getApiBase()
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
      const apiBase = await getApiBase()
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
      const apiBase = await getApiBase()
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
    <div className="w-[360px] bg-bg min-h-[400px] overflow-hidden rounded-lg">
      <div className="bg-surface m-2 p-4 rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-accent-on font-bold shadow-sm">L</div>
            <div>
              <h1 className="text-lg font-bold text-ink">Lector AI</h1>
              <p className="text-[10px] text-ink-faint">Smart Reading Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPro ? (
              <span className="px-3 py-1 text-[10px] font-medium rounded-full bg-accent text-accent-on shadow-sm">Pro</span>
            ) : (
              <span className="px-3 py-1 text-[10px] font-medium rounded-full bg-surface-muted text-ink-soft">{getRemainingUses()}/{FREE_LIMIT} free</span>
            )}
            {user ? (
              <button onClick={() => setShowSettings(true)} className="w-9 h-9 rounded-lg bg-surface-muted hover:bg-line flex items-center justify-center text-ink-soft transition-all">
                <SettingsIcon size={16} />
              </button>
            ) : (
              <button onClick={() => setShowAuth(true)} className="px-3 py-1.5 text-[10px] font-medium rounded-full bg-accent text-accent-on hover:bg-accent-hover transition-all">
                Sign In
              </button>
            )}
          </div>
        </div>

        <div className="flex bg-surface-muted p-1 rounded-lg mb-4">
          <button onClick={() => setActiveTab('summarize')} className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'summarize' ? 'bg-surface text-accent shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
            <FileTextIcon size={14} /> Summarize
          </button>
          <button onClick={() => setActiveTab('translate')} className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'translate' ? 'bg-surface text-accent shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
            <LanguagesIcon size={14} /> Translate
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
                className="w-full px-4 py-3.5 pr-10 bg-surface-muted border border-line rounded-lg text-sm focus:outline-none focus:border-accent focus:bg-surface transition-all"
              />
              {url && (
                <button onClick={() => setUrl('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-line flex items-center justify-center text-ink-soft hover:bg-line-strong hover:text-ink transition-colors"><XIcon size={14} /></button>
              )}
            </div>

            <button
              onClick={handleSummarize}
              disabled={loading || !url}
              className="w-full py-3.5 px-4 bg-accent text-accent-on rounded-lg text-sm font-semibold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent-on/40 border-t-accent-on rounded-full animate-spin"></div>
                  Analyzing...
                </>
              ) : (
                <><SparklesIcon size={15} /> Summarize Article</>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={translateTextInput}
              onChange={(e) => setTranslateTextInput(e.target.value)}
              placeholder="Enter text to translate..."
              rows={4}
              className="w-full px-4 py-3 bg-surface-muted border border-line rounded-lg text-sm resize-none focus:outline-none focus:border-accent focus:bg-surface transition-all"
            />
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full px-4 py-3 bg-surface-muted border border-line rounded-lg text-sm focus:outline-none focus:border-accent focus:bg-surface transition-all cursor-pointer"
            >
              {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
            </select>
            <button
              onClick={handleTranslate}
              disabled={loading || !translateTextInput.trim()}
              className="w-full py-3.5 px-4 bg-accent text-accent-on rounded-lg text-sm font-semibold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent-on/40 border-t-accent-on rounded-full animate-spin"></div>
                  Translating...
                </>
              ) : (
                <><LanguagesIcon size={15} /> Translate Text</>
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-danger/10 border border-danger/30 rounded-lg">
            <p className="text-xs text-danger text-center">{error}</p>
          </div>
        )}

        {activeTab === 'summarize' && summary && (
          <div className="mt-4 p-4 bg-surface-muted rounded-lg border border-accent/30">
            <h3 className="text-sm font-bold text-ink mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-accent text-accent-on flex items-center justify-center"><ListIcon size={13} /></span> Summary
            </h3>
            <p className="text-xs text-ink-soft leading-relaxed">{summary}</p>

            {keyPoints.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <h4 className="text-xs font-semibold text-ink-faint mb-2">Key Points:</h4>
                <ul className="space-y-1.5">
                  {keyPoints.map((point, i) => (
                    <li key={i} className="text-xs text-ink-soft flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0"></span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'translate' && translatedResult && (
          <div className="mt-4 p-4 bg-surface-muted rounded-lg border border-accent/30">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-accent text-accent-on flex items-center justify-center"><LanguagesIcon size={13} /></span> Translation
              </h3>
              <button
                onClick={() => navigator.clipboard.writeText(translatedResult)}
                className="text-xs text-accent hover:text-accent-hover font-medium"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-ink-soft leading-relaxed whitespace-pre-wrap">{translatedResult}</p>
          </div>
        )}

        {!isPro && usageCount >= FREE_LIMIT && (
          <div className="mt-4 p-4 bg-accent-soft rounded-lg border border-accent/40">
            <div className="text-center">
              <p className="text-sm font-bold text-accent mb-1">Daily limit reached</p>
              <p className="text-xs text-ink-soft mb-3">Sign in for 5 more free uses, or upgrade to Pro!</p>
              <button onClick={() => setShowAuth(true)} className="w-full py-2 mb-2 bg-surface text-accent rounded-lg text-xs font-semibold hover:bg-surface-muted transition-all border border-accent/40">
                Sign In for Free Uses
              </button>
              <button onClick={handleUpgrade} className="w-full py-2.5 bg-accent text-accent-on rounded-lg text-xs font-semibold hover:bg-accent-hover transition-all shadow-sm">
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
          <div className="bg-surface m-4 p-5 rounded-lg shadow-lg w-[320px]">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-ink">
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h2>
              <button onClick={() => setShowAuth(false)} className="w-9 h-9 rounded-lg bg-surface-muted hover:bg-line flex items-center justify-center text-ink-soft transition-all"><XIcon size={16} /></button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-2">Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-3 bg-surface-muted border border-line rounded-lg text-sm focus:outline-none focus:border-accent focus:bg-surface transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-2">Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-surface-muted border border-line rounded-lg text-sm focus:outline-none focus:border-accent focus:bg-surface transition-all"
                />
              </div>

              {authError && (
                <p className="text-xs text-danger text-center">{authError}</p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3.5 bg-accent text-accent-on rounded-lg text-sm font-semibold hover:bg-accent-hover disabled:opacity-50 transition-all shadow-sm"
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
                className="text-xs text-accent hover:text-accent-hover"
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
          <div className="bg-surface m-4 p-5 rounded-lg shadow-lg w-[320px]">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2"><SettingsIcon size={18} /> Settings</h2>
              <button onClick={() => setShowSettings(false)} className="w-9 h-9 rounded-lg bg-surface-muted hover:bg-line flex items-center justify-center text-ink-soft transition-all"><XIcon size={16} /></button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-surface-muted rounded-lg">
                <p className="text-xs text-ink-faint mb-1">Account</p>
                <p className="text-sm font-medium text-ink truncate">{user?.email}</p>
                <p className="text-xs text-ink-faint mt-1">
                  Status: {isPro ? <span className="text-accent font-medium">Pro</span> : 'Free'}
                </p>
              </div>

              {!isPro && (
                <button
                  onClick={handleUpgrade}
                  className="w-full py-3 bg-accent text-accent-on rounded-lg text-sm font-semibold hover:bg-accent-hover transition-all shadow-sm"
                >
                  Upgrade to Pro
                </button>
              )}

              <button
                onClick={() => {
                  logout()
                  setShowSettings(false)
                }}
                className="w-full py-3 bg-danger/10 text-danger rounded-lg text-sm font-medium hover:bg-danger/20 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-3 flex items-center justify-between text-[10px] text-ink-faint">
        <span>Powered by OpenRouter</span>
        <span>v0.3.0</span>
      </div>
    </div>
  )
}

export default App
