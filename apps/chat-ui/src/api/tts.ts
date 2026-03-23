import { apiClient } from './client'

export interface TtsHealthResponse {
  enabled: boolean
  baseUrl: string
  upstreamStatus: number
  error?: string
}

export interface TtsVoice {
  id: string
  name?: string
}

export interface TtsVoicesResponse {
  enabled: boolean
  voices: TtsVoice[]
}

export async function fetchTtsHealth(): Promise<TtsHealthResponse> {
  const { data } = await apiClient.get<TtsHealthResponse>('/tts/health')
  return data
}

export async function fetchTtsVoices(): Promise<TtsVoicesResponse> {
  const { data } = await apiClient.get<TtsVoicesResponse>('/tts/voices')
  return data
}

export async function synthesizeSpeech(
  text: string,
  voice?: string,
  format = 'wav',
): Promise<{ audioUrl: string; revoke: () => void }> {
  const res = await apiClient.post('/tts', { text, voice, format }, { responseType: 'blob' })
  const blob = res.data as Blob
  const audioUrl = URL.createObjectURL(blob)
  return { audioUrl, revoke: () => URL.revokeObjectURL(audioUrl) }
}
