import { useState } from 'react'
import type { VocabEntry } from '../../shared/vocabulary'
import { isDue, type Grade } from '../../shared/srs'
import { computeReviewStats } from '../../shared/stats'
import type { StringKey } from '../../shared/i18n'
import {
  exportVocabToAnki,
  withAnkiDefaults,
  type AnkiExportResult,
  type AnkiConfig,
  DEFAULT_ANKI_CONNECT_URL,
  DEFAULT_DECK_NAME,
  DEFAULT_MODEL_NAME,
} from '../../shared/anki'
import { SparklesIcon, XIcon } from '../../shared/icons'
import { ViewShell, Empty, StatsBar, SrsGradeButtons } from '../components/leaf'
import { formatAnkiResult } from '../lib/ankiFormat'

interface VocabViewProps {
  vocab: VocabEntry[]
  revealedVocab: Set<string>
  ankiConfig?: { url: string; deckName: string; modelName: string; tags: string[] }
  tr: (key: StringKey) => string
  onToggleReveal: (id: string) => void
  onRemoveVocab: (id: string) => void
  onGradeVocab: (v: VocabEntry, grade: Grade) => void
  /** Persist the user-edited Anki config back into settings. */
  onSaveAnkiConfig: (cfg: { url: string; deckName: string; modelName: string; tags: string[] }) => void
  /** Generate a sentence card from this vocab entry's context sentence. */
  onExplainVocab: (v: VocabEntry) => void
}

export function VocabView({
  vocab,
  revealedVocab,
  ankiConfig,
  tr,
  onToggleReveal,
  onRemoveVocab,
  onGradeVocab,
  onSaveAnkiConfig,
  onExplainVocab,
}: VocabViewProps) {
  // Anki export sub-panel state. `showPanel` toggles the form; `sending` and
  // `result` drive the UX during/after the POST.
  const [showPanel, setShowPanel] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<AnkiExportResult | null>(null)
  const defaults = withAnkiDefaults(ankiConfig)
  const [cfgUrl, setCfgUrl] = useState(defaults.url)
  const [cfgDeck, setCfgDeck] = useState(defaults.deckName)
  const [cfgModel, setCfgModel] = useState(defaults.modelName)
  const [cfgTags, setCfgTags] = useState(defaults.tags.join(', '))

  const handleSend = async () => {
    setSending(true)
    setResult(null)
    const tags = cfgTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const cfg: AnkiConfig = {
      url: cfgUrl.trim() || DEFAULT_ANKI_CONNECT_URL,
      deckName: cfgDeck.trim() || DEFAULT_DECK_NAME,
      modelName: cfgModel.trim() || DEFAULT_MODEL_NAME,
      tags: tags.length > 0 ? tags : ['lector'],
    }
    // Persist the (possibly edited) config so it sticks next time.
    onSaveAnkiConfig(cfg)
    try {
      const res = await exportVocabToAnki(vocab, cfg)
      setResult(res)
    } finally {
      setSending(false)
    }
  }

  return (
    <ViewShell title={tr('side.vocab.title')}>
      {vocab.length > 0 && <StatsBar stats={computeReviewStats(vocab)} tr={tr} />}
      {vocab.length === 0 ? (
        <Empty text={tr('side.vocab.empty')} />
      ) : (
        <>
          {/* Anki export action bar */}
          <div className="px-4 py-3 border-b border-line">
            {!showPanel ? (
              <button
                onClick={() => setShowPanel(true)}
                className="btn-add py-2 text-[12px]"
              >
                {tr('side.vocab.sendAnki')}
              </button>
            ) : (
              <div className="space-y-2.5 py-0.5">
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiUrl')}
                  </label>
                  <input
                    value={cfgUrl}
                    onChange={(e) => setCfgUrl(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiDeck')}
                  </label>
                  <input
                    value={cfgDeck}
                    onChange={(e) => setCfgDeck(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiModel')}
                  </label>
                  <input
                    value={cfgModel}
                    onChange={(e) => setCfgModel(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiTags')}
                  </label>
                  <input
                    value={cfgTags}
                    onChange={(e) => setCfgTags(e.target.value)}
                    placeholder="lector"
                    className="field-sm"
                  />
                </div>
                <div className="text-[10px] text-ink-faint pt-0.5">
                  {tr('side.vocab.ankiCount').replace('{n}', String(vocab.length))}
                </div>
                {result && (
                  <div className="text-[10px] text-success leading-relaxed bg-success-soft/50 rounded-md px-2 py-1.5">
                    {formatAnkiResult(tr('side.vocab.ankiResult'), result)}
                    {result.errors.length > 0 && (
                      <div className="text-danger mt-1">
                        {result.errors.slice(0, 3).join(' ')}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="btn-primary flex-1 py-1.5 text-[11px]"
                  >
                    {sending ? tr('side.vocab.ankiSending') : tr('side.vocab.ankiSend')}
                  </button>
                  <button
                    onClick={() => {
                      setShowPanel(false)
                      setResult(null)
                    }}
                    className="btn-outline flex-1 py-1.5 text-[11px]"
                  >
                    {tr('side.vocab.ankiCancel')}
                  </button>
                </div>
                <p className="text-[10px] text-ink-faint leading-relaxed pt-1">
                  {tr('side.vocab.ankiHelp')}
                  <br />
                  {tr('side.vocab.ankiHelpOrigin')}
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {vocab.slice(0, 200).map((v) => {
              const due = isDue(v.srs)
              const revealed = revealedVocab.has(v.id)
              return (
                <div key={v.id} className="group row">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold ${due ? 'text-accent' : 'text-ink'}`}>
                      {v.word}
                    </span>
                    {due && (
                      <span className="chip-accent">
                        {tr('side.vocab.due')}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-faint ml-auto">
                      {v.srs.reps} {tr('side.vocab.reviews')}
                    </span>
                    {v.context?.trim() && (
                      <button
                        onClick={() => onExplainVocab(v)}
                        title={tr('side.sentences.fromVocab')}
                        aria-label={tr('aria.makeCard')}
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                      >
                        <SparklesIcon size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveVocab(v.id)}
                      aria-label={tr('aria.deleteWord')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                  {v.context && (
                    <div className="text-[11px] text-ink-soft mt-1.5 leading-relaxed">{v.context}</div>
                  )}
                  {v.translation && (
                    <button
                      onClick={() => onToggleReveal(v.id)}
                      className="text-[10px] text-accent hover:text-accent-hover hover:underline mt-1.5 transition-colors"
                    >
                      {revealed ? v.translation : tr('side.vocab.showTranslation')}
                    </button>
                  )}
                  {due && (
                    <SrsGradeButtons
                      grades={['again', 'hard', 'good', 'easy']}
                      tr={tr}
                      onGrade={(g) => onGradeVocab(v, g)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </ViewShell>
  )
}
