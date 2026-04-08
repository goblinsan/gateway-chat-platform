import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { AgentListItem } from '@gateway/shared'
import type { ChatThread, ThreadMessage, MessageMeta } from '../types/chat'
import type { AgentStreamDoneEvent } from '@gateway/shared'
import MessageBubble from '../components/MessageBubble'
import ComparePanel from '../components/ComparePanel'
import HandoffModal from '../components/HandoffModal'
import PromptLibrary from '../components/PromptLibrary'
import FileAttachment from '../components/FileAttachment'
import MicButton from '../components/SpeechControls'
import ModelPicker from '../components/ModelPicker'
import { useTts } from '../hooks/useTts'
import { synthesizeSpeechToBase64 } from '../api/tts'

interface ChatPageProps {
  activeAgentId: string
  activeAgent: AgentListItem | undefined
  agents: AgentListItem[]
  threads: ChatThread[]
  activeThreadId: string | null
  onSetActiveThreadId: (id: string | null) => void
  onCreateThread: (agentId: string, firstMsg: string) => ChatThread
  onAddMessage: (threadId: string, msg: Omit<ThreadMessage, 'id' | 'createdAt'>) => ThreadMessage
  onUpdateLastAssistantMessage: (threadId: string, content: string, meta?: MessageMeta) => void
  onSetThreadMessages: (threadId: string, messages: ThreadMessage[]) => void
  onUpdateMessageTtsAudio: (threadId: string, messageId: string, audioBase64: string) => void
  onSetThreadTtsEnabled: (threadId: string, enabled: boolean) => void
  onSetThreadDefaultModel: (threadId: string, defaultModel: string | undefined) => void
}

type SSEEvent =
  | { type: 'token'; token: string }
  | (AgentStreamDoneEvent & { type: 'done' })
  | { type: 'error'; error: string }

