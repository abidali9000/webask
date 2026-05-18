import { getSupabaseAdmin } from '../../../lib/supabase'
import { applyCors } from '../../../lib/cors'

// GET /api/widget/config?site_key=sk_...
// Returns minimal site info the widget needs to decide whether to render and
// what label to show. Origin must be one of the site's registered origins.
export default async function handler(req, res) {
  const siteKey = req.query.site_key
  if (!siteKey) return res.status(400).json({ error: 'site_key required' })

  let site
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('webask_sites')
      .select('id, domain, allowed_origins, label, status, page_count')
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // We still return config if origin doesn't match, but we don't echo Allow-Origin,
  // so the browser will block. That's enough — the script itself is public.
  res.status(200).json({
    label: site.label || site.domain,
    domain: site.domain,
    status: site.status,
    page_count: site.page_count,
  })
}
