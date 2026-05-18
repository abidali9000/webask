// Crawl a registered site, embed each page, and upsert into Supabase.
// Usage: npm run crawl -- <site_key> [--max 100]

import { config as loadDotenv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { crawlPages } from '../lib/crawl.js'
import { embedDocuments, EMBED_MODEL, EMBED_DIM } from '../lib/embeddings.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '..', '.env.local') })
loadDotenv({ path: resolve(__dirname, '..', '.env') })

const EMBED_BATCH_SIZE = 20
const EMBED_INPUT_CAP = 7000

function parseArgs(argv) {
  const args = { maxPages: 100 }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--max') args.maxPages = parseInt(argv[++i], 10)
    else if (!a.startsWith('--')) positional.push(a)
  }
  args.siteKey = positional[0]
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.siteKey) {
    console.error('Usage: npm run crawl -- <site_key> [--max 100]')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }
  if (!geminiKey) { console.error('Missing GEMINI_API_KEY in .env.local'); process.exit(1) }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: site, error: siteErr } = await supabase
    .from('webask_sites')
    .select('*')
    .eq('site_key', args.siteKey)
    .single()
  if (siteErr || !site) {
    console.error(`Site not found for site_key=${args.siteKey}`)
    process.exit(1)
  }

  console.log(`→ Crawling ${site.domain} (target ${args.maxPages} pages)`)
  await supabase.from('webask_sites').update({
    status: 'crawling',
    updated_at: new Date().toISOString(),
  }).eq('id', site.id)

  let lastLogged = 0
  const { pages, host } = await crawlPages(`https://${site.domain}/`, {
    maxPages: args.maxPages,
    onProgress: ({ done, total, kept, skipped }) => {
      if (done % 25 === 0 || done === total) {
        console.log(`  [${done}/${total}] kept ${kept}, skipped ${skipped}`)
        lastLogged = done
      }
    },
  })

  if (pages.length === 0) {
    console.error('No pages crawled — aborting.')
    await supabase.from('webask_sites').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', site.id)
    process.exit(1)
  }

  console.log(`\nEmbedding ${pages.length} pages with ${EMBED_MODEL} (${EMBED_DIM}-d)…`)
  for (let i = 0; i < pages.length; i += EMBED_BATCH_SIZE) {
    const batch = pages.slice(i, i + EMBED_BATCH_SIZE)
    const inputs = batch.map(p => `${p.title}\n\n${p.text}`.slice(0, EMBED_INPUT_CAP))
    try {
      const vectors = await embedDocuments(inputs, geminiKey)
      vectors.forEach((v, j) => { batch[j].embedding = v })
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err.message}`)
    }
    console.log(`  [${Math.min(i + EMBED_BATCH_SIZE, pages.length)}/${pages.length}] embedded`)
    await new Promise(r => setTimeout(r, 200))
  }

  // Wipe old pages for this site, then insert fresh batch.
  console.log('\nWriting to Supabase…')
  await supabase.from('webask_pages').delete().eq('site_id', site.id)

  const rows = pages
    .filter(p => Array.isArray(p.embedding) && p.embedding.length === EMBED_DIM)
    .map(p => ({
      site_id: site.id,
      url: p.url,
      title: p.title,
      text: p.text,
      embedding: p.embedding,
    }))

  // Insert in chunks to stay under PG payload limits.
  const INSERT_CHUNK = 50
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const { error } = await supabase.from('webask_pages').insert(chunk)
    if (error) {
      console.error(`  Insert chunk ${i}-${i + chunk.length} failed: ${error.message}`)
    } else {
      inserted += chunk.length
    }
  }

  await supabase.from('webask_sites').update({
    status: 'ready',
    page_count: inserted,
    embedding_model: EMBED_MODEL,
    embedding_dim: EMBED_DIM,
    last_crawled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', site.id)

  console.log(`\n✓ ${site.domain} ready — ${inserted}/${pages.length} pages indexed`)
}

main().catch(err => {
  console.error('crawl-site failed:', err)
  process.exit(1)
})
