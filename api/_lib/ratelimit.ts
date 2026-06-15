import {
  isSupabaseConfigured,
  getUserIdFromToken,
  isProUser,
  bumpUserUsage,
  readUserUsage,
  bumpAnonUsage,
  readAnonUsage,
} from './supabase'

/**
 * Free-tier daily quota. Anonymous users get a smaller window to discourage
 * abuse. Server-side quotas are the source of truth — the client counter in
 * zustand is only a UI hint.
 */
export const FREE_DAILY_LIMIT = 20
export const ANON_DAILY_LIMIT = 5

interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  /** When false, the limiter is disabled (DB not configured) — callers may
   * still apply a local best-effort fallback. */
  enforced: boolean
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function getIp(headers: Headers): string {
  const h = (k: string) => headers.get(k) || ''
  return (
    h('cf-connecting-ip') ||
    h('x-real-ip') ||
    h('x-forwarded-for').split(',')[0].trim() ||
    'unknown'
  )
}

/**
 * Enforce the daily quota. Increments the counter atomically when allowed.
 *
 * When Supabase is not configured, the limiter returns allowed/enforced=false
 * so local dev still works.
 */
export async function checkRateLimit(
  headers: Headers,
  accessToken: string | null,
  cost = 1
): Promise<RateLimitResult> {
  if (!isSupabaseConfigured()) {
    return { allowed: true, remaining: Infinity, limit: Infinity, enforced: false }
  }

  const day = todayKey()

  // Authenticated path — per-user quota, Pro users bypass.
  if (accessToken) {
    const userId = await getUserIdFromToken(accessToken)
    if (userId) {
      const pro = await isProUser(userId)
      if (pro) {
        return { allowed: true, remaining: Infinity, limit: Infinity, enforced: true }
      }
      const current = await readUserUsage(userId, day)
      if (current + cost > FREE_DAILY_LIMIT) {
        return { allowed: false, remaining: 0, limit: FREE_DAILY_LIMIT, enforced: true }
      }
      const next = await bumpUserUsage(userId, day, cost)
      if (next === null) {
        // write failed — fail open (don't block the user on a DB hiccup)
        return { allowed: true, remaining: FREE_DAILY_LIMIT - current, limit: FREE_DAILY_LIMIT, enforced: true }
      }
      return { allowed: true, remaining: Math.max(0, FREE_DAILY_LIMIT - next), limit: FREE_DAILY_LIMIT, enforced: true }
    }
  }

  // Anonymous path — per-IP quota.
  const ip = getIp(headers)
  const current = await readAnonUsage(ip, day)
  if (current + cost > ANON_DAILY_LIMIT) {
    return { allowed: false, remaining: 0, limit: ANON_DAILY_LIMIT, enforced: true }
  }
  const next = await bumpAnonUsage(ip, day, cost)
  if (next === null) {
    return { allowed: true, remaining: ANON_DAILY_LIMIT - current, limit: ANON_DAILY_LIMIT, enforced: true }
  }
  return { allowed: true, remaining: Math.max(0, ANON_DAILY_LIMIT - next), limit: ANON_DAILY_LIMIT, enforced: true }
}
