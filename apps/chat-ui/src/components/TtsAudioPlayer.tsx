import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { synthesizeSpeechToBase64 } from '../api/tts'
import { speakText } from '../utils/speechUtils'

interface TtsAudioPlayerProps {
  text: string
  ttsEnabled: boolean
  voice?: string
  audioBase64?: string
  onAudioStored?: (base64: string) => void
}

// Fixed waveform shape — gives a natural-looking audio visualization
const WAVEFORM_HEIGHTS = [30, 55, 75, 45, 90, 60, 40, 80, 50, 70, 35, 85, 55, 65, 45, 80, 40, 60, 50, 70]

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TtsAudioPlayer({
  text,
  ttsEnabled,
  voice,
  audioBase64,
  onAudioStored,
}: TtsAudioPlayerProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const audioSrc = useMemo(
    () => (audioBase64 ? `data:audio/wav;base64,${audioBase64}` : null),
    [audioBase64],
  )

  // Track previous audioSrc to detect when audio is newly synthesized vs. pre-loaded
  const prevAudioSrcRef = useRef<string | null>(audioSrc)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const playFromSrc = useCallback((src: string) => {
    const audio = new Audio(src)
    audioRef.current = audio

    audio.onloadedmetadata = () => setDuration(audio.duration)
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime)
    audio.onended = () => {
      setState('idle')
      setCurrentTime(0)
    }
    audio.onerror = () => setState('error')
    audio.play().then(() => setState('playing')).catch(() => setState('error'))
  }, [])

  // Auto-play when audio is newly synthesized (not pre-loaded from a saved session)
  useEffect(() => {
    const prev = prevAudioSrcRef.current
    prevAudioSrcRef.current = audioSrc
    if (audioSrc && !prev) {
      playFromSrc(audioSrc)
    }
  }, [audioSrc, playFromSrc])

  const handleClick = useCallback(async () => {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('idle')
      return
    }
    if (state === 'loading') return

    if (audioSrc) {
      playFromSrc(audioSrc)
      return
    }

    if (!ttsEnabled) {
      speakText(text)
      return
    }

    setState('loading')
    try {
      const { base64, mimeType } = await synthesizeSpeechToBase64(text, voice)
      onAudioStored?.(base64)
      playFromSrc(`data:${mimeType};base64,${base64}`)
    } catch (err) {
      console.error('[TtsAudioPlayer] Failed to synthesize speech', err)
      setState('error')
    }
  }, [state, audioSrc, ttsEnabled, text, voice, playFromSrc, onAudioStored])

  const progress = duration > 0 ? currentTime / duration : 0
  const playedBars = Math.round(progress * WAVEFORM_HEIGHTS.length)

  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
      {/* Play / Pause / Loading button */}
      <button
        onClick={() => { void handleClick() }}
        disabled={state === 'loading'}
        title={
          state === 'playing' ? 'Pause'
            : state === 'loading' ? 'Synthesizing…'
              : state === 'error' ? 'Retry'
                : 'Play audio'
        }
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors touch-manipulation ${
          state === 'playing'
            ? 'bg-blue-600 hover:bg-blue-500'
            : state === 'loading'
              ? 'bg-gray-600 cursor-wait'
              : state === 'error'
                ? 'bg-red-900 hover:bg-red-800'
                : 'bg-gray-600 hover:bg-gray-500'
        }`}
      >
        {state === 'loading' ? (
          <span className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        ) : state === 'playing' ? (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : state === 'error' ? (
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-gray-200 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Waveform bars */}
      <div className="flex-1 flex items-center gap-px h-7">
        {WAVEFORM_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className={`flex-1 rounded-full transition-colors ${
              state === 'playing' && i < playedBars
                ? 'bg-blue-400'
                : audioBase64
                  ? 'bg-blue-500/40'
                  : 'bg-gray-500/50'
            } ${state === 'playing' ? 'tts-bar-active' : ''}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>

      {/* Time display */}
      <span className="flex-shrink-0 text-xs text-gray-400 font-mono w-9 text-right tabular-nums">
        {duration > 0
          ? formatTime(state === 'playing' ? currentTime : duration)
          : '—'}
      </span>
    </div>
  )
}
