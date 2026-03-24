import type { VercelRequest, VercelResponse } from '@vercel/node'

const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY
const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID
const LEMONSQUEEZY_VARIANT_ID = process.env.LEMONSQUEEZY_VARIANT_ID
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lector-ai.vercel.app'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  if (!LEMONSQUEEZY_API_KEY || !LEMONSQUEEZY_STORE_ID || !LEMONSQUEEZY_VARIANT_ID) {
    return res.status(500).json({ error: 'Payment not configured' })
  }

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LEMONSQUEEZY_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: null, // LemonSqueezy 会要求用户输入邮箱
            },
            product_options: {
              redirect_url: `${APP_URL}/subscription/success`,
            },
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: LEMONSQUEEZY_STORE_ID,
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: LEMONSQUEEZY_VARIANT_ID,
              }
            }
          }
        }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('LemonSqueezy error:', data)
      return res.status(400).json({ error: 'Failed to create checkout' })
    }

    return res.status(200).json({
      checkoutUrl: data.data.attributes.url,
    })

  } catch (error) {
    console.error('Create subscription error:', error)
    return res.status(500).json({ error: 'Failed to create subscription' })
  }
}
