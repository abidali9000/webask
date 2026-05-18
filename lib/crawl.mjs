// Shared crawler used by scripts/crawl-site.mjs.
// Sitemap-first, then BFS to depth 2 from the homepage, capped by maxPages.

import axios from 'axios'
import * as cheerio from 'cheerio'

const SKIP_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|xml|zip|ico|mp4|mp3|woff|woff2|ttf|doc|docx|xls|xlsx|ppt|pptx)$/i
const SKIP_PATH = /\/(login|logout|signup|register|cart|checkout|feed|rss|wp-json|wp-admin|api\/|cdn-cgi\/)/i

const UA = 'Mozilla/5.0 (compatible; WebAskBot/1.0; +https://webask.vercel.app)'
const POLITE_DELAY_MS = 200
const BFS_MAX_FETCHES = 60
const BFS_MAX_DEPTH = 2
const TEXT_CAP = 6000

async function fetchText(url, timeout = 15000) {
  const res = await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 5,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 400,
  })
  return res.data
}

function isUsable(parsed, baseHost) {
  return (
    parsed.hostname === baseHost &&
    !SKIP_EXT.test(parsed.pathname) &&
    !SKIP_PATH.test(parsed.pathname)
  )
}

function normalizeUrl(parsed) {
  return parsed.origin + parsed.pathname
}

function extractText(html, url) {
  const $ = cheerio.load(html)
  $('script, style, noscript, nav, footer, header, aside, iframe, form, button, [aria-hidden="true"], .cookie-banner, .ad, .advertisement').remove()

  const title = $('title').text().trim() || new URL(url).pathname || url

  let el = $('main').first()
  if (!el.length) el = $('article').first()
  if (!el.length) el = $('[role="main"]').first()
  if (!el.length) el = $('body')

  const parts = []
  el.find('h1,h2,h3,h4,p,li,td,th,dt,dd').each((_, node) => {
    const t = $(node).text().replace(/\s+/g, ' ').trim()
    if (t.length > 20) parts.push(t)
  })

  const text = parts.length
    ? parts.join('\n')
    : el.text().replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  return {
    title: title.slice(0, 200),
    text: text.slice(0, TEXT_CAP),
  }
}

async function readRobotsSitemaps(rootUrl) {
  try {
    const robots = await fetchText(rootUrl + 'robots.txt', 8000)
    return robots.split('\n').map(l => l.trim())
      .filter(l => /^sitemap\s*:/i.test(l))
      .map(l => l.replace(/^sitemap\s*:\s*/i, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function collectFromSitemaps(rootUrl, baseHost, cap) {
  const fromRobots = await readRobotsSitemaps(rootUrl)
  const seeds = [
    ...fromRobots,
    rootUrl + 'sitemap.xml',
    rootUrl + 'sitemap_index.xml',
    rootUrl + 'sitemap-index.xml',
    rootUrl + 'sitemap/sitemap.xml',
    rootUrl + 'sitemap-en.xml',
    rootUrl + 'sitemaps/sitemap.xml',
  ]
  const visited = new Set()
  const collected = new Set()
  const queue = [...new Set(seeds)]
  const hardCap = cap * 4

  while (queue.length && collected.size < hardCap) {
    const sm = queue.shift()
    if (visited.has(sm)) continue
    visited.add(sm)

    let xml
    try { xml = await fetchText(sm, 20000) } catch { continue }
    if (!xml) continue

    const sitemapLocs = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/g)].map(m => m[1].trim())
    for (const nested of sitemapLocs) if (!visited.has(nested)) queue.push(nested)

    const urlLocs = [...xml.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g)].map(m => m[1].trim())
    const bareLocs = urlLocs.length || sitemapLocs.length
      ? []
      : [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())

    for (const loc of [...urlLocs, ...bareLocs]) {
      if (collected.size >= hardCap) break
      if (/\.xml(\.gz)?($|\?)/i.test(loc)) {
        if (!visited.has(loc)) queue.push(loc)
        continue
      }
      try {
        const parsed = new URL(loc)
        if (isUsable(parsed, baseHost)) collected.add(normalizeUrl(parsed))
      } catch {}
    }
  }
  return [...collected]
}

async function bfsLinks(rootUrl, baseHost, cap, known = new Set()) {
  const collected = new Set(known)
  collected.add(rootUrl)
  const visited = new Set()
  const queue = [{ url: rootUrl, depth: 0 }]
  let fetches = 0
  const hardCap = Math.max(cap * 2, cap + 100)

  while (queue.length && fetches < BFS_MAX_FETCHES && collected.size < hardCap) {
    const { url, depth } = queue.shift()
    if (visited.has(url)) continue
    visited.add(url)

    let html
    try { html = await fetchText(url); fetches++ } catch { continue }

    if (depth >= BFS_MAX_DEPTH) {
      await new Promise(r => setTimeout(r, POLITE_DELAY_MS))
      continue
    }

    const $ = cheerio.load(html)
    $('a[href]').each((_, el) => {
      try {
        const href = $(el).attr('href')
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
        const full = new URL(href, url)
        if (!isUsable(full, baseHost)) return
        const norm = normalizeUrl(full)
        if (collected.has(norm)) return
        collected.add(norm)
        if (collected.size < hardCap) queue.push({ url: norm, depth: depth + 1 })
      } catch {}
    })
    await new Promise(r => setTimeout(r, POLITE_DELAY_MS))
  }
  return [...collected]
}

export async function discoverUrls(rootUrl, baseHost, cap, log = console.log) {
  log('  Reading robots.txt + sitemaps…')
  let urls = await collectFromSitemaps(rootUrl, baseHost, cap)
  log(`  Sitemap yielded ${urls.length} URLs`)
  if (urls.length < cap) {
    log('  Augmenting with homepage BFS (depth 2)…')
    urls = await bfsLinks(rootUrl, baseHost, cap, new Set(urls))
    log(`  After BFS: ${urls.length} URLs`)
  }
  return urls
}

export async function crawlPages(rootUrl, options = {}) {
  const { maxPages = 100, onProgress = () => {}, log = console.log } = options
  const root = rootUrl.endsWith('/') ? rootUrl : rootUrl + '/'
  const baseHost = new URL(root).hostname

  let urls = await discoverUrls(root, baseHost, maxPages, log)
  urls = [root, ...urls.filter(u => u !== root)]
  urls = [...new Set(urls)].slice(0, maxPages)

  const pages = []
  let done = 0, kept = 0, skipped = 0
  for (const pageUrl of urls) {
    done++
    try {
      const html = await fetchText(pageUrl)
      const { title, text } = extractText(html, pageUrl)
      if (text.length > 80) {
        pages.push({ url: pageUrl, title, text })
        kept++
      } else {
        skipped++
      }
    } catch {
      skipped++
    }
    onProgress({ done, total: urls.length, kept, skipped })
    await new Promise(r => setTimeout(r, POLITE_DELAY_MS))
  }
  return { pages, host: baseHost }
}
