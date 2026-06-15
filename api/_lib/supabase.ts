// Supabase access via the REST API (PostgREST + GoTrue).
//
// We intentionally do NOT depend on @supabase/supabase-js — the SDK adds a
// large bundle and we only need a handful of REST calls, which keeps the
// serverless function cold-start fast. This mirrors the original code's
// approach (raw fetch to the Supabase auth endpoints).

const SUPABASE_URL = process.env.SUPABASE_URL
// Service role key bypasses RLS and is required for server-side reads/writes.
// Falls back to the anon key so the extension still runs before the DB tier
// is wired up (graceful degradation).
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY!,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra,
  }
}

/**
 * Verify a user access token and return the user id, or null on failure.
 */
export async function getUserIdFromToken(accessToken: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY!,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.id || null
  } catch {
    return null
  }
}

/**
 * Look up the user's email by id (best-effort). Returns null if unavailable.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  try {
    // The auth.users table isn't exposed via PostgREST by default; we attempt
    // it and gracefully fall back. Callers handle null.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/auth.users?id=eq.${encodeURIComponent(userId)}&select=email`, {
      headers: authHeaders(),
    })
    if (!res.ok) return null
    const rows = (await res.json()) as Array<{ email: string }>
    return rows?.[0]?.email || null
  } catch {
    return null
  }
}

// --- subscriptions table -----------------------------------------------------

export interface SubscriptionRow {
  user_id: string
  status: string
  lemonsqueezy_id: string | null
  variant_id: string | null
  renews_at: string | null
  ends_at: string | null
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  if (!isSupabaseConfigured()) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: authHeaders() }
    )
    if (!res.ok) return null
    const rows = (await res.json()) as SubscriptionRow[]
    return rows?.[0] || null
  } catch {
    return null
  }
}

export async function isProUser(userId: string): Promise<boolean> {
  const sub = await getSubscription(userId)
  return sub?.status === 'active' || sub?.status === 'on_trial'
}

export async function upsertSubscription(row: SubscriptionRow): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  try {
    // PostgREST upsert via Prefer header.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    })
    return res.ok
  } catch {
    return false
  }
}

// --- usage tables -----------------------------------------------------------

interface UsageCountRow {
  count: number
}

async function readUsageCount(
  table: string,
  keyCol: string,
  keyVal: string,
  day: string
): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${keyCol}=eq.${encodeURIComponent(keyVal)}&day=eq.${encodeURIComponent(day)}&select=count&limit=1`,
      { headers: authHeaders() }
    )
    if (!res.ok) return 0
    const rows = (await res.json()) as UsageCountRow[]
    return rows?.[0]?.count || 0
  } catch {
    return 0
  }
}

async function writeUsageCount(
  table: string,
  keyCol: string,
  keyVal: string,
  day: string,
  next: number,
  exists: boolean
): Promise<boolean> {
  try {
    if (exists) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?${keyCol}=eq.${encodeURIComponent(keyVal)}&day=eq.${encodeURIComponent(day)}`,
        {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({ count: next }),
        }
      )
      return res.ok
    }
    const body: Record<string, unknown> = { day, count: next }
    body[keyCol] = keyVal
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Increment the daily counter for an authenticated user. Returns the new total. */
export async function bumpUserUsage(userId: string, day: string, cost: number): Promise<number | null> {
  if (!isSupabaseConfigured()) return null
  const current = await readUsageCount('usage_daily', 'user_id', userId, day)
  const next = current + cost
  const existed = current > 0
  const ok = await writeUsageCount('usage_daily', 'user_id', userId, day, next, existed)
  return ok ? next : null
}

export async function readUserUsage(userId: string, day: string): Promise<number> {
  return readUsageCount('usage_daily', 'user_id', userId, day)
}

/** Increment the daily counter for an anonymous (IP-keyed) user. */
export async function bumpAnonUsage(anonId: string, day: string, cost: number): Promise<number | null> {
  if (!isSupabaseConfigured()) return null
  const current = await readUsageCount('anon_usage', 'anon_id', anonId, day)
  const next = current + cost
  const existed = current > 0
  const ok = await writeUsageCount('anon_usage', 'anon_id', anonId, day, next, existed)
  return ok ? next : null
}

export async function readAnonUsage(anonId: string, day: string): Promise<number> {
  return readUsageCount('anon_usage', 'anon_id', anonId, day)
}

export const SUPABASE_URL_EXPORTED = SUPABASE_URL
export const SUPABASE_SERVICE_KEY_EXPORTED = SUPABASE_SERVICE_KEY
