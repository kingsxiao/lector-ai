import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromToken, isProUser, getUserEmail } from '../_lib/supabase'

/**
 * GET /api/auth/me
 * Authorization: Bearer <supabase access token>
 *
 * Returns the user and their Pro status. Pro status is read from our
 * `subscriptions` table (written by the LemonSqueezy webhook). When the DB
 * isn't configured, isPro is always false.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]
  const userId = await getUserIdFromToken(token)

  if (!userId) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const email = await getUserEmail(userId).catch(() => null)
  const isPro = await isProUser(userId).catch(() => false)

  return res.status(200).json({
    user: { id: userId, email },
    isPro,
  })
}
