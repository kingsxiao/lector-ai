import { useState, type ChangeEvent } from 'react'
import {
  searchSentences,
  groupSentences,
  exportSentences,
  importSentences,
  extractExamples,
  type SentenceCard,
} from '../../shared/sentences'
import { isDue, type Grade } from '../../shared/srs'
import { computeReviewStats } from '../../shared/stats'
import type { StringKey } from '../../shared/i18n'
import { useStore } from '../../shared/store'
import { renderMarkdown } from '../markdown'
import { SparklesIcon, DownloadIcon, UploadIcon, XIcon } from '../../shared/icons'
import { ViewShell, Empty, StatsBar, SrsGradeButtons } from '../components/leaf'
import { downloadBlob } from '../lib/downloads'
import { runSentenceAnalysis } from '../lib/sentences'

interface SentencesViewProps {
  sentences: SentenceCard[]
  revealed: Set<string>
  busyExample: string | null
  tr: (key: StringKey) => string
  onToggleReveal: (id: string) => void
  onRemove: (id: string) => void
  onPromote: (id: string) => void
  onGrade: (c: SentenceCard, grade: Grade) => void
  onViewSource: (blockId: string | undefined, url: string) => void
  /** Batch-export the given cards to Anki (caller resolves config + deck). */
  onAnkiExport: (cards: SentenceCard[]) => void
  onMakeCard: (sentence: string, title: string) => void
}

function PasteBox({
  value,
  onChange,
  onGenerate,
  generating,
  tr,
}: {
  value: string
  onChange: (v: string) => void
  onGenerate: () => void
  generating: boolean
  tr: (key: StringKey) => string
}) {
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr('side.sentences.pastePlaceholder')}
        rows={2}
        className="field-sm resize-none"
      />
      <button
        onClick={onGenerate}
        disabled={generating}
        className="btn-primary w-full py-1.5 text-[11px]"
      >
        {generating ? tr('side.sentences.generating') : tr('side.sentences.pasteGenerate')}
      </button>
    </div>
  )
}

function ImportMsg({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <div className={`text-[10px] px-2 py-1 rounded-md ${msg.ok ? 'text-success bg-success-soft/50' : 'text-danger bg-danger-soft/50'}`}>
      {msg.text}
    </div>
  )
}

