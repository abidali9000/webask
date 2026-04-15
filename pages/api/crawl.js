import axios from 'axios'
import * as cheerio from 'cheerio'

export const config = {
  maxDuration: 60,
}

const SKIP_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|xml|zip|ico|mp4|mp3|woff|woff2|ttf)$/i
const SKIP_PATH = /\/(login|logout|signup|register|cart|checkout|feed|rss|wp-json|wp-admin|api\/|cdn-cgi\/)/i

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebAsk/1.0; +https://webask.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 5,
    responseType: 'text',
  })
  return res.data
}

function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const $ = cheerio.load(html)
  const links = new Set()

  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      const full = new URL(href, base)
      if (
        full.hostname === base.hostname &&
        !SKIP_EXT.test(full.pathname) &&
        !SKIP_PATH.test(full.pathname)
      ) {
        links.add(full.origin + full.pathname)
      }
    } catch {}
  })

  return [...links]
}

function extractText(html, url) {
  const $ = cheerio.load(html)

  // Remove noise elements
  $('script, style, noscript, nav, footer, header, aside, iframe, form, button, [aria-hidden="true"], .cookie-banner, .ad, .advertisement').remove()

  const title = $('title').text().trim() || new URL(url).pathname || url

  // Prefer semantic content areas
  let textEl = $('main').first()
  if (!textEl.length) textEl = $('article').first()
  if (!textEl.length) textEl = $('[role="main"]').first()
  if (!textEl.length) textEl = $('body')

  // Extract headings and paragraphs for better structure
  const parts = []
  textEl.find('h1,h2,h3,h4,p,li,td,th,dt,dd').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text.length > 20) parts.push(text)
  })

  let text = parts.length > 0
    ? parts.join('\n')
    : textEl.text().replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  return {
    title: title.slice(0, 120),
    text: text.slice(0, 3500),
  }
}

async function trySitemap(baseUrl) {
  const base = new URL(baseUrl)

  // Try common sitemap locations
  const candidates = [
    base.origin + '/sitemap.xml',
    base.origin + '/sitemap_index.xml',
    base.origin + '/sitemap/sitemap.xml',
  ]

  for (const sitemapUrl of candidates) {
    try {
      const res = await axios.get(sitemapUrl, { timeout: 8000, responseType: 'text' })
      const xml = res.data
      if (!xml.includes('<loc>')) continue

      const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || []
      const urls = matches
        .map(m => m.replace(/<\/?loc>/g, '').trim())
        .filter(u => {
          try {
            const parsed = new URL(u)
            return (
              parsed.hostname === base.hostname &&
              !SKIP_EXT.test(parsed.pathname) &&
              !SKIP_PATH.test(parsed.pathname)
            )
          } catch { return false }
        })

      if (urls.length > 0) return urls
    } catch {}
  }

  return []
}

function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { url, maxPages = 15 } = req.body

  if (!url) return res.status(400).json({ error: 'URL is required' })

  let startUrl
  try {
    startUrl = url.startsWith('http') ? url : 'https://' + url
    new URL(startUrl)
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  send(res, { type: 'status', msg: 'Discovering pages…' })

  try {
    // Discover URLs
    let urls = await trySitemap(startUrl)
    const foundSitemap = urls.length > 0

    if (!foundSitemap) {
      send(res, { type: 'status', msg: 'No sitemap found — scanning homepage for links…' })
      try {
        const homeHtml = await fetchHtml(startUrl)
        const links = extractLinks(homeHtml, startUrl)
        urls = [startUrl, ...links]
      } catch (err) {
        send(res, { type: 'error', msg: 'Could not reach the homepage: ' + err.message })
        res.end()
        return
      }
    } else {
      // Ensure start URL is included
      urls = [startUrl, ...urls.filter(u => u !== startUrl)]
    }

    // Deduplicate and limit
    urls = [...new Set(urls)].slice(0, maxPages)

    send(res, { type: 'discovered', total: urls.length, sitemap: foundSitemap })

    // Crawl each page
    let done = 0
    for (const pageUrl of urls) {
      try {
        const html = await fetchHtml(pageUrl)
        const { title, text } = extractText(html, pageUrl)

        if (text.length > 80) {
          send(res, {
            type: 'page',
            page: { url: pageUrl, title, text },
            done: ++done,
            total: urls.length,
          })
        } else {
          send(res, { type: 'skip', url: pageUrl, done: ++done, total: urls.length })
        }
      } catch {
        send(res, { type: 'skip', url: pageUrl, done: ++done, total: urls.length })
      }

      // Be polite to servers
      await new Promise(r => setTimeout(r, 250))
    }

    send(res, { type: 'complete' })
  } catch (err) {
    send(res, { type: 'error', msg: err.message })
  }

  res.end()
}
