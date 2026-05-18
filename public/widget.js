/*!
 * WebAsk widget — drop-in chat that answers from a website's own content.
 * Embed with: <script src="https://your-deploy/widget.js" data-site-key="sk_..." defer></script>
 * Renders into a Shadow DOM so host-site CSS can't break it (and vice versa).
 */
(function () {
  if (window.__WEBASK_LOADED__) return
  window.__WEBASK_LOADED__ = true

  // Resolve the script's own src and data attributes.
  var thisScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script')
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) return scripts[i]
    }
    return null
  })()

  if (!thisScript) { console.warn('[WebAsk] could not locate script tag'); return }
  var siteKey = thisScript.getAttribute('data-site-key')
  if (!siteKey) { console.warn('[WebAsk] missing data-site-key attribute'); return }

  var apiBase = thisScript.src.replace(/\/widget\.js.*$/, '')
  var accent = thisScript.getAttribute('data-accent') || '#1D9E75'
  var position = (thisScript.getAttribute('data-position') || 'bottom-right').toLowerCase()
  var greeting = thisScript.getAttribute('data-greeting') || ''

  // --- State ---
  var state = {
    open: false,
    config: null,
    messages: [],
    sending: false,
  }

  // --- Shadow DOM root ---
  var host = document.createElement('div')
  host.id = 'webask-widget'
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483600'
  host.style[position.indexOf('right') !== -1 ? 'right' : 'left'] = '20px'
  host.style[position.indexOf('top') !== -1 ? 'top' : 'bottom'] = '20px'
  document.documentElement.appendChild(host)

  var shadow = host.attachShadow({ mode: 'open' })

  var styleEl = document.createElement('style')
  styleEl.textContent = [
    ':host, * { box-sizing: border-box; }',
    '.wa-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; line-height: 1.5; }',
    '.wa-launcher { width: 56px; height: 56px; border-radius: 50%; background: ' + accent + '; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.18); transition: transform 0.15s; }',
    '.wa-launcher:hover { transform: scale(1.05); }',
    '.wa-launcher svg { width: 26px; height: 26px; }',
    '.wa-panel { position: absolute; bottom: 72px; right: 0; width: 380px; max-width: calc(100vw - 40px); height: 560px; max-height: calc(100vh - 100px); background: #ffffff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.22); display: flex; flex-direction: column; overflow: hidden; }',
    '.wa-panel.wa-left { right: auto; left: 0; }',
    '.wa-panel.wa-top { bottom: auto; top: 72px; }',
    '.wa-header { padding: 14px 16px; background: ' + accent + '; color: #fff; display: flex; align-items: center; justify-content: space-between; }',
    '.wa-header-text { display: flex; flex-direction: column; min-width: 0; }',
    '.wa-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.wa-subtitle { font-size: 11px; opacity: 0.85; }',
    '.wa-close { background: transparent; color: #fff; border: none; font-size: 20px; cursor: pointer; padding: 4px 8px; opacity: 0.85; }',
    '.wa-close:hover { opacity: 1; }',
    '.wa-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #f9fafb; }',
    '.wa-msg { display: flex; gap: 8px; max-width: 100%; }',
    '.wa-msg.wa-user { flex-direction: row-reverse; }',
    '.wa-bubble { padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.55; word-break: break-word; max-width: calc(100% - 12px); }',
    '.wa-bubble.wa-bot { background: #ffffff; border: 1px solid rgba(0,0,0,0.08); color: #111827; }',
    '.wa-bubble.wa-user { background: ' + accent + '; color: #fff; }',
    '.wa-bubble.wa-err { background: #FEEBEB; border: 1px solid #F7C1C1; color: #A32D2D; }',
    '.wa-bubble strong { font-weight: 600; }',
    '.wa-bubble a { color: ' + accent + '; text-decoration: underline; }',
    '.wa-sources { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); }',
    '.wa-source { font-size: 10px; padding: 2px 8px; border-radius: 8px; background: #F0FAF6; color: #0F6E56; border: 1px solid #C6EBD9; text-decoration: none; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.wa-source:hover { background: #DCF3E8; }',
    '.wa-typing { display: flex; gap: 4px; padding: 4px 0; }',
    '.wa-dot { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: wa-blink 1.2s infinite; }',
    '.wa-dot:nth-child(2) { animation-delay: 0.2s; }',
    '.wa-dot:nth-child(3) { animation-delay: 0.4s; }',
    '@keyframes wa-blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }',
    '.wa-input-bar { padding: 10px 12px; background: #ffffff; border-top: 1px solid rgba(0,0,0,0.08); display: flex; gap: 8px; align-items: flex-end; }',
    '.wa-input { flex: 1; min-height: 38px; max-height: 100px; padding: 9px 12px; border: 1px solid rgba(0,0,0,0.15); border-radius: 10px; font-size: 13px; line-height: 1.4; resize: none; outline: none; font-family: inherit; background: #f9fafb; color: #111827; }',
    '.wa-input:focus { border-color: ' + accent + '; background: #fff; }',
    '.wa-send { width: 38px; height: 38px; border-radius: 10px; background: ' + accent + '; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }',
    '.wa-send:disabled { opacity: 0.4; cursor: not-allowed; }',
    '.wa-footer { font-size: 10px; color: #9ca3af; text-align: center; padding: 6px 12px 10px; background: #ffffff; }',
    '.wa-footer a { color: #6b7280; text-decoration: none; }',
    '@media (max-width: 480px) { .wa-panel { position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; border-radius: 0; bottom: 0 !important; top: 0 !important; left: 0 !important; right: 0 !important; } }',
  ].join('\n')
  shadow.appendChild(styleEl)

  var root = document.createElement('div')
  root.className = 'wa-root'
  shadow.appendChild(root)

  // --- Rendering ---
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function formatMarkdown(s) {
    var safe = escapeHtml(s)
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    safe = safe.replace(/(^|\s)\*(.+?)\*(\s|$)/g, '$1<em>$2</em>$3')
    safe = safe.replace(/^- (.+)$/gm, '• $1')
    safe = safe.replace(/\n/g, '<br>')
    return safe
  }

  function panelClasses() {
    var cls = ['wa-panel']
    if (position.indexOf('left') !== -1) cls.push('wa-left')
    if (position.indexOf('top') !== -1) cls.push('wa-top')
    return cls.join(' ')
  }

  function render() {
    if (!state.open) {
      root.innerHTML =
        '<button class="wa-launcher" aria-label="Open chat">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>' +
          '</svg>' +
        '</button>'
      root.querySelector('.wa-launcher').addEventListener('click', toggleOpen)
      return
    }

    var label = (state.config && state.config.label) || 'Ask the site'
    var pageCount = state.config && state.config.page_count
    var subtitle = pageCount ? pageCount + ' pages indexed' : 'AI assistant'

    var msgsHtml = state.messages.map(function (m) {
      if (m.role === 'user') {
        return '<div class="wa-msg wa-user"><div class="wa-bubble wa-user">' + formatMarkdown(m.content) + '</div></div>'
      }
      var bubbleCls = m.error ? 'wa-err' : 'wa-bot'
      var sources = ''
      if (m.sources && m.sources.length) {
        sources = '<div class="wa-sources">' + m.sources.map(function (s) {
          return '<a class="wa-source" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" title="' + escapeHtml(s.url) + '">' + escapeHtml(s.title || s.url) + '</a>'
        }).join('') + '</div>'
      }
      return '<div class="wa-msg"><div class="wa-bubble ' + bubbleCls + '">' + formatMarkdown(m.content) + sources + '</div></div>'
    }).join('')

    var typingHtml = state.sending
      ? '<div class="wa-msg"><div class="wa-bubble wa-bot"><div class="wa-typing"><span class="wa-dot"></span><span class="wa-dot"></span><span class="wa-dot"></span></div></div></div>'
      : ''

    root.innerHTML =
      '<button class="wa-launcher" aria-label="Close chat">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '</button>' +
      '<div class="' + panelClasses() + '" role="dialog" aria-label="' + escapeHtml(label) + '">' +
        '<div class="wa-header">' +
          '<div class="wa-header-text">' +
            '<div class="wa-title">' + escapeHtml(label) + '</div>' +
            '<div class="wa-subtitle">' + escapeHtml(subtitle) + '</div>' +
          '</div>' +
          '<button class="wa-close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="wa-body" id="wa-body">' + msgsHtml + typingHtml + '</div>' +
        '<div class="wa-input-bar">' +
          '<textarea class="wa-input" rows="1" placeholder="Ask anything about this site…"></textarea>' +
          '<button class="wa-send" aria-label="Send">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-6-6 12-2-4-4-2z" fill="white"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="wa-footer">Answers from this site\'s content · <a href="https://webask.vercel.app" target="_blank" rel="noopener">powered by WebAsk</a></div>' +
      '</div>'

    root.querySelector('.wa-launcher').addEventListener('click', toggleOpen)
    root.querySelector('.wa-close').addEventListener('click', toggleOpen)
    var input = root.querySelector('.wa-input')
    var sendBtn = root.querySelector('.wa-send')
    sendBtn.disabled = state.sending
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value) }
    })
    input.addEventListener('input', function (e) {
      e.target.style.height = 'auto'
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
    })
    sendBtn.addEventListener('click', function () { send(input.value) })
    if (!state.sending) setTimeout(function () { input.focus() }, 30)

    var body = root.querySelector('#wa-body')
    if (body) body.scrollTop = body.scrollHeight
  }

  function toggleOpen() {
    state.open = !state.open
    if (state.open && state.messages.length === 0) {
      var hello = greeting || 'Hi! Ask me anything about ' + ((state.config && state.config.label) || 'this site') + '.'
      state.messages.push({ role: 'assistant', content: hello })
    }
    render()
  }

  function send(text) {
    var q = (text || '').trim()
    if (!q || state.sending) return
    state.messages.push({ role: 'user', content: q })
    state.sending = true
    render()

    var history = state.messages
      .filter(function (m) { return m.role === 'user' || (m.role === 'assistant' && typeof m.content === 'string') })
      .map(function (m) { return { role: m.role, content: m.content } })
      .slice(-6)

    fetch(apiBase + '/api/widget/ask?site_key=' + encodeURIComponent(siteKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_key: siteKey, question: q, history: history.slice(0, -1) }),
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data } })
    }).then(function (r) {
      state.sending = false
      if (!r.ok) {
        state.messages.push({ role: 'assistant', content: r.data.error || 'Something went wrong.', error: true })
      } else {
        state.messages.push({ role: 'assistant', content: r.data.answer, sources: r.data.sources || [] })
      }
      render()
    }).catch(function (err) {
      state.sending = false
      state.messages.push({ role: 'assistant', content: 'Network error: ' + err.message, error: true })
      render()
    })
  }

  // --- Init: fetch config, then render the launcher ---
  fetch(apiBase + '/api/widget/config?site_key=' + encodeURIComponent(siteKey))
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data } }) })
    .then(function (r) {
      if (!r.ok) {
        console.warn('[WebAsk] config error:', r.data && r.data.error)
        return
      }
      if (r.data.status !== 'ready') {
        console.info('[WebAsk] site status is "' + r.data.status + '" — widget will not show until the site is crawled.')
        return
      }
      state.config = r.data
      render()
    })
    .catch(function (err) {
      console.warn('[WebAsk] failed to load config:', err)
    })
})();
