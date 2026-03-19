import { useState } from 'react'
import { summarizeUrl } from '../shared/api'
import { useStore } from '../shared/store'

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const { usageCount, isPro, incrementUsage } = useStore()

  const handleSummarize = async () => {
    if (!url) return
    if (!isPro && usageCount >= 3) {
      setError('Daily limit reached. Upgrade to Pro for unlimited access.')
      return
    }

    setLoading(true)
    setError('')
    setSummary('')

    try {
      const result = await summarizeUrl(url)
      setSummary(result.summary)
      incrementUsage()
    } catch (err) {
      setError('Failed to summarize. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-[400px] p-4 bg-white min-h-[300px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">🦞 Lector AI</h1>
        <span className={`px-2 py-1 text-xs rounded-full ${isPro ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
          {isPro ? 'Pro' : `${3 - usageCount}/3 free`}
        </span>
      </div>

      {/* URL Input */}
      <div className="mb-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste article URL here..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      {/* Summarize Button */}
      <button
        onClick={handleSummarize}
        disabled={loading || !url}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
      >
        {loading ? '⏳ Summarizing...' : '✨ Summarize'}
      </button>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary Result */}
      {summary && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      {/* Upgrade Prompt */}
      {!isPro && usageCount >= 3 && (
        <div className="mt-4 p-4 bg-purple-50 rounded-lg text-center">
          <p className="text-sm text-purple-700 mb-2">You've reached your daily limit</p>
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
            Upgrade to Pro - $9/month
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between text-xs text-gray-500">
        <span>Powered by GPT-4o</span>
        <a href="#" className="hover:text-blue-600">Settings</a>
      </div>
    </div>
  )
}

export default App
