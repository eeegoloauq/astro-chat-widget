/** Mock feedback sink for the demo playground. */
import type { APIRoute } from 'astro'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json().catch(() => null)
  console.log('[demo] feedback:', payload?.rating, payload?.messageId)
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