export default function ChatPage({
  activeAgentId,
  activeAgent,
  agents,
  threads,
  activeThreadId,
  onSetActiveThreadId,
  onCreateThread,
  onAddMessage,
  onUpdateLastAssistantMessage,
  onSetThreadMessages,
  onUpdateMessageTtsAudio,
  onSetThreadTtsEnabled,
  onSetThreadDefaultModel,
}: ChatPageProps) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareResults, setCompareResults] = useState<Array<{ provider: string; model: string; content: string; latencyMs: number; error?: string }>>([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [showHandoff, setShowHandoff] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  // Per-message model override: cleared after each send (Issue #95)
  const [messageModelOverride, setMessageModelOverride] = useState<string | undefined>(undefined)
  const tts = useTts(activeAgent?.ttsVoiceId)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep a ref to the active thread's TTS state so doStream doesn't need threads in its deps
  const activeThreadTtsRef = useRef<{ enabled: boolean; voice: string }>({ enabled: false, voice: '' })
  useEffect(() => {
    const thread = threads.find((t) => t.id === activeThreadId)
    activeThreadTtsRef.current = {
      enabled: (thread?.ttsEnabled ?? false) && tts.enabled,
      voice: tts.selectedVoice,
    }
  }, [threads, activeThreadId, tts.enabled, tts.selectedVoice])

  const messages = useMemo(
    () => threads.find((t) => t.id === activeThreadId)?.messages ?? [],
    [threads, activeThreadId],
  )

  // Auto-scroll to bottom during streaming and when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingMessageId])

  // Auto-grow textarea
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  const toggleCompareMode = useCallback(() => {
    setCompareMode((v) => !v)
    setCompareResults([])
  }, [])

  const doStream = useCallback(
    async (
      agentId: string,
      threadId: string,
      messagesToSend: Array<{ role: 'user' | 'assistant'; content: string }>,
      modelOverride?: string,
    ): Promise<void> => {
      const placeholder = onAddMessage(threadId, { role: 'assistant', content: '' })
      setStreamingMessageId(placeholder.id)
      setIsStreaming(true)

      let accumulated = ''
      let errorReceived = false
      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            threadId,
            messages: messagesToSend,
            ...(modelOverride ? { modelOverride } : {}),
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        let reading = true
        while (reading) {
          const { done, value } = await reader.read()
          if (done) { reading = false; break }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent
              if (event.type === 'token') {
                accumulated += event.token
                onUpdateLastAssistantMessage(threadId, accumulated)
              } else if (event.type === 'done') {
                onUpdateLastAssistantMessage(threadId, accumulated, {
                  model: event.model,
                  usedProvider: event.usedProvider,
                  latencyMs: event.latencyMs,
                  usage: event.usage,
                  routingExplanation: event.routingExplanation,
                })
              } else if (event.type === 'error') {
                errorReceived = true
                onUpdateLastAssistantMessage(threadId, `⚠️ ${event.error}`)
              }
            } catch (parseErr) {
              console.warn('[ChatPage] Failed to parse SSE line:', line, parseErr)
            }
          }
        }

        if (!accumulated && !errorReceived) {
          onUpdateLastAssistantMessage(threadId, '⚠️ No response received.')
        }

        // Auto-synthesize TTS if enabled for this thread and we got a successful response
        if (accumulated && !errorReceived && activeThreadTtsRef.current.enabled) {
          synthesizeSpeechToBase64(accumulated, activeThreadTtsRef.current.voice).then(({ base64 }) => {
            onUpdateMessageTtsAudio(threadId, placeholder.id, base64)
          }).catch((err) => {
            console.warn('[ChatPage] Auto-TTS synthesis failed', err)
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error'
        onUpdateLastAssistantMessage(threadId, `⚠️ ${msg}`)
      } finally {
        setIsStreaming(false)
        setStreamingMessageId(null)
      }
    },
    [onAddMessage, onUpdateLastAssistantMessage, onUpdateMessageTtsAudio],
  )

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = input.trim()
    if (!trimmed || !activeAgentId || isStreaming) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Resolve model override: per-message takes priority, then thread default (Issue #95)
    const activeThread = threads.find((t) => t.id === activeThreadId)
    const effectiveModelOverride = messageModelOverride ?? activeThread?.defaultModel
    // Clear the per-message override after consuming it
    setMessageModelOverride(undefined)

    let threadId = activeThreadId
    let messagesToSend: Array<{ role: 'user' | 'assistant'; content: string }>

    if (!threadId) {
      const thread = onCreateThread(activeAgentId, trimmed)
      threadId = thread.id
      onSetActiveThreadId(threadId)
      messagesToSend = [{ role: 'user', content: trimmed }]
      onAddMessage(threadId, { role: 'user', content: trimmed })
    } else {
      const currentThread = threads.find((t) => t.id === threadId)
      const existingMsgs = currentThread
        ? currentThread.messages.map((m) => ({ role: m.role, content: m.content }))
        : []
      messagesToSend = [...existingMsgs, { role: 'user', content: trimmed }]
      onAddMessage(threadId, { role: 'user', content: trimmed })
    }

    await doStream(activeAgentId, threadId, messagesToSend, effectiveModelOverride)
  }, [
    input,
    activeAgentId,
    activeThreadId,
    isStreaming,
    threads,
    messageModelOverride,
    onCreateThread,
    onSetActiveThreadId,
    onAddMessage,
    doStream,
  ])

  const handleRegenerate = useCallback(async (): Promise<void> => {
    if (!activeThreadId || !activeAgentId || isStreaming) return
    const thread = threads.find((t) => t.id === activeThreadId)
    if (!thread) return

    const lastUserIdx = [...thread.messages].reduce(
      (acc, m, i) => (m.role === 'user' ? i : acc),
      -1,
    )
    if (lastUserIdx === -1) return

    const truncated = thread.messages.slice(0, lastUserIdx + 1)
    onSetThreadMessages(activeThreadId, truncated)

    const messagesToSend = truncated.map((m) => ({ role: m.role, content: m.content }))
    await doStream(activeAgentId, activeThreadId, messagesToSend, thread.defaultModel)
  }, [activeThreadId, activeAgentId, isStreaming, threads, onSetThreadMessages, doStream])

  const handleEditResend = useCallback(
    async (messageId: string, newContent: string): Promise<void> => {
      if (!activeThreadId || !activeAgentId || isStreaming) return
      const thread = threads.find((t) => t.id === activeThreadId)
      if (!thread) return

      const msgIdx = thread.messages.findIndex((m) => m.id === messageId)
      if (msgIdx === -1) return

      const truncated = [
        ...thread.messages.slice(0, msgIdx),
        { ...thread.messages[msgIdx], content: newContent },
      ]
      onSetThreadMessages(activeThreadId, truncated)

      const messagesToSend = truncated.map((m) => ({ role: m.role, content: m.content }))
      await doStream(activeAgentId, activeThreadId, messagesToSend, thread.defaultModel)
    },
    [activeThreadId, activeAgentId, isStreaming, threads, onSetThreadMessages, doStream],
  )

  const handleCompare = useCallback(async (): Promise<void> => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    setCompareLoading(true)
    setCompareResults([])
    try {
      const res = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: trimmed }] }),
      })
      if (res.ok) {
        const data = await res.json() as { results: Array<{ provider: string; model: string; content: string; latencyMs: number; error?: string }> }
        setCompareResults(data.results)
      }
    } catch (err) {
      console.warn('[ChatPage] Compare failed:', err)
    } finally {
      setCompareLoading(false)
    }
  }, [input, isStreaming])

  const handleHandoffConfirm = useCallback(async (toAgentId: string): Promise<void> => {
    if (!activeThreadId || !activeAgentId) return
    const thread = threads.find((t) => t.id === activeThreadId)
    if (!thread) return

    const messagesToSend = thread.messages.map((m) => ({ role: m.role, content: m.content }))
    try {
      await fetch('/api/chat/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAgentId: activeAgentId, toAgentId, messages: messagesToSend }),
      })
    } catch (err) {
      console.warn('[ChatPage] Handoff failed:', err)
    }
    setShowHandoff(false)
  }, [activeThreadId, activeAgentId, threads])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  const activeThread = threads.find((t) => t.id === activeThreadId)
  const threadTtsEnabled = activeThread?.ttsEnabled ?? false
  const threadDefaultModel = activeThread?.defaultModel

  const handleToggleThreadTts = useCallback(() => {
    if (!activeThreadId) return
    onSetThreadTtsEnabled(activeThreadId, !threadTtsEnabled)
  }, [activeThreadId, threadTtsEnabled, onSetThreadTtsEnabled])

  const handleSetThreadDefaultModel = useCallback((model: string | undefined) => {
    if (!activeThreadId) return
    onSetThreadDefaultModel(activeThreadId, model)
  }, [activeThreadId, onSetThreadDefaultModel])

  const isLastAssistantMessage = useCallback(
    (message: ThreadMessage): boolean => {
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
      return lastAssistant?.id === message.id
    },
    [messages],
  )

  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Active agent header */}
      {activeAgent ? (
        <header className="flex-shrink-0 flex items-center gap-2 border-b border-gray-800 px-4 py-3 bg-gray-900">
          <span className="text-2xl select-none" aria-hidden="true">
            {activeAgent.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold truncate">{activeAgent.name}</h1>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hidden sm:inline">
                {activeAgent.costClass}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate hidden sm:block">
              {activeAgent.model} · {activeAgent.providerName}
              {activeAgent.enableReasoning && (
                <span className="ml-2 text-amber-400">reasoning</span>
              )}
            </p>
          </div>
          {/* Per-thread default model picker (Issue #95) */}
          {activeThreadId && (
            <ModelPicker
              value={threadDefaultModel}
              agentModel={activeAgent.model}
              onChange={handleSetThreadDefaultModel}
              disabled={isStreaming}
              label={threadDefaultModel ?? activeAgent.model}
            />
          )}
          {activeThreadId && messages.length > 0 && (
            <button
              onClick={() => setShowHandoff(true)}
              className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors min-h-[40px]"
              title="Hand off conversation"
            >
              🔄 <span className="hidden sm:inline">Hand off</span>
            </button>
          )}
          {/* Per-thread TTS toggle */}
          {tts.enabled && (
            <button
              onClick={handleToggleThreadTts}
              disabled={!activeThreadId}
              className={`flex items-center gap-1 px-2 py-2 rounded-lg text-sm transition-colors min-h-[40px] disabled:opacity-40 ${
                threadTtsEnabled
                  ? 'bg-blue-700 text-white hover:bg-blue-600'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title={threadTtsEnabled ? 'TTS on — click to disable' : 'TTS off — click to enable'}
            >
              {threadTtsEnabled ? '🔊' : '🔇'}
            </button>
          )}
        </header>
      ) : (
        <header className="flex-shrink-0 border-b border-gray-800 px-4 py-3 text-sm text-gray-500 bg-gray-900">
          Select an agent to begin
        </header>
      )}

      {/* Compare results panel */}
      {compareMode && (
        <ComparePanel results={compareResults} isLoading={compareLoading} />
      )}

      {/* Message list */}
      <section className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-5xl mb-4 select-none" aria-hidden="true">
              {activeAgent?.icon ?? '💬'}
            </span>
            <p className="text-gray-400 text-sm">
              {activeAgent
                ? `Start a conversation with ${activeAgent.name}`
                : 'Select an agent to begin…'}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={msg.id === streamingMessageId}
            agentIcon={msg.role === 'assistant' ? activeAgent?.icon : undefined}
            ttsEnabled={tts.enabled}
            ttsVoice={tts.selectedVoice}
            ttsActive={threadTtsEnabled}
            onCopy={() => { /* handled inside MessageBubble */ }}
            onRegenerate={
              msg.role === 'assistant' && isLastAssistantMessage(msg) && !isStreaming
                ? () => { void handleRegenerate() }
                : undefined
            }
            onEditResend={
              msg.role === 'user'
                ? (newContent) => { void handleEditResend(msg.id, newContent) }
                : undefined
            }
            onAudioStored={
              msg.role === 'assistant' && activeThreadId
                ? (base64) => onUpdateMessageTtsAudio(activeThreadId, msg.id, base64)
                : undefined
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </section>

      {/* Input bar */}
      <footer className="flex-shrink-0 border-t border-gray-800 p-3 bg-gray-950">
        <div className="flex items-center gap-2 mb-2">
          <FileAttachment threadId={activeThreadId} />
          <div className="flex-1" />
          {/* Per-message model override picker (Issue #95) */}
          {activeAgentId && activeAgent && (
            <ModelPicker
              value={messageModelOverride}
              agentModel={threadDefaultModel ?? activeAgent.model}
              onChange={setMessageModelOverride}
              disabled={isStreaming}
              label={messageModelOverride ? messageModelOverride : '🧠 Once'}
            />
          )}
          <button
            type="button"
            onClick={() => setShowPromptLibrary((v) => !v)}
            className="text-sm text-gray-500 hover:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            title="Prompt library"
          >
            📚
          </button>
          <button
            type="button"
            onClick={toggleCompareMode}
            className={`text-sm px-3 py-2 rounded-lg transition-colors min-h-[40px] flex items-center gap-1 ${compareMode ? 'bg-indigo-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
            title="Compare mode"
          >
            ⊞ <span className="hidden sm:inline">Compare</span>
          </button>
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded-2xl bg-gray-900 border border-gray-700 px-4 py-3 text-base md:text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-y-auto leading-relaxed"
            placeholder={
              activeAgent ? `Message ${activeAgent.name}…` : 'Select an agent first…'
            }
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              adjustTextarea()
            }}
            onKeyDown={handleKeyDown}
            disabled={!activeAgentId || isStreaming}
            style={{ maxHeight: '160px' }}
          />
          <MicButton onResult={(text) => setInput((prev) => prev + text)} disabled={!activeAgentId || isStreaming} />
          {compareMode ? (
            <button
              onClick={() => { void handleCompare() }}
              disabled={!input.trim() || !activeAgentId || compareLoading}
              className="w-12 h-12 rounded-full bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 flex items-center justify-center touch-manipulation"
            >
              {compareLoading ? <span className="animate-pulse text-lg">…</span> : '⊞'}
            </button>
          ) : (
            <button
              onClick={() => { void handleSend() }}
              disabled={!input.trim() || !activeAgentId || isStreaming}
              className="w-12 h-12 rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 flex items-center justify-center touch-manipulation"
            >
              {isStreaming ? (
                <span className="animate-pulse text-lg">…</span>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          )}
        </div>
      </footer>

      {showHandoff && activeAgent && (
        <HandoffModal
          currentAgentId={activeAgentId}
          agents={agents}
          onConfirm={(toAgentId) => { void handleHandoffConfirm(toAgentId) }}
          onClose={() => setShowHandoff(false)}
        />
      )}

      {showPromptLibrary && (
        <PromptLibrary
          onUse={(prompt) => setInput((prev) => prev + prompt)}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </main>
  )
}
