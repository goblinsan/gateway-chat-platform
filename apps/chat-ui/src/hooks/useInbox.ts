import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxItem, InboxListResponse } from '@gateway/shared'

export interface ChatInboxScope {
  userId: string
  channelId: string
}

interface NotificationRecord {
  id: string
  user_id: string
  kind: string
  title: string
  body?: string
  thread_id?: string
  payload?: Record<string, unknown>
  read_at?: string
  dismissed_at?: string
  created_at: string
}

async function fetchInbox(scope: ChatInboxScope): Promise<InboxListResponse> {
  const params = new URLSearchParams({ unreadOnly: 'true', limit: '25' })
  const response = await fetch(`/api/notifications?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Inbox request failed (${response.status})`)
  }
  const payload = await response.json() as { notifications?: NotificationRecord[] }
  const notifications = (payload.notifications ?? []).filter((notification) => !notification.dismissed_at)
  const items: InboxItem[] = notifications.map((notification) => {
    const metadata = notification.payload ?? {}
    const agentFromPayload = typeof metadata.agent_id === 'string' ? metadata.agent_id : undefined
    const channelFromPayload = typeof metadata.channel_id === 'string' ? metadata.channel_id : undefined
    return {
      id: notification.id,
      userId: scope.userId,
      channelId: channelFromPayload ?? scope.channelId,
      agentId: agentFromPayload ?? 'agent-service',
      content: notification.body ?? '',
      createdAt: notification.created_at,
      kind: notification.kind,
      threadId: notification.thread_id,
      threadTitle: notification.title,
      title: notification.title,
      metadata,
      read: Boolean(notification.read_at),
    }
  })
  return {
    userId: scope.userId,
    channelId: scope.channelId,
    unreadCount: items.length,
    items,
  }
}

export function useInbox(scope: ChatInboxScope) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await fetchInbox(scope)
      setItems(payload.items)
      setUnreadCount(payload.unreadCount)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [scope])

  const acknowledge = useCallback(
    async (id: string) => {
      await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
      })
      setItems((prev) => prev.filter((item) => item.id !== id))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    },
    [scope],
  )

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 30000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return useMemo(() => ({
    items,
    unreadCount,
    loading,
    error,
    refresh,
    acknowledge,
  }), [items, unreadCount, loading, error, refresh, acknowledge])
}
