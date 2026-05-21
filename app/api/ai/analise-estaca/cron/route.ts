import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const header = req.headers.get('authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const qs = new URL(req.url).searchParams.get('secret') || ''
  return bearer === secret || qs === secret
}

async function runAnalysis(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/ai/analise-estaca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger_type: 'cron', save: true }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

    const result = await runAnalysis(baseUrl)
    return NextResponse.json({ ok: true, week_start: result.week_start })
  } catch (error: any) {
    console.error('Erro cron análise estaca:', error)
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 })
  }
}
