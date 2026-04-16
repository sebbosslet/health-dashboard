const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set')
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) }
  }

  try {
    const bodyStr = event.body || '{}'
    console.log('Request body size:', bodyStr.length, 'bytes')

    const body = JSON.parse(bodyStr)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data).slice(0, 500))
      return { statusCode: response.status, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) }
  } catch (err) {
    console.error('Proxy error:', err.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
