export function asErrorMessage(value, fallback = '请求失败，请查看服务端日志。') {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => item.msg || item.message || JSON.stringify(item)).join('；')
  return value.detail || value.message || JSON.stringify(value)
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(asErrorMessage(data))
  return data
}

export async function streamSse(url, payload, onEvent, signal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(asErrorMessage(data))
  }
  if (!response.body) throw new Error('浏览器不支持流式响应。')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const consume = (packet) => {
    const lines = packet.replace(/\r/g, '').split('\n')
    let event = 'message'
    const values = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) values.push(line.slice(5).trimStart())
    }
    if (!values.length) return
    let data = values.join('\n')
    try { data = JSON.parse(data) } catch { /* Keep plain-text SSE values usable. */ }
    onEvent(event, data)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
  } finally {
    reader.releaseLock()
  }
}

export function shortTitle(text) {
  return (text || '新的对话').trim().replace(/\s+/g, ' ').slice(0, 30) || '新的对话'
}

export function createId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
