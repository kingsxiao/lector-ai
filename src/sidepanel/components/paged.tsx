import { useState, useEffect, memo } from 'react'
import type { StringKey } from '../../shared/i18n'

/** "Load more" pagination state shared by the long-list views (highlights,
 *  translation history, vocab, sentences). The limit resets to one page
 *  whenever `resetKey` changes (view switch, search query, CEFR filter). */
export function usePagedList(pageSize: number, resetKey?: unknown) {
  const [limit, setLimit] = useState(pageSize)
  useEffect(() => {
    setLimit(pageSize)
  }, [resetKey, pageSize])
  return { limit, more: () => setLimit((n) => n + pageSize) }
}

/** The shared "Load more ({n} remaining)" footer row. memo'd — a pure
 *  function of its props. */
export const LoadMore = memo(function LoadMore({
  remaining,
  onMore,
  tr,
}: {
  remaining: number
  onMore: () => void
  tr: (key: StringKey) => string
}) {
  return (
    <button
      onClick={onMore}
      className="px-4 py-2.5 text-meta text-accent hover:bg-accent-softer border-t border-line transition-colors text-left w-full"
    >
      {tr('side.loadMore').replace('{n}', String(remaining))}
    </button>
  )
})
