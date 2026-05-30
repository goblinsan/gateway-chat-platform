import { getEnv } from '../config/env'

const TTS_TIMEOUT_MS = (() => {
  const raw = process.env.TTS_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000
})()
const MAX_TEXT_LENGTH = 5000

interface TtsHealthResult {
  enabled: boolean
  baseUrl: string
  upstreamStatus: number
  error?: string
}

interface TtsVoice {
  id?: string
  name?: string
  [key: string]: unknown
}

interface TtsVoicesResult {
  enabled: boolean
  voices: TtsVoice[]
}

function extractVoices(payload: unknown): TtsVoice[] {
  if (Array.isArray(payload)) {
    return payload as TtsVoice[]
  }

  if (payload && typeof payload === 'object' && 'voices' in payload) {
    const voices = (payload as { voices?: unknown }).voices
    return Array.isArray(voices) ? (voices as TtsVoice[]) : []
  }

  return []
}

interface TtsSynthesizeOptions {
  text: string
  voice?: string
  format?: string
}

interface TtsSynthesizeResult {
  contentType: string
  audioBuffer: Buffer
}

function voiceIdentifier(voice: TtsVoice): string | undefined {
  const id = typeof voice.id === 'string' ? voice.id.trim() : ''
  if (id) return id
  const name = typeof voice.name === 'string' ? voice.name.trim() : ''
  return name || undefined
}

function buildUrl(path: string): string {
  const env = getEnv()
  const base = env.TTS_BASE_URL.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function getHealth(): Promise<TtsHealthResult> {
  const env = getEnv()
  if (!env.TTS_ENABLED) {
    return { enabled: false, baseUrl: env.TTS_BASE_URL, upstreamStatus: 0 }
  }

  const url = buildUrl(env.TTS_HEALTH_PATH)
  try {
    const res = await fetchWithTimeout(url)
    return { enabled: true, baseUrl: env.TTS_BASE_URL, upstreamStatus: res.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { enabled: true, baseUrl: env.TTS_BASE_URL, upstreamStatus: 0, error: message }
  }
}

export async function listVoices(): Promise<TtsVoicesResult> {
  const env = getEnv()
  if (!env.TTS_ENABLED) {
    return { enabled: false, voices: [] }
  }

  const url = buildUrl(env.TTS_VOICES_PATH)
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TTS voices request failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const voices = extractVoices(data)
  return { enabled: true, voices }
}

export async function synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
  const env = getEnv()
  if (!env.TTS_ENABLED) {
    throw new Error('TTS is not enabled')
  }

  if (opts.text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`)
  }

  const url = buildUrl(env.TTS_GENERATE_PATH)
  const requestedVoice = opts.voice?.trim()
  const defaultVoice = env.TTS_DEFAULT_VOICE.trim()
  const initialVoice = requestedVoice || defaultVoice || undefined
  const synthesizeWithVoice = (voice: string | undefined) => fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: opts.text,
      ...(voice ? { voice } : {}),
      format: opts.format ?? 'wav',
    }),
  })

  let res = await synthesizeWithVoice(initialVoice)

  if (!res.ok && !requestedVoice && res.status === 404) {
    const body = await res.text().catch(() => '')
    if (/voice/i.test(body) && /not found/i.test(body)) {
      const fallbackVoice = voiceIdentifier((await listVoices()).voices[0] ?? {})
      if (fallbackVoice && fallbackVoice !== initialVoice) {
        res = await synthesizeWithVoice(fallbackVoice)
      } else {
        throw new Error(`TTS synthesis failed: ${res.status} ${body.slice(0, 200)}`)
      }
    } else {
      throw new Error(`TTS synthesis failed: ${res.status} ${body.slice(0, 200)}`)
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TTS synthesis failed: ${res.status} ${body.slice(0, 200)}`)
  }

  const contentType = res.headers.get('content-type') ?? 'audio/wav'
  const arrayBuf = await res.arrayBuffer()
  return { contentType, audioBuffer: Buffer.from(arrayBuf) }
}
