const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET
const SWITCHBOT_DEVICE_ID = process.env.SWITCHBOT_DEVICE_ID

function makeSwitchBotHeaders() {
  const t = Date.now()
  const nonce = crypto.randomUUID()
  const data = SWITCHBOT_TOKEN + t + nonce
  const sign = crypto.createHmac('sha256', SWITCHBOT_SECRET)
    .update(Buffer.from(data, 'utf-8')).digest('base64')
  return {
    'Authorization': SWITCHBOT_TOKEN,
    'sign': sign,
    't': String(t),
    'nonce': nonce,
    'Content-Type': 'application/json',
  }
}

async function fetchWithRetry(url, options, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.ok || res.status < 500) return res
      console.warn(`Attempt ${i+1} got status ${res.status}, retrying...`)
    } catch (err) {
      console.warn(`Attempt ${i+1} failed: ${err.message}`)
      if (i === retries - 1) throw err
    }
    await new Promise(r => setTimeout(r, delayMs * (i + 1)))
  }
}

exports.handler = async (event) => {
  try {
    if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET || !SWITCHBOT_DEVICE_ID) {
      console.error('Missing SwitchBot env vars')
      return { statusCode: 500, body: 'Missing SwitchBot config' }
    }

    // Fetch from SwitchBot with retry
    const res = await fetchWithRetry(
      `https://api.switch-bot.com/v1.1/devices/${SWITCHBOT_DEVICE_ID}/status`,
      { headers: makeSwitchBotHeaders() }
    )
    const json = await res.json()

    if (json.statusCode !== 100) {
      console.error('SwitchBot API error:', JSON.stringify(json))
      return { statusCode: 500, body: JSON.stringify(json) }
    }

    const { temperature, humidity } = json.body
    const now = new Date().toISOString()

    console.log(`[SwitchBot] ${temperature}°C / ${humidity}% @ ${now}`)

    // Save to Supabase with retry
    const saveRes = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/temperature_readings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        recorded_at: now,
        temperature_c: temperature,
        temperature_f: +(temperature * 9/5 + 32).toFixed(1),
        humidity,
        device_id: SWITCHBOT_DEVICE_ID,
      }),
    })

    if (!saveRes.ok) {
      const err = await saveRes.text()
      console.error('Supabase save error:', err)
      return { statusCode: 500, body: err }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ temperature, humidity, recorded_at: now }),
    }
  } catch (err) {
    console.error('switchbot-poll fatal error:', err.message)
    return { statusCode: 500, body: err.message }
  }
}
