/**
 * A single stat cell for StatsBar. Hoisted to module scope (formerly an inner
 * component defined inside StatsBar's render) so it keeps a stable identity and
 * doesn't unmount/remount on every StatsBar re-render.
 */
export function StatsCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[16px] font-bold text-accent leading-none font-serif">{value}</span>
      <span className="text-[9px] text-ink-faint mt-1 uppercase tracking-wide">{label}</span>
    </div>
  )
}
