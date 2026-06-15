import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { upsertSubscription } from '../_lib/supabase'

const LEMONSQUEEZY_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET

function verifySignature(payload: string, signature: string): boolean {
  if (!LEMONSQUEEZY_WEBHOOK_SECRET) return false

  const hmac = crypto.createHmac('sha256', LEMONSQUEEZY_WEBHOOK_SECRET)
  const digest = hmac.update(payload).digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const signature = req.headers['x-signature'] as string
  const rawBody =
    typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})

  if (!verifySignature(rawBody, signature || '')) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { meta, data } = parsed
  const eventName: string = meta?.event_name || ''

  try {
    // LemonSqueezy attaches the customer email in custom_data when we set it
    // during checkout; otherwise the user id lives in meta.custom_data.
    const userId: string | null =
      data?.attributes?.custom_data?.user_id ||
      meta?.custom_data?.user_id ||
      null
    const lemonsqueezyId: string | null = data?.id ? String(data.id) : null

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated': {
        if (userId) {
          const ok = await upsertSubscription({
            user_id: userId,
            status: data?.attributes?.status || 'active',
            lemonsqueezy_id: lemonsqueezyId,
            variant_id: data?.attributes?.variant_id
              ? String(data.attributes.variant_id)
              : null,
            renews_at: data?.attributes?.renews_at || null,
            ends_at: data?.attributes?.ends_at || null,
          })
          if (!ok) console.error('[webhook] persist failed for', userId)
        }
        break
      }
      case 'subscription_cancelled':
      case 'subscription_expired': {
        if (userId) {
          const ok = await upsertSubscription({
            user_id: userId,
            status: eventName === 'subscription_expired' ? 'expired' : 'cancelled',
            lemonsqueezy_id: lemonsqueezyId,
            variant_id: null,
            renews_at: null,
            ends_at: data?.attributes?.ends_at || null,
          })
          if (!ok) console.error('[webhook] persist failed for', userId)
        }
        break
      }
      default:
        console.log('[webhook] unhandled event:', eventName)
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}
