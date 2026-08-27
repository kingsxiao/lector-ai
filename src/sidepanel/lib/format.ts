// Compact, locale-aware timestamps for list rows (Library / translation
// history). `toLocaleString()` renders verbose strings like
// "7/22/2026, 1:44:29 PM" that dominate a 300px row; these variants keep the
// same information in a fraction of the width.

/** "9:32 AM" / "09:32" — for things that happened today. */
export function formatTime(ts: number, locale = navigator.language): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ts)
}

/**
 * "9:32 AM" today → "Aug 26, 9:32 AM" this year → "Aug 26, 2025" older.
 * Year is dropped when it's the current one — inside a library list the
 * recency is implied and the full year is noise.
 */
export function formatListTimestamp(ts: number, locale = navigator.language): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return formatTime(ts, locale)
  const md = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)
  if (d.getFullYear() !== now.getFullYear()) return `${md}, ${d.getFullYear()}`
  return `${md}, ${formatTime(ts, locale)}`
}
