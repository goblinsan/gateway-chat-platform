import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxItem, InboxListResponse } from '@gateway/shared'

export interface ChatInboxScope {
  userId: string
  channelId: string
}

async function fetchInbox(scope: ChatInboxScope): Promise<InboxListResponse> {
  const params = new URLSearchParams({
    userId: scope.userId,
    channelId: scope.channelId,
    unreadOnly: 'true',
    limit: '25',
  })
  const response = await fetch(`/api/inbox?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Inbox request failed (${response.status})`)
  }
  return response.json() as Promise<InboxListResponse>
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
      await fetch(`/api/inbox/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope),
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
