# WebAsk

AI-powered whole-website reader. Paste any URL, WebAsk crawls the entire site and lets you ask questions — answers pulled from every page, not just one.

Built by **Abid Ali** · admin@abidali.vip

---

## Setup & Deploy (step by step)

### Step 1 — Extract the zip
Unzip `webask.zip` anywhere on your computer. You'll get a `webask` folder.

### Step 2 — Install Node.js (if you don't have it)
Download from https://nodejs.org — install the LTS version.

### Step 3 — Open the folder in VS Code
```bash
code webask
```
Or just open VS Code → File → Open Folder → select the webask folder.

### Step 4 — Install dependencies
Open the terminal in VS Code (Ctrl + `` ` ``) and run:
```bash
npm install
```

### Step 5 — Test locally
```bash
npm run dev
```
Open http://localhost:3000 — the app should be fully working.

### Step 6 — Push to GitHub
1. Go to https://github.com/new → create a repo called `webask`
2. Run these commands in your terminal:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/webask.git
git push -u origin main
```
> The `.env.local` file is in `.gitignore` so your API key will NOT be uploaded.

### Step 7 — Deploy on Vercel
1. Go to https://vercel.com → sign up with GitHub
2. Click **Add New Project** → Import your `webask` repo
3. Under **Environment Variables** add:
   - Name: `GEMINI_API_KEY`
   - Value: your Gemini API key
4. Click **Deploy**

Your app will be live at `https://webask-xxx.vercel.app` in about 60 seconds.

---

## Project structure

```
webask/
├── pages/
│   ├── _app.js          # App wrapper
│   ├── index.js         # Full UI (home → crawl → chat)
│   └── api/
│       ├── crawl.js     # Crawls website, streams progress via SSE
│       └── ask.js       # Retrieves pages, calls Gemini API
├── styles/
│   └── globals.css      # All styles
├── .env.local           # Your API key (never uploaded to GitHub)
├── .env.local.example   # Template for reference
├── vercel.json          # Timeout config for Vercel
└── package.json
```

---

## Tech used

- **Next.js** — framework + API routes
- **Cheerio** — server-side HTML parsing
- **Axios** — HTTP requests
- **Google Gemini 1.5 Flash** — AI for answering questions (free tier)
- **SSE** — real-time crawl progress

---

## License
MIT
