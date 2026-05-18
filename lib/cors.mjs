// Origin-locked CORS helper. The widget can only call our API from origins
// that the site owner registered when creating their site_key.

export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin
  return !!origin && allowedOrigins.includes(origin)
}
