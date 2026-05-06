import type { Message, Source, SourceRef } from '../types'

// In Docker: nginx proxies /api → backend.  In local dev: Vite proxies /api → localhost:8000.
const BASE = '/api'

// ── Sources ───────────────────────────────────────────────────────────────────

export async function getSources(): Promise<Source[]> {
  const res = await fetch(`${BASE}/sources`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteSource(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sources/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function uploadPDF(file: File): Promise<Source> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/upload/pdf`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? res.statusText)
  }
  return res.json()
}

export async function uploadURL(url: string): Promise<Source> {
  const form = new FormData()
  form.append('url', url)
  const res = await fetch(`${BASE}/upload/url`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? res.statusText)
  }
  return res.json()
}

// ── Chat / SSE ────────────────────────────────────────────────────────────────

export type ChatEvent =
  | { type: 'sources'; data: SourceRef[] }
  | { type: 'text'; data: string }
  | { type: 'error'; data: string }
  | { type: 'done' }

export async function* streamChat(
  query: string,
  history: Message[],
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      history: history.map(({ role, content }) => ({ role, content })),
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text()
    yield { type: 'error', data: text || res.statusText }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      let event = 'message'
      let dataLines: string[] = []

      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith('event: ')) {
          event = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6))
        }
      }

      const data = dataLines.join('\n')

      if (event === 'sources') {
        yield { type: 'sources', data: JSON.parse(data) }
      } else if (event === 'text') {
        yield { type: 'text', data }
      } else if (event === 'error') {
        yield { type: 'error', data }
      } else if (event === 'done') {
        yield { type: 'done' }
        return
      }
    }
  }
}
