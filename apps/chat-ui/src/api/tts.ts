import axios from 'axios'
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

export async function synthesizeSpeechToBase64(
  text: string,
  voice?: string,
  format = 'wav',
): Promise<{ base64: string; mimeType: string }> {
  const { audioUrl, revoke } = await synthesizeSpeech(text, voice, format)
  try {
    const response = await fetch(audioUrl)
    const blob = await response.blob()
    return await new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        revoke()
        const dataUrl = reader.result as string
        const comma = dataUrl.indexOf(',')
        const header = dataUrl.slice(0, comma)
        const base64 = dataUrl.slice(comma + 1)
        const mimeType = header.match(/:(.*?);/)?.[1] ?? 'audio/wav'
        resolve({ base64, mimeType })
      }
      reader.onerror = () => {
        revoke()
        reject(new Error('Failed to read audio blob'))
      }
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    revoke()
    throw err
  }
}
export async function synthesizeSpeech(
  text: string,
  voice?: string,
  format = 'wav',
): Promise<{ audioUrl: string; revoke: () => void }> {
  try {
    const res = await apiClient.post('/tts', { text, voice, format }, { responseType: 'blob' })
    const blob = res.data as Blob
    const audioUrl = URL.createObjectURL(blob)
    return { audioUrl, revoke: () => URL.revokeObjectURL(audioUrl) }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const responseData = error.response?.data
      if (responseData instanceof Blob) {
        const text = await responseData.text().catch(() => '')
        if (text) {
          try {
            const parsed = JSON.parse(text) as { error?: string; message?: string }
            throw new Error(parsed.error || parsed.message || `TTS request failed with status ${status ?? 'unknown'}`)
          } catch {
            throw new Error(text)
          }
        }
      }
      throw new Error(`TTS request failed with status ${status ?? 'unknown'}`)
    }
    throw error
  }
}