export function SentencesView(props: SentencesViewProps) {
  const { sentences, revealed, tr } = props
  const [query, setQuery] = useState('')
  const [cefrFilter, setCefrFilter] = useState<string>('')
  const [pasteText, setPasteText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const searched = searchSentences(sentences, query)
  const filtered = cefrFilter ? searched.filter((c) => c.cefr === cefrFilter) : searched
  const groups = groupSentences(filtered)

  const handleGenerate = async () => {
    const text = pasteText.trim()
    if (!text) {
      setImportMsg({ ok: false, text: tr('side.sentences.pasteEmpty') })
      return
    }
    setGenerating(true)
    setImportMsg(null)
    try {
      const settings = useStore.getState().byok
      if (!settings.apiKey) {
        setImportMsg({ ok: false, text: tr('err.addKey') })
        return
      }
      await runSentenceAnalysis(text, '', tr('side.sentences.pasteTitle'))
      setPasteText('')
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setGenerating(false)
    }
  }

  const handleExport = () => {
    downloadBlob('lector-sentences.json', exportSentences(sentences), 'application/json')
  }

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = importSentences(String(reader.result || ''))
      if (!result.ok) {
        setImportMsg({ ok: false, text: tr('side.sentences.importFail').replace('{msg}', result.reason || '') })
        return
      }
      useStore.getState().replaceSentences(result.cards || [])
      setImportMsg({ ok: true, text: tr('side.sentences.importOk').replace('{n}', String(result.cards?.length || 0)) })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <ViewShell title={tr('side.sentences.title')}>
      {sentences.filter((c) => c.srs).length > 0 && (
        <StatsBar stats={computeReviewStats(sentences)} tr={tr} />
      )}
      {sentences.length === 0 ? (
        <>
          <div className="px-4 py-3 border-b border-line">
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
          </div>
          <Empty text={tr('side.sentences.empty')} />
        </>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line space-y-2">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('side.sentences.search')}
                className="field-sm flex-1"
              />
              <select
                value={cefrFilter}
                onChange={(e) => setCefrFilter(e.target.value)}
                className="field-sm w-auto flex-shrink-0"
                aria-label={tr('side.sentences.filterAll')}
              >
                <option value="">{tr('side.sentences.filterAll')}</option>
                {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={handleExport}
                className="btn-outline py-1.5 text-[11px]"
              >
                <DownloadIcon size={12} /> {tr('side.sentences.export')}
              </button>
              <label className="btn-outline py-1.5 text-[11px] cursor-pointer text-center">
                <UploadIcon size={12} /> {tr('side.sentences.import')}
                <input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
              </label>
              <button
                onClick={() => props.onAnkiExport(filtered)}
                className="btn-outline py-1.5 text-[11px]"
              >
                {tr('side.sentences.toAnki')}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...groups.entries()].map(([key, cards]) => {
              const [title] = key.split('\u0000')
              return (
                <div key={key}>
                  <div className="px-4 py-1.5 bg-surface-muted/70 text-[10px] font-semibold text-ink-faint sticky top-0 uppercase tracking-wide backdrop-blur-sm">
                    {title || tr('side.sentences.pasteTitle')}
                  </div>
                  {cards.map((c) => {
                    const due = c.srs ? isDue(c.srs) : false
                    const isRevealed = revealed.has(c.id)
                    return (
                      <div key={c.id} className="group row">
                        <div className="flex items-start gap-2">
                          <span className={`text-[12px] font-semibold leading-relaxed flex-1 ${due ? 'text-accent' : 'text-ink'}`}>
                            {c.sentence}
                          </span>
                          <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1">
                            {c.blockId || c.url ? (
                              <button
                                onClick={() => props.onViewSource(c.blockId, c.url)}
                                title={tr('side.sentences.viewSource')}
                                aria-label={tr('aria.viewSource')}
                                className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                              >
                                <SparklesIcon size={13} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => props.onAnkiExport([c])}
                              title={tr('side.sentences.toAnkiOne')}
                              aria-label={tr('aria.sendToAnki')}
                              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                            >
                              <DownloadIcon size={13} />
                            </button>
                            <button
                              onClick={() => props.onRemove(c.id)}
                              aria-label={tr('side.sentences.remove')}
                              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                            >
                              <XIcon size={15} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {due && (
                            <span className="chip-accent">
                              {tr('side.sentences.due')}
                            </span>
                          )}
                          {c.cefr && (
                            <span className="chip-muted">
                              {c.cefr}
                            </span>
                          )}
                          {c.srs && (
                            <span className="text-[10px] text-ink-faint">
                              {c.srs.reps} {tr('side.sentences.reviews')}
                            </span>
                          )}
                          <button
                            onClick={() => (c.srs ? undefined : props.onPromote(c.id))}
                            className={`text-[10px] ml-auto ${c.srs ? 'text-accent' : 'text-ink-faint hover:text-accent'} transition-colors`}
                          >
                            {c.srs ? tr('side.sentences.inReview') : tr('side.sentences.addToReview')}
                          </button>
                        </div>
                        {(c.translation || c.analysis) && (
                          <button
                            onClick={() => props.onToggleReveal(c.id)}
                            className="text-[10px] text-accent hover:text-accent-hover hover:underline mt-1.5 transition-colors"
                          >
                            {isRevealed ? tr('side.sentences.hideAnalysis') : tr('side.sentences.showAnalysis')}
                          </button>
                        )}
                        {isRevealed && (c.translation || c.analysis) && (
                          <div
                            className="lector-prose mt-2 text-[11px] leading-relaxed bg-surface-muted/40 rounded-lg p-2.5"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.analysis || c.translation) }}
                          />
                        )}
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => {
                              const busy = props.busyExample === ex
                              return (
                                <div key={i} className="flex items-center gap-2 text-[11px] bg-surface-muted/40 rounded-md px-2 py-1">
                                  <span className="text-ink-soft flex-1">{ex}</span>
                                  <button
                                    onClick={() => props.onMakeCard(ex, c.title)}
                                    disabled={busy}
                                    title={tr('side.sentences.makeCard')}
                                    aria-label={tr('aria.makeCard')}
                                    className="text-accent hover:text-accent-hover text-[10px] flex-shrink-0 font-medium flex items-center gap-1 disabled:opacity-60"
                                  >
                                    {busy ? (
                                      <>
                                        <span className="w-2.5 h-2.5 border-[1.5px] border-line border-t-accent rounded-full animate-spin" />
                                        {tr('side.sentences.makingCard')}
                                      </>
                                    ) : (
                                      tr('side.sentences.makeCard')
                                    )}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {due && c.srs && (
                          <SrsGradeButtons
                            grades={['again', 'hard', 'good', 'easy']}
                            tr={tr}
                            onGrade={(g) => props.onGrade(c, g)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </ViewShell>
  )
}
