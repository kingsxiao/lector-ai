import type { ReactNode } from 'react'
import type { Grade } from '../../shared/srs'
import type { ReviewStats } from '../../shared/stats'
import type { StringKey } from '../../shared/i18n'
import { StatsCell } from './Primitives'

/** Shared view wrapper: drawer-head title + flex column body. */
export function ViewShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{title}</h3>
      </div>
      {children}
    </div>
  )
}

/** Centered empty-state placeholder. */
export function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center mb-3">
        <span className="block w-1.5 h-1.5 rounded-full bg-line-strong" />
      </div>
      <p className="text-[12px] text-ink-faint leading-relaxed max-w-[200px]">{text}</p>
    </div>
  )
}

/** Again/Hard/Good/Easy grade grid shared by Vocab + Sentences review. */
export function SrsGradeButtons({
  grades,
  tr,
  onGrade,
}: {
  grades: Grade[]
  tr: (key: StringKey) => string
  onGrade: (g: Grade) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2.5">
      {grades.map((g) => (
        <button
          key={g}
          onClick={() => onGrade(g)}
          className={
            'py-1.5 text-[10px] font-semibold rounded-md border transition-colors duration-150 ease-out ' +
            (g === 'again'
              ? 'border-line text-danger hover:bg-danger-soft/50 hover:border-danger/40'
              : g === 'easy'
                ? 'border-line text-success hover:bg-success-soft/50 hover:border-success/40'
                : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink')
          }
        >
          {tr(`side.vocab.${g}` as StringKey)}
        </button>
      ))}
    </div>
  )
}

/** Compact 4-metric stats bar shown at the top of SentencesView and VocabView.
 *  Renders aggregated review stats (due / mastered / reviews / retention). */
export function StatsBar({ stats, tr }: { stats: ReviewStats; tr: (key: StringKey) => string }) {
  return (
    <div className="flex justify-around px-4 py-3 border-b border-line bg-surface-muted/40">
      <StatsCell label={tr('stats.due')} value={stats.due} />
      <span className="w-px bg-line" />
      <StatsCell label={tr('stats.mastered')} value={stats.mastered} />
      <span className="w-px bg-line" />
      <StatsCell label={tr('stats.reviews')} value={stats.totalReviews} />
      <span className="w-px bg-line" />
      <StatsCell label={tr('stats.retention')} value={stats.avgEase.toFixed(1)} />
    </div>
  )
}
