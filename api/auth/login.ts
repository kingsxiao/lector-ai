import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

interface LoginRequest {
  email: string
  password: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body as LoginRequest

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({
        email,
        password,
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(401).json({ error: data.message || 'Invalid credentials' })
    }

    return res.status(200).json({
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    })

  } catch (error) {
    console.error('Login error:', error)
    return res.status(500).json({ error: 'Failed to login' })
  }
}
