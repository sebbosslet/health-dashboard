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

exports.handler = async (event) => {
  // Allow manual trigger via POST as well as scheduled
  try {
    if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET || !SWITCHBOT_DEVICE_ID) {
      console.error('Missing SwitchBot env vars')
      return { statusCode: 500, body: 'Missing SwitchBot config' }
    }

    // Fetch current temperature from SwitchBot
    const res = await fetch(
      `https://api.switch-bot.com/v1.1/devices/${SWITCHBOT_DEVICE_ID}/status`,
      { headers: makeSwitchBotHeaders() }
    )
    const json = await res.json()

    if (json.statusCode !== 100) {
      console.error('SwitchBot error:', json)
      return { statusCode: 500, body: JSON.stringify(json) }
    }

    const { temperature, humidity } = json.body
    const now = new Date().toISOString()

    console.log(`[SwitchBot] ${temperature}°C / ${humidity}% @ ${now}`)

    // Save to Supabase temperature_readings table
    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/temperature_readings`, {
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
    console.error('switchbot-poll error:', err)
    return { statusCode: 500, body: err.message }
  }
}
