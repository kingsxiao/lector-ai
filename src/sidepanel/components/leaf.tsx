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
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-2xl bg-surface border border-line shadow-sm flex items-center justify-center mb-3.5">
        <span className="block w-2 h-2 rounded-full bg-line-strong" />
      </div>
      <p className="text-[12px] text-ink-faint leading-relaxed max-w-[210px]">{text}</p>
    </div>
  )
}

/** Again/Hard/Good/Easy grade grid shared by Vocab + Sentences review.
 *  Semantic tint per grade: again=危险红调 / easy=成功绿调，软底填充。 */
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
            'py-[7px] text-[10px] font-semibold rounded-md border transition-all duration-150 ease-out active:translate-y-px ' +
            (g === 'again'
              ? 'border-danger/25 bg-danger-soft/60 text-danger hover:bg-danger-soft hover:border-danger/45'
              : g === 'easy'
                ? 'border-success/25 bg-success-soft/60 text-success hover:bg-success-soft hover:border-success/45'
                : g === 'hard'
                  ? 'border-line bg-surface-muted/60 text-ink-soft hover:bg-surface-muted hover:text-ink'
                  : 'border-accent/25 bg-accent-softer text-accent hover:bg-accent-soft hover:border-accent/45')
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
    <div className="flex justify-around px-4 py-3.5 border-b border-line bg-surface">
      <StatsCell label={tr('stats.due')} value={stats.due} />
      <span className="w-px my-1 bg-line/70" />
      <StatsCell label={tr('stats.mastered')} value={stats.mastered} />
      <span className="w-px my-1 bg-line/70" />
      <StatsCell label={tr('stats.reviews')} value={stats.totalReviews} />
      <span className="w-px my-1 bg-line/70" />
      <StatsCell label={tr('stats.retention')} value={stats.avgEase.toFixed(1)} />
    </div>
  )
}
