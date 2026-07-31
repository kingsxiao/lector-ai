/**
 * Serialized read-modify-write helpers for chrome.storage.local list keys.
 *
 * Problem being solved: the background service worker relays captured items
 * (highlights / vocab / sentences / translation history) into storage by
 * reading the current list, mutating it, and writing it back. When two relay
 * messages arrive close together, both `get`s observe the same base list and
 * both `set`s write — last write wins and one item is silently lost. This
 * already happened for translation history (which had a hand-rolled chain);
 * the same shape existed, unserialized, for the other three keys.
 *
 * This module factors out the serialization pattern into a reusable, pure
 * (no chrome import) helper so the read-modify-write can be unit-tested with
 * a fake storage adapter.
 *
 * It does NOT import `chrome` or any DOM API — the storage adapter is passed
 * in — so it stays within the "pure logic / unit-testable" boundary.
 */

/** Minimal async get/set interface mirroring the slice of chrome.storage we use. */
export interface ListStore {
  get<T>(key: string): Promise<T[]>
  set(key: string, value: unknown[]): Promise<void>
}

/**
 * Mutate the list in place (or return a new array); the result is what gets
 * written back. Returning the (possibly new) array is supported for callers
 * that prefer immutability.
 */
export type ListMutator<T> = (list: T[]) => T[] | void

/**
 * Compare a relay queue with the exact snapshot a consumer just processed.
 *
 * Length-only checks are unsafe: a producer can replace/append items between
 * the consumer's first read and its clear attempt while leaving the list at
 * the same length. Clearing in that case silently drops the new data. Chrome
 * storage returns JSON-compatible values, so a structural comparison is both
 * deterministic and cheap for these bounded queues.
 */
export function isSameQueueSnapshot(current: unknown, observed: unknown[]): boolean {
  if (!Array.isArray(current) || current.length !== observed.length) return false
  try {
    return JSON.stringify(current) === JSON.stringify(observed)
  } catch {
    return false
  }
}

/**
 * Append one serialized RMW step to a chain. Returns the new chain so the
 * caller can reassign its module-level handle. Steps never reject the chain
 * (errors are swallowed and logged via `onError`) so one failing write can't
 * poison every subsequent write — matching the existing best-effort relay UX.
 *
 * Example:
 *   let vocabChain = Promise.resolve()
 *   vocabChain = appendToList(vocabChain, store, 'lectorVocab', (list) => {
 *     list.unshift(entry)
 *   })
 */
export function appendToList<T>(
  chain: Promise<void>,
  store: ListStore,
  key: string,
  mutate: ListMutator<T>,
  onError?: (e: unknown) => void
): Promise<void> {
  return chain
    .then(
      () =>
        new Promise<void>((resolve) => {
          store
            .get<T>(key)
            .then((list) => {
              const result = mutate(list)
              return store.set(key, result ?? list)
            })
            .then(() => resolve(), (e) => {
              onError?.(e)
              resolve()
            })
        })
    )
    .then(undefined, (e) => {
      // Defensive: the .then above always resolves, but keep the chain alive
      // if a user-supplied mutator threw synchronously.
      onError?.(e)
    })
}
