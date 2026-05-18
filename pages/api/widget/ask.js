import { getSupabaseAdmin } from '../../../lib/supabase'
import { applyCors, originAllowed } from '../../../lib/cors'
import { embedQuery, EMBED_MODEL } from '../../../lib/embeddings'

export const config = { maxDuration: 30 }

const CONTEXT_CHAR_BUDGET = 60000
const TOP_K = 12
const CHAT_MODEL = 'gemini-2.5-flash'

function buildContext(pages, maxChars) {
  let context = ''
  const used = []
  for (const p of pages) {
    if (context.length >= maxChars) break
    const remaining = maxChars - context.length
    const chunk = `\n\n=== ${p.title}\nURL: ${p.url}\n---\n${p.text}`
    context += chunk.slice(0, remaining)
    used.push(p)
  }
  return { context, used }
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `Status ${res.status}`
    if (res.status === 429 || /quota/i.test(msg)) {
      throw Object.assign(new Error('Rate limit exceeded'), { status: 429 })
    }
    throw new Error(msg)
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.'
}

export default async function handler(req, res) {
  // We need to look up the site to know the allowed_origins, but we want to
  // respond with proper CORS regardless of method (preflight requirement).
  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  body = body || {}

  // For OPTIONS preflight, the body is empty; we read site_key from a query param
  // sent by the widget so we can still echo origin correctly. The widget always
  // sends ?site_key=... on every request to make this work.
  const siteKey = body.site_key || req.query.site_key
  if (!siteKey) return res.status(400).json({ error: 'site_key required' })

  let site
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('webask_sites')
      .select('id, domain, allowed_origins, label, status, embedding_dim')
      .eq('site_key', siteKey)
      .maybeSingle()
    if (error) throw error
    site = data
  } catch (err) {
    return res.status(500).json({ error: 'Server error' })
  }

  if (!site) return res.status(404).json({ error: 'Unknown site_key' })

  applyCors(req, res, site.allowed_origins || [])
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (!originAllowed(req, site.allowed_origins || [])) {
    return res.status(403).json({ error: 'Origin not allowed for this site_key' })
  }

  if (site.status !== 'ready') {
    return res.status(409).json({ error: `Site is ${site.status}; ask the owner to crawl it first.` })
  }

  const { question, history = [] } = body
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question required' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured (no GEMINI_API_KEY)' })

  try {
    const supabase = getSupabaseAdmin()
    const queryVec = await embedQuery(question, apiKey)

    const { data: matches, error: matchErr } = await supabase.rpc('webask_match_pages', {
      query_embedding: queryVec,
      target_site_id: site.id,
      match_count: TOP_K,
    })
    if (matchErr) throw matchErr
    if (!matches || matches.length === 0) {
      return res.status(200).json({
        answer: `I couldn't find any indexed pages from ${site.label || site.domain} to answer that.`,
        sources: [],
      })
    }

    const { context, used } = buildContext(matches, CONTEXT_CHAR_BUDGET)
    const historyText = (Array.isArray(history) ? history : []).slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n')

    const prompt = `You are a helpful AI assistant embedded on the website "${site.domain}". The user is asking a question about that site's content. Below is content retrieved from the most relevant pages.

How to answer:
- Use the retrieved content as your primary source.
- If it fully answers the question, give a clear, concise answer (bullets where helpful).
- If it only partially answers, give what is there and explicitly note which aspects are NOT covered.
- Only say "I couldn't find that on this site" if NONE of the retrieved pages touch the topic.
- Refer to page titles when citing (e.g. "From the *About* page..."). Don't fabricate URLs.
- Match the user's language. If they write in Italian, answer in Italian.
- Keep answers under ~200 words unless the question is genuinely complex.

--- RETRIEVED CONTENT FROM ${site.domain} ---
${context}
--- END OF CONTENT ---

${historyText}

User: ${question}
Assistant:`

    const answer = await callGemini(prompt, apiKey)
    return res.status(200).json({
      answer,
      sources: used.slice(0, 5).map(p => ({ url: p.url, title: p.title || p.url })),
    })
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again in a moment.' })
    }
    console.error('widget/ask error:', err)
    return res.status(500).json({ error: err.message || 'Failed to generate answer' })
  }
}
