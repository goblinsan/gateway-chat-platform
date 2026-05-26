import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatThread, ThreadMessage, MessageMeta } from '../types/chat'

interface ThreadsResponse {
  threads?: Array<{
    id: string
    title: string
    created_at: string
    updated_at: string
    message_count: number
    last_snippet?: string
    last_agent_id?: string
  }>
}

interface ThreadDetailResponse {
  threadId?: string
  thread_id?: string
  messages?: Array<{
    role: 'user' | 'assistant'
    content: string
    created_at: string
    run_id?: string
    agent_id?: string
  }>
}

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

function parseTimestamp(value?: string, fallback = Date.now()): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function makeServerMessageId(
  threadId: string,
  index: number,
  message: { role: 'user' | 'assistant'; content: string; created_at?: string },
): string {
  return `${threadId}:${index}:${message.role}:${message.created_at ?? 'unknown'}`
}

function mapServerMessages(
  threadId: string,
  messages: NonNullable<ThreadDetailResponse['messages']>,
): ThreadMessage[] {
  return messages.map((message, index) => ({
    id: makeServerMessageId(threadId, index, message),
    role: message.role,
    content: message.content,
    createdAt: parseTimestamp(message.created_at),
  }))
}

function mergeServerThreads(
  prev: ChatThread[],
  response: ThreadsResponse,
): ChatThread[] {
  const previousById = new Map(prev.map((thread) => [thread.id, thread]))
  const serverIds = new Set<string>()
  const serverThreads = (response.threads ?? []).map((thread) => {
    serverIds.add(thread.id)
    const existing = previousById.get(thread.id)
    return {
      id: thread.id,
      agentId: thread.last_agent_id ?? existing?.agentId ?? '',
      title: thread.title || existing?.title || 'Conversation',
      createdAt: parseTimestamp(thread.updated_at || thread.created_at),
      messages: existing?.messages ?? [],
      ttsEnabled: existing?.ttsEnabled ?? true,
      defaultModel: existing?.defaultModel,
    } satisfies ChatThread
  })

  const localOnlyThreads = prev.filter(
    (thread) => !serverIds.has(thread.id) && (thread.messages.length > 0 || thread.id.startsWith('inbox-')),
  )

  return [...serverThreads, ...localOnlyThreads].sort((a, b) => b.createdAt - a.createdAt)
}

