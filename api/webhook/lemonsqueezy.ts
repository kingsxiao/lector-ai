import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'

const LEMONSQUEEZY_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET

function verifySignature(payload: string, signature: string): boolean {
  if (!LEMONSQUEEZY_WEBHOOK_SECRET) return false

  const hmac = crypto.createHmac('sha256', LEMONSQUEEZY_WEBHOOK_SECRET)
  const digest = hmac.update(payload).digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'hex'),
      Buffer.from(signature, 'hex')
    )
  } catch {
    return false
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const signature = req.headers['x-signature'] as string
  const payload = JSON.stringify(req.body)

  if (!verifySignature(payload, signature || '')) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const { meta } = req.body

  try {
    switch (meta?.event_name) {
      case 'subscription_created':
        console.log('Subscription created:', req.body)
        // 可以在这里更新数据库，标记用户为 Pro
        break
        
      case 'subscription_updated':
        console.log('Subscription updated:', req.body)
        break
        
      case 'subscription_cancelled':
        console.log('Subscription cancelled:', req.body)
        // 可以在这里更新数据库，移除用户的 Pro 状态
        break
        
      case 'subscription_expired':
        console.log('Subscription expired:', req.body)
        break
        
      default:
        console.log('Unhandled event:', meta?.event_name)
    }

    return res.status(200).json({ received: true })

  } catch (error) {
    console.error('Webhook error:', error)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}
