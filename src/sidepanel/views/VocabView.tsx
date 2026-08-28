import { useState, useCallback, useEffect, useMemo, memo } from 'react'
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
import { SparklesIcon, XIcon, CardsIcon, DownloadIcon } from '../../shared/icons'
import { ViewShell, Empty, StatsBar, SrsGradeButtons } from '../components/leaf'
import { formatAnkiResult } from '../lib/ankiFormat'
import { downloadBlob } from '../lib/downloads'
import { toAnkiTsv } from '../../shared/exporters'

interface VocabViewProps {
  vocab: VocabEntry[]
  ankiConfig?: { url: string; deckName: string; modelName: string; tags: string[] }
  tr: (key: StringKey) => string
  onRemoveVocab: (id: string) => void
  onGradeVocab: (v: VocabEntry, grade: Grade) => void
  /** Persist the user-edited Anki config back into settings. */
  onSaveAnkiConfig: (cfg: { url: string; deckName: string; modelName: string; tags: string[] }) => void
  /** Generate a sentence card from this vocab entry's context sentence. */
  onExplainVocab: (v: VocabEntry) => void
}

/** One vocab row, memoized: reveal toggles and unrelated re-renders only touch
 *  the rows whose inputs actually changed (reveal is a boolean prop, not a
 *  parent-held Set re-created per toggle). */
const VocabRow = memo(function VocabRow({
  v,
  revealed,
  tr,
  onRemoveVocab,
  onGrade,
  onExplainVocab,
  onToggleReveal,
}: {
  v: VocabEntry
  revealed: boolean
  tr: (key: StringKey) => string
  onRemoveVocab: (id: string) => void
  onGrade: (v: VocabEntry, g: Grade) => void
  onExplainVocab: (v: VocabEntry) => void
  onToggleReveal: (id: string) => void
}) {
  const due = isDue(v.srs)
  return (
    <div className="group row">
      <div className="flex items-center gap-2">
        <span className={`text-[15px] leading-snug font-serif font-bold ${due ? 'text-accent' : 'text-ink'}`}>
          {v.word}
        </span>
        {due && (
          <span className="chip-accent">
            {tr('side.vocab.due')}
          </span>
        )}
        <span className="text-[10px] text-ink-faint ml-auto">
          {v.srs.reps} {tr(v.srs.reps === 1 ? 'srs.review' : 'srs.reviews')}
        </span>
        {v.context?.trim() && (
          <button
            onClick={() => onExplainVocab(v)}
            title={tr('side.sentences.fromVocab')}
            aria-label={tr('aria.makeCard')}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
          >
            <SparklesIcon size={14} />
          </button>
        )}
        <button
          onClick={() => onRemoveVocab(v.id)}
          aria-label={tr('aria.deleteWord')}
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
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
          onGrade={(g) => onGrade(v, g)}
        />
      )}
    </div>
  )
})

function VocabViewImpl({
  vocab,
  ankiConfig,
  tr,
  onRemoveVocab,
  onGradeVocab,
  onSaveAnkiConfig,
  onExplainVocab,
}: VocabViewProps) {
  // Reveal-set is single-consumer (this view only) so it lives here, not in App.
  const [revealedVocab, setRevealedVocab] = useState<Set<string>>(new Set())
  // List pagination: the store caps vocab at 2000 entries; mounting all rows
  // would freeze the panel, but a hard 200 cap hides due cards with no way to
  // reach them — same Load-more pattern as the Highlights/Sentences lists.
  const [vocabLimit, setVocabLimit] = useState(200)
  const toggleReveal = useCallback((id: string) => {
    setRevealedVocab((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Clear the reveal when a card is graded (it leaves the due queue).
  const gradeAndClear = useCallback((v: VocabEntry, g: Grade) => {
    onGradeVocab(v, g)
    setRevealedVocab((cur) => {
      if (!cur.has(v.id)) return cur
      const next = new Set(cur)
      next.delete(v.id)
      return next
    })
  }, [onGradeVocab])
  // Review stats: O(vocab) — memoized so it runs on list changes, not on
  // every reveal toggle / form keystroke.
  const stats = useMemo(() => computeReviewStats(vocab), [vocab])
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
  // Keep the form in sync with settings changes made outside this view
  // (useState only snapshots the first render's props).
  useEffect(() => {
    setCfgUrl(defaults.url)
    setCfgDeck(defaults.deckName)
    setCfgModel(defaults.modelName)
    setCfgTags(defaults.tags.join(', '))
    // defaults is derived from ankiConfig; re-run when the config object changes.
  }, [ankiConfig]) // eslint-disable-line react-hooks/exhaustive-deps

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
      {vocab.length > 0 && <StatsBar stats={stats} tr={tr} />}
      {vocab.length === 0 ? (
        <Empty text={tr('side.vocab.empty')} />
      ) : (
        <>
          {/* Anki export action bar */}
          <div className="px-4 py-3 border-b border-line">
            {!showPanel ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPanel(true)}
                  className="btn-add py-2 text-[12px] flex-1"
                >
                  <CardsIcon size={13} />
                  {tr('side.vocab.sendAnki')}
                </button>
                <button
                  onClick={() =>
                    downloadBlob('lector-vocab.txt', toAnkiTsv(vocab), 'text/tab-separated-values')
                  }
                  aria-label={tr('side.vocab.exportTsv')}
                  title={tr('side.vocab.exportTsv')}
                  className="btn-add py-2 text-[12px]"
                >
                  <DownloadIcon size={13} />
                  {tr('side.vocab.exportTsv')}
                </button>
              </div>
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
            {vocab.slice(0, vocabLimit).map((v) => (
              <VocabRow
                key={v.id}
                v={v}
                revealed={revealedVocab.has(v.id)}
                tr={tr}
                onRemoveVocab={onRemoveVocab}
                onGrade={gradeAndClear}
                onExplainVocab={onExplainVocab}
                onToggleReveal={toggleReveal}
              />
            ))}
            {vocab.length > vocabLimit && (
              <button
                onClick={() => setVocabLimit((n) => n + 200)}
                className="px-4 py-2.5 text-meta text-accent hover:bg-accent-softer border-t border-line transition-colors text-left w-full"
              >
                {tr('side.loadMore').replace('{n}', String(vocab.length - vocabLimit))}
              </button>
            )}
          </div>
        </>
      )}
    </ViewShell>
  )
}

// memo'd so unrelated App re-renders don't re-render this view when props are unchanged.
export const VocabView = memo(VocabViewImpl)
