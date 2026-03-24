import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${token}`,
      }
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    // 获取用户订阅状态
    let isPro = false
    
    // 从 Lemonsqueezy 获取订阅状态
    const lemonsqueezyApiKey = process.env.LEMONSQUEEZY_API_KEY
    if (lemonsqueezyApiKey && data.id) {
      try {
        const subscriptionResponse = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions?filter[user_id]=${data.id}`,
          {
            headers: {
              'Authorization': `Bearer ${lemonsqueezyApiKey}`,
              'Accept': 'application/vnd.api+json',
            }
          }
        )
        
        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json()
          // 检查是否有活跃订阅
          isPro = subscriptionData.data?.some((sub: any) => 
            sub.attributes?.status === 'active' || sub.attributes?.status === 'on_trial'
          ) || false
        }
      } catch (e) {
        console.error('Failed to check subscription:', e)
      }
    }

    return res.status(200).json({
      user: {
        id: data.id,
        email: data.email,
      },
      isPro,
    })

  } catch (error) {
    console.error('Get user error:', error)
    return res.status(500).json({ error: 'Failed to get user' })
  }
}
