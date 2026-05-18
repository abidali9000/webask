// Register a new site for the WebAsk widget.
// Usage:
//   npm run register -- --domain abidali.vip --label "Abid Ali"
//   (extra origins: --origin https://staging.abidali.vip)

import { config as loadDotenv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '..', '.env.local') })
loadDotenv({ path: resolve(__dirname, '..', '.env') })

function parseArgs(argv) {
  const args = { origins: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--domain') args.domain = argv[++i]
    else if (a === '--label') args.label = argv[++i]
    else if (a === '--origin') args.origins.push(argv[++i])
  }
  return args
}

function randomKey() {
  return 'sk_' + randomBytes(12).toString('base64url')
}

function expectedOriginsFor(domain) {
  return [`https://${domain}`, `https://www.${domain}`]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.domain) {
    console.error('Usage: npm run register -- --domain example.com [--label "My Site"] [--origin https://staging.example.com]')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    console.error('SUPABASE_URL looks malformed:', JSON.stringify(url))
    console.error('Expected something like https://YOURPROJECT.supabase.co')
    process.exit(1)
  }
  if (key.length < 100 || /\s/.test(key)) {
    console.error(`SUPABASE_SERVICE_ROLE_KEY looks wrong (length=${key.length}, contains whitespace=${/\s/.test(key)}).`)
    console.error('Service-role keys are >100 chars and have no spaces/newlines.')
    console.error('Get it from: Supabase dashboard → Project Settings → API → service_role')
    process.exit(1)
  }

  // Pre-flight check against PostgREST root. With a valid apikey this returns
  // 200 (OpenAPI schema). 401 = wrong key. Network errors surface as fetch failed.
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/', {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (res.status === 401) {
      console.error('Supabase rejected the key (401). Make sure you copied the')
      console.error('service_role key (not publishable/anon) from:')
      console.error('  Supabase dashboard → Project Settings → API Keys → Secret keys')
      process.exit(1)
    }
    if (res.status >= 400 && res.status !== 404) {
      const body = await res.text().catch(() => '')
      console.error(`Supabase responded ${res.status} on probe.`)
      if (body) console.error('  body:', body.slice(0, 200))
      process.exit(1)
    }
  } catch (err) {
    console.error('Could not reach Supabase URL:', err.message)
    if (err.cause) console.error('  cause:', err.cause.message || err.cause)
    console.error('  url:', url)
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const domain = args.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
  const allowedOrigins = [...new Set([...expectedOriginsFor(domain), ...args.origins])]
  const siteKey = randomKey()

  let data, error
  try {
    const result = await supabase
      .from('webask_sites')
      .insert({
        site_key: siteKey,
        domain,
        label: args.label || domain,
        allowed_origins: allowedOrigins,
        status: 'pending',
      })
      .select()
      .single()
    data = result.data
    error = result.error
  } catch (err) {
    console.error('Insert threw:', err.message)
    if (err.cause) console.error('  cause:', err.cause.message || err.cause)
    process.exit(1)
  }

  if (error) {
    console.error('Failed to register site:', error.message)
    if (error.details) console.error('  details:', error.details)
    if (error.hint) console.error('  hint:', error.hint)
    if (error.code) console.error('  code:', error.code)
    process.exit(1)
  }

  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  console.log('')
  console.log(`✓ Registered ${data.domain}`)
  console.log(`  site_id:  ${data.id}`)
  console.log(`  site_key: ${data.site_key}`)
  console.log(`  origins:  ${data.allowed_origins.join(', ')}`)
  console.log('')
  console.log('Next: crawl the site so the widget has content to answer from:')
  console.log(`  npm run crawl -- ${data.site_key}`)
  console.log('')
  console.log('Then paste this snippet into your site (before </body>):')
  console.log('')
  console.log(`  <script src="${base}/widget.js" data-site-key="${data.site_key}" defer></script>`)
  console.log('')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
