export const config = {
  maxDuration: 30,
}

const STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'how', 'why',
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'that',
  'this', 'from', 'have', 'has', 'about', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'more', 'some', 'any',
  'all', 'been', 'being', 'their', 'they', 'them', 'then',
  'than', 'into', 'your', 'also', 'its', 'just', 'not', 'but',
])

function getRelevantChunks(question, pages, maxChars = 9000) {
  const keywords = question
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))

  const scored = pages.map(page => {
    const haystack = (page.title + ' ' + page.text).toLowerCase()
    let score = 0
    for (const kw of keywords) {
      const exact = (haystack.match(new RegExp(`\\b${kw}\\b`, 'gi')) || []).length
      const partial = (haystack.match(new RegExp(kw, 'gi')) || []).length
      score += exact * 2 + partial * 0.5
    }
    const titleLower = page.title.toLowerCase()
    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 5
    }
    return { ...page, score }
  })

  scored.sort((a, b) => b.score - a.score)

  let context = ''
  const usedPages = []
  for (const page of scored) {
    if (context.length >= maxChars) break
    const remaining = maxChars - context.length
    const chunk = `\n\n=== ${page.title}\nURL: ${page.url}\n---\n${page.text}`
    context += chunk.slice(0, remaining)
    usedPages.push(page)
  }

  return { context, usedPages }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { question, pages, history = [], hostname } = req.body

  if (!question) return res.status(400).json({ error: 'Question is required' })
  if (!pages || pages.length === 0) return res.status(400).json({ error: 'No pages provided' })

  const { context, usedPages } = getRelevantChunks(question, pages)

  const prompt = `You are WebAsk, a helpful AI assistant. A user is asking questions about the website "${hostname}".

You have been given content retrieved from the most relevant pages of this website, selected based on the user's question.

Your rules:
- Answer ONLY from the provided page content below — never invent or assume facts
- Be clear, helpful, and concise — use bullet points or numbered lists where appropriate
- If the answer spans multiple pages, synthesize the information clearly
- If the answer is not in the content, say: "I couldn't find that information across the pages I've read from this site."
- For medical, legal, or financial topics, always remind the user to consult a qualified professional
- Keep your answer focused — do not pad with unnecessary text

--- RETRIEVED CONTENT FROM ${hostname} ---
${context}
--- END OF CONTENT ---

${history.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

User: ${question}
Assistant:`

  try {
    const apiKey = process.env.GEMINI_API_KEY
    // v1beta is the correct endpoint for Gemini 2.5 models
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      const msg = err?.error?.message || JSON.stringify(err)

      // Give a clear human-readable message for the EU free tier restriction
      if (msg.includes('quota') || msg.includes('429') || response.status === 429) {
        return res.status(429).json({
          error: 'Gemini free tier quota exceeded. If you are in the EU, the free tier is not available in your region. Please enable billing on your Google Cloud project at console.cloud.google.com — you will only be charged a fraction of a cent per question.',
        })
      }

      throw new Error(msg)
    }

    const data = await response.json()
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.'

    res.json({
      answer,
      sources: usedPages.slice(0, 5).map(p => ({
        url: p.url,
        title: p.title || p.url.replace(/^https?:\/\//, ''),
      })),
    })
  } catch (err) {
    console.error('Gemini API error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate answer' })
  }
}
