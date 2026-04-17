const crypto = require('crypto')

exports.handler = async () => {
  const token = process.env.SWITCHBOT_TOKEN
  const secret = process.env.SWITCHBOT_SECRET

  const t = Date.now()
  const nonce = crypto.randomUUID()
  const sign = crypto.createHmac('sha256', secret)
    .update(Buffer.from(token + t + nonce, 'utf-8')).digest('base64')

  const res = await fetch('https://api.switch-bot.com/v1.1/devices', {
    headers: { 'Authorization': token, 'sign': sign, 't': String(t), 'nonce': nonce }
  })
  const json = await res.json()
  return { statusCode: 200, body: JSON.stringify(json, null, 2) }
}
