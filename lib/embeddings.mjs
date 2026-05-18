// Gemini embedding helpers.
// gemini-embedding-001 supports MRL truncation via outputDimensionality; we use
// 1536 to keep pgvector indexes fast and storage small (~6 KB/page vs 12 KB at 3072).

export const EMBED_MODEL = 'gemini-embedding-001'
export const EMBED_DIM = 1536

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function callEmbed(path, body, apiKey) {
  const res = await fetch(`${ENDPOINT_BASE}/${path}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Embedding ${path} failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function embedQuery(text, apiKey) {
  const data = await callEmbed(`${EMBED_MODEL}:embedContent`, {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBED_DIM,
  }, apiKey)
  return data.embedding.values
}

export async function embedDocuments(texts, apiKey) {
  const data = await callEmbed(`${EMBED_MODEL}:batchEmbedContents`, {
    requests: texts.map(t => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: t }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: EMBED_DIM,
    })),
  }, apiKey)
  return data.embeddings.map(e => e.values)
}
