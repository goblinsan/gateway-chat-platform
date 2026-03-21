import { useCallback, useRef, useState } from 'react'
import {
  hasSpeechRecognition,
  getSpeechRecognitionClass,
  type SpeechRecognitionInstance,
  type SpeechRecognitionEventLike,
} from '../utils/speechUtils'

function useSpeechInput(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const startListening = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognitionClass()
    if (!SpeechRecognitionClass) return

    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }

    const recognition = new SpeechRecognitionClass()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ''
      if (transcript) onResult(transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [onResult])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  return { isListening, startListening, stopListening }
}

interface MicButtonProps {
  onResult: (text: string) => void
  disabled?: boolean
}

export default function MicButton({ onResult, disabled }: MicButtonProps) {
  const { isListening, startListening, stopListening } = useSpeechInput(onResult)

  if (!hasSpeechRecognition()) return null

  return (
    <button
      type="button"
      onClick={isListening ? stopListening : startListening}
      disabled={disabled}
      title={isListening ? 'Stop listening' : 'Start voice input'}
      className={`px-3 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
        isListening
          ? 'bg-red-600 text-white hover:bg-red-500 animate-pulse'
          : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
      </svg>
    </button>
  )
}
