import { useState, useRef, useEffect, useCallback } from 'react'
import type { AgentListItem } from '@gateway/shared'
import type { ChatThread, ThreadMessage, MessageMeta } from '../types/chat'
import type { AgentStreamDoneEvent } from '@gateway/shared'
import MessageBubble from '../components/MessageBubble'

interface ChatPageProps {
  activeAgentId: string
  activeAgent: AgentListItem | undefined
  threads: ChatThread[]
  activeThreadId: string | null
  onSetActiveThreadId: (id: string | null) => void
  onCreateThread: (agentId: string, firstMsg: string) => ChatThread
  onAddMessage: (threadId: string, msg: Omit<ThreadMessage, 'id' | 'createdAt'>) => ThreadMessage
  onUpdateLastAssistantMessage: (threadId: string, content: string, meta?: MessageMeta) => void
  onSetThreadMessages: (threadId: string, messages: ThreadMessage[]) => void
}

type SSEEvent =
  | { type: 'token'; token: string }
  | (AgentStreamDoneEvent & { type: 'done' })
  | { type: 'error'; error: string }

export default function ChatPage({
  activeAgentId,
  activeAgent,
  threads,
  activeThreadId,
  onSetActiveThreadId,
  onCreateThread,
  onAddMessage,
  onUpdateLastAssistantMessage,
  onSetThreadMessages,
}: ChatPageProps) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeThread = threads.find((t) => t.id === activeThreadId)
  const messages = activeThread?.messages ?? []

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

  const doStream = useCallback(
    async (
      agentId: string,
      threadId: string,
      messagesToSend: Array<{ role: 'user' | 'assistant'; content: string }>,
    ): Promise<void> => {
      const placeholder = onAddMessage(threadId, { role: 'assistant', content: '' })
      setStreamingMessageId(placeholder.id)
      setIsStreaming(true)

      let accumulated = ''
      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, messages: messagesToSend }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
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
                })
              } else if (event.type === 'error') {
                onUpdateLastAssistantMessage(threadId, `⚠️ ${event.error}`)
              }
            } catch (parseErr) {
              console.warn('[ChatPage] Failed to parse SSE line:', line, parseErr)
            }
          }
        }

        if (!accumulated) {
          onUpdateLastAssistantMessage(threadId, '⚠️ No response received.')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error'
        onUpdateLastAssistantMessage(threadId, `⚠️ ${msg}`)
      } finally {
        setIsStreaming(false)
        setStreamingMessageId(null)
      }
    },
    [onAddMessage, onUpdateLastAssistantMessage],
  )

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = input.trim()
    if (!trimmed || !activeAgentId || isStreaming) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

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

    await doStream(activeAgentId, threadId, messagesToSend)
  }, [
    input,
    activeAgentId,
    activeThreadId,
    isStreaming,
    threads,
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
    await doStream(activeAgentId, activeThreadId, messagesToSend)
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
      await doStream(activeAgentId, activeThreadId, messagesToSend)
    },
    [activeThreadId, activeAgentId, isStreaming, threads, onSetThreadMessages, doStream],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

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
        <header className="flex-shrink-0 flex items-center gap-3 border-b border-gray-800 px-6 py-3 bg-gray-900">
          <span className="text-2xl select-none" aria-hidden="true">
            {activeAgent.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold truncate">{activeAgent.name}</h1>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                {activeAgent.costClass}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">
              {activeAgent.model} · {activeAgent.providerName}
              {activeAgent.enableReasoning && (
                <span className="ml-2 text-amber-400">reasoning</span>
              )}
            </p>
          </div>
        </header>
      ) : (
        <header className="flex-shrink-0 border-b border-gray-800 px-6 py-3 text-sm text-gray-500 bg-gray-900">
          Select an agent to begin
        </header>
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
          />
        ))}
        <div ref={messagesEndRef} />
      </section>

      {/* Input bar */}
      <footer className="flex-shrink-0 border-t border-gray-800 p-4 bg-gray-950">
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded-xl bg-gray-900 border border-gray-700 px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-y-auto leading-relaxed"
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
          <button
            onClick={() => { void handleSend() }}
            disabled={!input.trim() || !activeAgentId || isStreaming}
            className="px-4 py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {isStreaming ? (
              <span className="animate-pulse">…</span>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </footer>
    </main>
  )
}
