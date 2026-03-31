import { useState, useCallback, useEffect } from 'react'
import type { ChatThread, ThreadMessage, MessageMeta } from '../types/chat'

function makeId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID()
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function loadThreads(storageKey: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as ChatThread[]) : []
  } catch (err) {
    console.warn('[useThreads] Failed to load threads from localStorage:', err)
    return []
  }
}

export function useThreads(scopeKey: string) {
  const storageKey = `gateway-chat-threads:${scopeKey}`
  const [threads, setThreadsState] = useState<ChatThread[]>(() => loadThreads(storageKey))
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(threads))
    } catch {
      // localStorage might be unavailable in some environments
    }
  }, [threads, storageKey])

  const setThreads = useCallback(
    (updater: (prev: ChatThread[]) => ChatThread[]) => {
      setThreadsState(updater)
    },
    [],
  )

  const createThread = useCallback(
    (agentId: string, firstUserMessage: string): ChatThread => {
      const thread: ChatThread = {
        id: makeId(),
        agentId,
        title: firstUserMessage.slice(0, 60),
        createdAt: Date.now(),
        messages: [],
        ttsEnabled: true,
      }
      setThreads((prev) => [thread, ...prev])
      return thread
    },
    [setThreads],
  )

  const upsertThread = useCallback(
    (thread: ChatThread): ChatThread => {
      setThreads((prev) => {
        const existing = prev.find((item) => item.id === thread.id)
        if (!existing) {
          return [thread, ...prev]
        }
        return prev.map((item) =>
          item.id === thread.id
            ? {
                ...existing,
                ...thread,
                messages: existing.messages,
              }
            : item,
        )
      })
      return thread
    },
    [setThreads],
  )

  const addMessage = useCallback(
    (threadId: string, msg: Omit<ThreadMessage, 'id' | 'createdAt'>): ThreadMessage => {
      const message: ThreadMessage = {
        ...msg,
        id: makeId(),
        createdAt: Date.now(),
      }
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, messages: [...t.messages, message] } : t,
        ),
      )
      return message
    },
    [setThreads],
  )

  const updateLastAssistantMessage = useCallback(
    (threadId: string, content: string, meta?: MessageMeta): void => {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t
          const messages = [...t.messages]
          const lastIdx = messages.length - 1
          if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
            messages[lastIdx] = { ...messages[lastIdx], content, ...(meta ? { meta } : {}) }
          }
          return { ...t, messages }
        }),
      )
    },
    [setThreads],
  )

  const setThreadMessages = useCallback(
    (threadId: string, messages: ThreadMessage[]): void => {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, messages } : t)),
      )
    },
    [setThreads],
  )

  const deleteThread = useCallback(
    (threadId: string): void => {
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      setActiveThreadId((prev) => (prev === threadId ? null : prev))
    },
    [setThreads],
  )

  const updateMessageTtsAudio = useCallback(
    (threadId: string, messageId: string, audioBase64: string): void => {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t
          return {
            ...t,
            messages: t.messages.map((m) =>
              m.id === messageId ? { ...m, ttsAudioBase64: audioBase64 } : m,
            ),
          }
        }),
      )
    },
    [setThreads],
  )

  const setThreadTtsEnabled = useCallback(
    (threadId: string, enabled: boolean): void => {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, ttsEnabled: enabled } : t)),
      )
    },
    [setThreads],
  )

  const getThread = useCallback(
    (threadId: string): ChatThread | undefined => {
      return threads.find((t) => t.id === threadId)
    },
    [threads],
  )

  return {
    threads,
    activeThreadId,
    setActiveThreadId,
    createThread,
    upsertThread,
    addMessage,
    updateLastAssistantMessage,
    updateMessageTtsAudio,
    setThreadTtsEnabled,
    setThreadMessages,
    deleteThread,
    getThread,
  }
}
