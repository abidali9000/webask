# WebAsk

Drop-in **AI chat widget** for any website. Paste one `<script>` tag and your
visitors can ask anything — answers come from your site's own content, retrieved
by semantic search and answered by Gemini.

The repo also contains the original WebAsk demo at `/`: paste a URL, crawl on
the fly, ask questions. That stays as a "try it" landing page.

Built by **Abid Ali & Rohma** · admin@abidali.vip

---

## Architecture

```
┌──────────────────────────┐         ┌────────────────────────────────────────┐
│ your-site.com            │         │ webask.vercel.app                       │
│  <script src=".../widget.js"       │  /widget.js   (Shadow DOM chat UI)      │
│          data-site-key=…>          │  /api/widget/config   (site metadata)   │
│                          │ ─────►  │  /api/widget/ask      (RAG → Gemini)    │
└──────────────────────────┘  CORS   │         │                                │
                              locked │         ▼                                │
                                     │  Supabase Postgres + pgvector            │
                                     │   webask_sites  (registered domains)    │
                                     │   webask_pages  (crawled + embedded)    │
                                     └────────────────────────────────────────┘
```

Each registered site has a public `site_key` and a list of `allowed_origins`.
Both API routes echo `Access-Control-Allow-Origin` only when the request comes
from one of those origins — so other sites can't reuse a key.

Embeddings: **`gemini-embedding-001`** at 1536 dims (MRL truncation) →
pgvector cosine similarity → top-12 → **`gemini-2.5-flash`**.

---

## Setup

### 1. Supabase

Schema is already migrated on the project at
`https://qfqmrrrlmuvktyoygaot.supabase.co`. To use a different project, run the
migration named `webask_widget_schema` against it.

You'll need the **service-role** key from Supabase → Project Settings → API.

### 2. Env

```bash
cp .env.local.example .env.local
```

Fill in:
- `GEMINI_API_KEY` — from https://aistudio.google.com/app/apikey
- `SUPABASE_URL` — your project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key from the Supabase dashboard
- `PUBLIC_BASE_URL` — where the widget will be hosted (e.g. `https://webask.vercel.app`)

### 3. Install + run locally

```bash
npm install
npm run dev
```

### 4. Deploy

Push to GitHub → import on Vercel → add the four env vars above → deploy.

---

## Add the widget to a site

### Step 1 — Register the site

```bash
npm run register -- --domain abidali.vip --label "Abid Ali"
```

This prints a `site_key`, the allowed origins, and the install snippet. By
default it registers `https://abidali.vip` and `https://www.abidali.vip` as
allowed origins; add more with `--origin https://staging.abidali.vip`.

### Step 2 — Crawl the site

```bash
npm run crawl -- sk_yourSiteKey
```

The crawler walks the sitemap (with robots.txt sitemap directives) then BFS
from the homepage to depth 2. Each page is embedded and written to Supabase.
Re-run anytime to refresh — old pages are replaced.

For larger sites, pass `--max 300`. Crawls average 1–3 minutes per 100 pages.

### Step 3 — Paste the snippet

```html
<script
  src="https://webask.vercel.app/widget.js"
  data-site-key="sk_yourSiteKey"
  defer
></script>
```

A floating chat button appears in the bottom-right. Click to open. The widget
only renders if the site's status is `ready` and the request origin is on the
allow-list, so a missing/wrong key fails silently in production.

### Customizing the widget

The script tag supports a few `data-*` overrides:

| Attribute        | Default        | Notes                                     |
|------------------|----------------|-------------------------------------------|
| `data-accent`    | `#1D9E75`      | Hex colour for button, header, send key.  |
| `data-position`  | `bottom-right` | `bottom-right`, `bottom-left`, etc.       |
| `data-greeting`  | (auto)         | Override the bot's opening message.       |

Example:
```html
<script
  src="https://webask.vercel.app/widget.js"
  data-site-key="sk_..."
  data-accent="#2563EB"
  data-position="bottom-left"
  data-greeting="Hi! Ask me anything about my work."
  defer
></script>
```

---

## Project structure

```
webask/
├── lib/
│   ├── crawl.js             # Sitemap + BFS crawler (shared)
│   ├── embeddings.js        # Gemini embedding helpers
│   ├── supabase.js          # Server-side Supabase admin client
│   └── cors.js              # Origin-locked CORS helper
├── pages/
│   ├── api/
│   │   ├── widget/
│   │   │   ├── ask.js       # POST: RAG + Gemini, origin-locked
│   │   │   └── config.js    # GET: site label/status, origin-locked
│   │   ├── ask.js           # Legacy: demo at /
│   │   └── crawl.js         # Legacy: demo at /
│   ├── _app.js
│   └── index.js             # Legacy demo UI ("paste a URL")
├── public/
│   ├── widget.js            # Embeddable chat widget (Shadow DOM)
│   └── widget-demo.html     # Local smoke-test page
├── scripts/
│   ├── register-site.mjs    # CLI: add a new site, mint a site_key
│   └── crawl-site.mjs       # CLI: crawl + embed + upsert into Supabase
├── styles/
│   └── globals.css
└── package.json
```

---

## Tech

- **Next.js** — API routes + the demo page
- **Supabase + pgvector** — multi-tenant storage for sites and embeddings
- **Gemini** — `gemini-embedding-001` (1536-d) for retrieval, `gemini-2.5-flash` for answers
- **Shadow DOM** — widget renders in an isolated style scope on the host site

---

## License
MIT
