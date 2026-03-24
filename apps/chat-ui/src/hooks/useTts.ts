import { useState, useEffect, useCallback } from 'react'
import { fetchTtsHealth, fetchTtsVoices } from '../api/tts'
import type { TtsVoice } from '../api/tts'

export interface TtsState {
  enabled: boolean
  voices: TtsVoice[]
  selectedVoice: string
  setSelectedVoice: (v: string) => void
  loading: boolean
}

export function useTts(preferredVoice?: string): TtsState {
  const [enabled, setEnabled] = useState(false)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const [loading, setLoading] = useState(true)

  const loadTts = useCallback(async () => {
    try {
      const health = await fetchTtsHealth()
      setEnabled(health.enabled && health.upstreamStatus === 200)

      if (health.enabled && health.upstreamStatus === 200) {
        try {
          const voicesRes = await fetchTtsVoices()
          setVoices(voicesRes.voices)
        } catch {
          // voices not available but TTS might still work
        }
      }
    } catch {
      setEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTts()
  }, [loadTts])

  useEffect(() => {
    if (voices.length === 0) {
      return
    }

    setSelectedVoice((current) => {
      if (current && voices.some((voice) => voice.id === current)) {
        return current
      }
      if (preferredVoice && voices.some((voice) => voice.id === preferredVoice)) {
        return preferredVoice
      }
      return voices[0]?.id ?? current
    })
  }, [voices, preferredVoice])

  return { enabled, voices, selectedVoice, setSelectedVoice, loading }
}