export function useThreads(scopeKey: string) {
  const [threads, setThreadsState] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const loadedThreadIdsRef = useRef<Set<string>>(new Set())
  const inflightThreadIdsRef = useRef<Set<string>>(new Set())

  const setThreads = useCallback(
    (updater: (prev: ChatThread[]) => ChatThread[]) => {
      setThreadsState(updater)
    },
    [],
  )

  const refreshThreads = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/threads')
      if (!response.ok) {
        throw new Error(`Failed to load threads (${response.status})`)
      }
      const payload = (await response.json()) as ThreadsResponse
      setThreadsState((prev) => mergeServerThreads(prev, payload))
    } catch (err) {
      console.warn('[useThreads] Failed to refresh threads:', err)
    }
  }, [])

  const hydrateThread = useCallback(
    async (threadId: string): Promise<void> => {
      if (loadedThreadIdsRef.current.has(threadId) || inflightThreadIdsRef.current.has(threadId)) {
        return
      }

      const existing = threads.find((thread) => thread.id === threadId)
      if (!existing || existing.messages.length > 0 || threadId.startsWith('inbox-')) {
        loadedThreadIdsRef.current.add(threadId)
        return
      }

      inflightThreadIdsRef.current.add(threadId)
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`)
        if (response.status === 404) {
          return
        }
        if (!response.ok) {
          throw new Error(`Failed to load thread (${response.status})`)
        }
        const payload = (await response.json()) as ThreadDetailResponse
        const resolvedThreadId = payload.threadId ?? payload.thread_id ?? threadId
        const messages = mapServerMessages(resolvedThreadId, payload.messages ?? [])
        loadedThreadIdsRef.current.add(resolvedThreadId)
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === threadId || thread.id === resolvedThreadId
              ? {
                  ...thread,
                  id: resolvedThreadId,
                  agentId:
                    thread.agentId ||
                    (payload.messages ?? []).find((message) => message.agent_id)?.agent_id ||
                    thread.agentId,
                  messages,
                }
              : thread,
          ),
        )
      } catch (err) {
        console.warn('[useThreads] Failed to hydrate thread:', err)
      } finally {
        inflightThreadIdsRef.current.delete(threadId)
      }
    },
    [setThreads, threads],
  )

  useEffect(() => {
    loadedThreadIdsRef.current = new Set()
    inflightThreadIdsRef.current = new Set()
    setThreadsState([])
    setActiveThreadId(null)
    void refreshThreads()
  }, [refreshThreads, scopeKey])

  useEffect(() => {
    if (!activeThreadId) return
    void hydrateThread(activeThreadId)
  }, [activeThreadId, hydrateThread])

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      void refreshThreads()
      if (activeThreadId) {
        loadedThreadIdsRef.current.delete(activeThreadId)
        void hydrateThread(activeThreadId)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [activeThreadId, hydrateThread, refreshThreads])

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
      loadedThreadIdsRef.current.add(thread.id)
      setThreads((prev) => [thread, ...prev])
      return thread
    },
    [setThreads],
  )

  const upsertThread = useCallback(
    (thread: ChatThread): ChatThread => {
      loadedThreadIdsRef.current.add(thread.id)
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
                messages: thread.messages.length > 0 ? thread.messages : existing.messages,
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
      loadedThreadIdsRef.current.add(threadId)
      const message: ThreadMessage = {
        ...msg,
        id: makeId(),
        createdAt: Date.now(),
      }
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                createdAt: message.createdAt,
                messages: [...thread.messages, message],
              }
            : thread,
        ),
      )
      return message
    },
    [setThreads],
  )

  const updateLastAssistantMessage = useCallback(
    (threadId: string, content: string, meta?: MessageMeta): void => {
      loadedThreadIdsRef.current.add(threadId)
      setThreads((prev) =>
        prev.map((thread) => {
          if (thread.id !== threadId) return thread
          const messages = [...thread.messages]
          const lastIdx = messages.length - 1
          if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
            messages[lastIdx] = { ...messages[lastIdx], content, ...(meta ? { meta } : {}) }
          }
          return { ...thread, messages }
        }),
      )
    },
    [setThreads],
  )

  const setThreadMessages = useCallback(
    (threadId: string, messages: ThreadMessage[]): void => {
      loadedThreadIdsRef.current.add(threadId)
      setThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? { ...thread, messages } : thread)),
      )
    },
    [setThreads],
  )

  const deleteThread = useCallback(
    (threadId: string): void => {
      loadedThreadIdsRef.current.delete(threadId)
      void fetch(`/api/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }).catch((err) => {
        console.warn('[useThreads] Failed to delete thread:', err)
      })
      setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
      setActiveThreadId((prev) => (prev === threadId ? null : prev))
    },
    [setThreads],
  )

  const updateMessageTtsAudio = useCallback(
    (threadId: string, messageId: string, audioBase64: string): void => {
      setThreads((prev) =>
        prev.map((thread) => {
          if (thread.id !== threadId) return thread
          return {
            ...thread,
            messages: thread.messages.map((message) =>
              message.id === messageId ? { ...message, ttsAudioBase64: audioBase64 } : message,
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
        prev.map((thread) => (thread.id === threadId ? { ...thread, ttsEnabled: enabled } : thread)),
      )
    },
    [setThreads],
  )

  const setThreadDefaultModel = useCallback(
    (threadId: string, defaultModel: string | undefined): void => {
      setThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? { ...thread, defaultModel } : thread)),
      )
    },
    [setThreads],
  )

  const getThread = useCallback(
    (threadId: string): ChatThread | undefined => {
      return threads.find((thread) => thread.id === threadId)
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
    setThreadDefaultModel,
    setThreadMessages,
    deleteThread,
    getThread,
  }
}
