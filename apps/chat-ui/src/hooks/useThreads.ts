import { useState, useCallback, useEffect } from 'react'
import type { ChatThread, ThreadMessage, MessageMeta } from '../types/chat'

const STORAGE_KEY = 'gateway-chat-threads'

function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ChatThread[]) : []
  } catch (err) {
    console.warn('[useThreads] Failed to load threads from localStorage:', err)
    return []
  }
}

export function useThreads() {
  const [threads, setThreadsState] = useState<ChatThread[]>(() => loadThreads())
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads))
    } catch {
      // localStorage might be unavailable in some environments
    }
  }, [threads])

  const setThreads = useCallback(
    (updater: (prev: ChatThread[]) => ChatThread[]) => {
      setThreadsState(updater)
    },
    [],
  )

  const createThread = useCallback(
    (agentId: string, firstUserMessage: string): ChatThread => {
      const thread: ChatThread = {
        id: crypto.randomUUID(),
        agentId,
        title: firstUserMessage.slice(0, 60),
        createdAt: Date.now(),
        messages: [],
      }
      setThreads((prev) => [thread, ...prev])
      return thread
    },
    [setThreads],
  )

  const addMessage = useCallback(
    (threadId: string, msg: Omit<ThreadMessage, 'id' | 'createdAt'>): ThreadMessage => {
      const message: ThreadMessage = {
        ...msg,
        id: crypto.randomUUID(),
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
    addMessage,
    updateLastAssistantMessage,
    setThreadMessages,
    deleteThread,
    getThread,
  }
}
