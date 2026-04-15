import { useState, useRef, useEffect, useCallback } from 'react'
import Head from 'next/head'

const EXAMPLES = [
  { label: 'NHS – Diabetes', url: 'https://www.nhs.uk/conditions/diabetes/' },
  { label: 'WHO – Diabetes', url: 'https://www.who.int/health-topics/diabetes' },
  { label: 'Wikipedia – AI', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence' },
]

const SUGGESTIONS = [
  'What is this website mainly about?',
  'What conditions or topics are covered?',
  'What treatments are discussed?',
  'Who is the intended audience?',
]

function LogoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" />
      <path d="M5 8h6M8 5v6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8l12-6-6 12-2-4-4-2z" fill="white" />
    </svg>
  )
}

function formatBubble(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/\n/g, '<br />')
}

export default function Home() {
  const [step, setStep] = useState('home')
  const [url, setUrl] = useState('')
  const [maxPages, setMaxPages] = useState(15)
  const [pages, setPages] = useState([])
  const [crawlLog, setCrawlLog] = useState([])
  const [crawlProgress, setCrawlProgress] = useState({ done: 0, total: 0 })
  const [crawlStatusMsg, setCrawlStatusMsg] = useState('')
  const [crawlError, setCrawlError] = useState('')
  const [hostname, setHostname] = useState('')
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isAnswering, setIsAnswering] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const msgsRef = useRef(null)
  const inputRef = useRef(null)
  const allPagesRef = useRef([])

  useEffect(() => {
    if (msgsRef.current) {
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight
    }
  }, [messages])

  async function startCrawl() {
    let startUrl = url.trim()
    if (!startUrl) return
    if (!/^https?:\/\//i.test(startUrl)) startUrl = 'https://' + startUrl

    let host
    try { host = new URL(startUrl).hostname } catch { return }

    setHostname(host)
    setStep('crawling')
    setPages([])
    setCrawlLog([])
    setCrawlProgress({ done: 0, total: 0 })
    setCrawlStatusMsg('Discovering pages…')
    setCrawlError('')
    allPagesRef.current = []

    try {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: startUrl, maxPages }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Server error')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const data = JSON.parse(part.slice(6))

            if (data.type === 'status') {
              setCrawlStatusMsg(data.msg)
            } else if (data.type === 'discovered') {
              setCrawlProgress({ done: 0, total: data.total })
              setCrawlStatusMsg(`Found ${data.total} pages — crawling now…`)
            } else if (data.type === 'page') {
              allPagesRef.current = [...allPagesRef.current, data.page]
              setCrawlLog(prev => [...prev, { url: data.page.url, title: data.page.title, status: 'ok' }])
              setCrawlProgress({ done: data.done, total: data.total })
            } else if (data.type === 'skip') {
              setCrawlLog(prev => [...prev, { url: data.url, title: data.url, status: 'skip' }])
              setCrawlProgress({ done: data.done, total: data.total })
            } else if (data.type === 'complete') {
              const finalPages = allPagesRef.current
              setPages(finalPages)
              if (finalPages.length > 0) {
                setMessages([{
                  role: 'assistant',
                  content: `I've crawled **${finalPages.length} pages** from **${host}** and I'm ready to answer your questions. What would you like to know about this website?`,
                  sources: [],
                }])
                setStep('chat')
                setTimeout(() => inputRef.current?.focus(), 150)
              } else {
                setCrawlError('No readable content could be extracted. Try a different URL.')
              }
            } else if (data.type === 'error') {
              setCrawlError(data.msg)
            }
          } catch {}
        }
      }
    } catch (err) {
      setCrawlError(err.message || 'Something went wrong. Please try again.')
    }
  }

  const sendMessage = useCallback(async (q) => {
    const question = (q || chatInput).trim()
    if (!question || isAnswering) return
    setChatInput('')
    setIsAnswering(true)

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }))

    const newMessages = [...messages, { role: 'user', content: question }]
    setMessages(newMessages)

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, pages, history: history.slice(-6), hostname }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'API error')
      }

      const data = await res.json()
      setMessages([
        ...newMessages,
        { role: 'assistant', content: data.answer, sources: data.sources || [] },
      ])
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `Something went wrong: ${err.message}`, sources: [], error: true },
      ])
    } finally {
      setIsAnswering(false)
    }
  }, [chatInput, isAnswering, messages, pages, hostname])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function autoResize(e) {
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 130) + 'px'
  }

  function resetApp() {
    setStep('home')
    setUrl('')
    setPages([])
    setCrawlLog([])
    setMessages([])
    setHostname('')
    setDrawerOpen(false)
    setCrawlError('')
    allPagesRef.current = []
  }

  const okCount = crawlLog.filter(l => l.status === 'ok').length
  const skipCount = crawlLog.filter(l => l.status === 'skip').length
  const progressPct = crawlProgress.total > 0
    ? Math.round((crawlProgress.done / crawlProgress.total) * 100)
    : 0

  return (
    <>
      <Head>
        <title>WebAsk – Ask anything from any website</title>
        <meta name="description" content="AI-powered whole-website reader. Paste a URL and ask questions — answers pulled from every page." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="WebAsk" />
        <meta property="og:description" content="Ask anything from any website, powered by AI." />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%231D9E75'/><circle cx='16' cy='16' r='9' stroke='white' stroke-width='2' fill='none'/><path d='M11 16h10M16 11v10' stroke='white' stroke-width='2' stroke-linecap='round'/></svg>" />
      </Head>

      <div className="app">
        {/* ── HEADER ── */}
        <header className="header">
          <div className="logo" onClick={resetApp} style={{ cursor: 'pointer' }}>
            <div className="logo-icon"><LogoIcon /></div>
            <span className="logo-name">Web<span>Ask</span></span>
          </div>
          <div className="header-right">
            {step === 'chat' && (
              <span className="badge">{pages.length} pages indexed</span>
            )}
            <span className="badge">by Abid Ali</span>
          </div>
        </header>

        {/* ── STEP 1: HOME ── */}
        {step === 'home' && (
          <div className="hero">
            <p className="eyebrow">Whole-site AI reader</p>
            <h1 className="hero-title">Ask anything from<br />an entire website</h1>
            <p className="hero-sub">
              WebAsk crawls the full site, reads every page, and answers your
              questions from all of it — not just one page.
            </p>

            <div className="card">
              <p className="field-label">Website URL</p>
              <div className="field-row">
                <input
                  className="url-input"
                  type="url"
                  placeholder="https://www.nhs.uk/conditions/diabetes/"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && startCrawl()}
                />
              </div>

              <p className="field-label">Max pages to crawl</p>
              <div className="chips-row">
                {[10, 15, 25, 40].map(n => (
                  <button
                    key={n}
                    className={`chip ${maxPages === n ? 'active' : ''}`}
                    onClick={() => setMaxPages(n)}
                  >
                    {n} pages
                  </button>
                ))}
                <span className="chip-note">more pages = slower start</span>
              </div>

              <button
                className="btn-primary btn-full"
                onClick={startCrawl}
                disabled={!url.trim()}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2C4.24 2 2 4.24 2 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8.5A3.5 3.5 0 1 1 7 3.5a3.5 3.5 0 0 1 0 7z" fill="white" />
                  <path d="M7.5 4.5h-1V7l2.5 1.5.5-.87-2-.97V4.5z" fill="white" />
                </svg>
                Start crawling
              </button>

              <div className="examples" style={{ marginTop: 12 }}>
                {EXAMPLES.map(ex => (
                  <button
                    key={ex.url}
                    className="ex-pill"
                    onClick={() => setUrl(ex.url)}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: CRAWLING ── */}
        {step === 'crawling' && (
          <div className="crawl-wrap">
            <div className="crawl-card">
              <div className="crawl-header">
                {!crawlError && <div className="spinner" />}
                {crawlError && (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="8" stroke="#E24B4A" strokeWidth="1.5" />
                    <path d="M9 5v5M9 12.5v.5" stroke="#E24B4A" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                <div>
                  <div className="crawl-title">
                    {crawlError ? 'Crawl failed' : crawlStatusMsg || 'Starting…'}
                  </div>
                  {crawlError
                    ? <div className="crawl-sub" style={{ color: '#E24B4A' }}>{crawlError}</div>
                    : crawlProgress.total > 0 && (
                      <div className="crawl-sub">
                        {crawlProgress.done} of {crawlProgress.total} pages processed
                      </div>
                    )
                  }
                </div>
              </div>

              {!crawlError && (
                <>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="crawl-stats">
                    <span className="stat-ok">{okCount} pages read</span>
                    {skipCount > 0 && <span className="stat-skip">{skipCount} skipped</span>}
                  </div>
                  <div className="page-log">
                    {crawlLog.map((item, i) => (
                      <div className="log-item" key={i}>
                        <span className={`log-dot ${item.status}`} />
                        <span className="log-text" title={item.url}>
                          {item.title && item.title !== item.url
                            ? item.title
                            : item.url.replace(/^https?:\/\//, '')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {crawlError && (
                <button
                  className="btn-primary"
                  style={{ marginTop: 16 }}
                  onClick={() => { setStep('home'); setCrawlError('') }}
                >
                  Try a different URL
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: CHAT ── */}
        {step === 'chat' && (
          <div className="chat-view">
            {/* Site bar */}
            <div className="site-bar">
              <div className="site-info">
                <div className="site-dot" />
                <div>
                  <div className="site-name">{hostname}</div>
                  <div className="site-meta">{pages.length} pages crawled · ready to answer</div>
                </div>
              </div>
              <div className="bar-actions">
                <button className="btn-ghost" onClick={() => setDrawerOpen(o => !o)}>
                  Pages {drawerOpen ? '▴' : '▾'}
                </button>
                <button className="btn-ghost" onClick={resetApp}>← New site</button>
              </div>
            </div>

            {/* Pages drawer */}
            {drawerOpen && (
              <div className="pages-drawer">
                {pages.map((p, i) => (
                  <div className="drawer-item" key={i} title={p.url}>
                    {p.title || p.url.replace(/^https?:\/\//, '')}
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="msgs-wrap" ref={msgsRef}>
              {messages.map((msg, i) => (
                <div key={i}>
                  <div className={`msg ${msg.role === 'user' ? 'user' : ''}`}>
                    <div className={`avatar ${msg.role === 'user' ? 'you' : 'bot'}`}>
                      {msg.role === 'user' ? 'AA' : 'W'}
                    </div>
                    <div
                      className={`bubble ${msg.role === 'user' ? 'user' : msg.error ? 'err' : 'bot'}`}
                    >
                      <div dangerouslySetInnerHTML={{ __html: formatBubble(msg.content) }} />
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="sources">
                          {msg.sources.map((s, j) => (
                            <span className="source-tag" key={j} title={s.url}>
                              {s.title || s.url.replace(/^https?:\/\//, '')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Suggestions after first bot message */}
                  {i === 0 && msg.role === 'assistant' && (
                    <div className="suggestions" style={{ marginTop: 4 }}>
                      {SUGGESTIONS.map(s => (
                        <button key={s} className="sugg" onClick={() => sendMessage(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isAnswering && (
                <div className="msg">
                  <div className="avatar bot">W</div>
                  <div className="bubble bot">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="input-bar">
              <div className="input-inner">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  rows={1}
                  placeholder="Ask anything about this website…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={autoResize}
                />
                <button
                  className="send-btn"
                  onClick={() => sendMessage()}
                  disabled={isAnswering || !chatInput.trim()}
                >
                  <SendIcon />
                </button>
              </div>
              <p className="input-hint">
                Answers retrieved from across all {pages.length} crawled pages ·
                Always verify medical information with a qualified professional
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
