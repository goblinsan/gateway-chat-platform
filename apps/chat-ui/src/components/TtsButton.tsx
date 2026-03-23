import { useState, useRef, useCallback, useEffect } from 'react'
import { synthesizeSpeech } from '../api/tts'
import { speakText } from '../utils/speechUtils'

interface TtsButtonProps {
  text: string
  ttsEnabled: boolean
  voice?: string
}

export default function TtsButton({ text, ttsEnabled, voice }: TtsButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
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
        setState('idle')
        // Fall back to browser speech on playback error
        speakText(text)
      }

      await audio.play()
      setState('playing')
    } catch {
      setState('idle')
      // Fall back to browser speech if server TTS fails
      speakText(text)
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
            : 'text-gray-500 hover:text-gray-300'
      }`}
      title={
        state === 'playing' ? 'Stop' : state === 'loading' ? 'Synthesizing…' : 'Read aloud'
      }
      disabled={state === 'loading'}
    >
      {state === 'playing' ? '⏹' : '🔊'}
    </button>
  )
}
