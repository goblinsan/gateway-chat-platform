import { useState, useRef, useCallback, useEffect } from 'react'
import { synthesizeSpeech } from '../api/tts'
import { speakText } from '../utils/speechUtils'

interface TtsButtonProps {
  text: string
  ttsEnabled: boolean
  voice?: string
}

export default function TtsButton({ text, ttsEnabled, voice }: TtsButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const revokeRef = useRef<(() => void) | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      revokeRef.current?.()
    }
  }, [])

  const handleClick = useCallback(async () => {
    // If playing, stop
    if (state === 'playing') {
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.currentTime = 0
      setState('idle')
      return
    }

    // If loading, ignore
    if (state === 'loading') return

    // If server TTS is not enabled, fall back to browser speech
    if (!ttsEnabled) {
      speakText(text)
      return
    }

    setState('loading')
    try {
      // Revoke any previous object URL
      revokeRef.current?.()

      const { audioUrl, revoke } = await synthesizeSpeech(text, voice)
      revokeRef.current = revoke

      const audio = new Audio(audioUrl)
      audioRef.current = audio

      audio.onended = () => setState('idle')
      audio.onerror = () => {
        setState('error')
      }

      await audio.play()
      setState('playing')
    } catch (error) {
      console.error('[TtsButton] Server TTS failed', error)
      setState('error')
    }
  }, [state, text, ttsEnabled, voice])

  return (
    <button
      onClick={() => { void handleClick() }}
      className={`flex items-center gap-1 text-xs transition-colors ${
        state === 'playing'
          ? 'text-blue-400 hover:text-blue-300'
          : state === 'loading'
            ? 'text-yellow-400 animate-pulse cursor-wait'
            : state === 'error'
              ? 'text-red-400 hover:text-red-300'
              : 'text-gray-500 hover:text-gray-300'
      }`}
      title={
        state === 'playing'
          ? 'Stop'
          : state === 'loading'
            ? 'Synthesizing…'
            : state === 'error'
              ? 'Server TTS failed'
              : 'Read aloud'
      }
      disabled={state === 'loading'}
    >
      {state === 'playing' ? '⏹' : state === 'error' ? '⚠️' : '🔊'}
    </button>
  )
}
