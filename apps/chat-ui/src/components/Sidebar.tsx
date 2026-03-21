import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentListItem } from '@gateway/shared'
import type { ChatThread } from '../types/chat'

interface ProviderStatusEntry {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

interface SidebarProps {
  agents: AgentListItem[]
  threads: ChatThread[]
  activeThreadId: string | null
  activeAgentId: string
  onSelectThread: (threadId: string) => void
  onNewChat: () => void
  onDeleteThread: (threadId: string) => void
  onWorkflows: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-400',
  error: 'bg-red-400',
  unconfigured: 'bg-gray-600',
}

const Sidebar = React.memo(function Sidebar({
  agents,
  threads,
  activeThreadId,
  activeAgentId,
  onSelectThread,
  onNewChat,
  onDeleteThread,
  onWorkflows,
}: SidebarProps) {
  const [providerStatus, setProviderStatus] = useState<ProviderStatusEntry[]>([])
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    fetch('/api/providers/status')
      .then((r) => r.json() as Promise<{ providers: ProviderStatusEntry[] }>)
      .then((data) => setProviderStatus(data.providers))
      .catch((err) => {
        console.warn('[Sidebar] Failed to fetch provider status:', err)
      })
  }, [])

  const agentMap = useCallback(
    (agentId: string): AgentListItem | undefined => agents.find((a) => a.id === agentId),
    [agents],
  )

  // Sort threads by createdAt descending
  const sortedThreads = [...threads].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 flex-col bg-gray-900 border-r border-gray-800 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-800">
        <span className="text-xl select-none" aria-hidden="true">⚡</span>
        <span className="text-sm font-semibold text-gray-100">Gateway Chat</span>
      </div>

      {/* New Chat button */}
      <div className="px-3 py-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 hover:text-white transition-colors border border-gray-700 hover:border-gray-600"
        >
          <span className="text-base" aria-hidden="true">+</span>
          New Chat
        </button>
        <button
          onClick={onWorkflows}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors mt-1"
        >
          <span className="text-base" aria-hidden="true">⚙</span>
          Workflows
        </button>
      </div>

      {/* Thread list */}
      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {sortedThreads.length === 0 && (
          <p className="text-xs text-gray-600 text-center mt-6 px-2">
            No conversations yet.
          </p>
        )}
        {sortedThreads.map((thread) => {
          const agent = agentMap(thread.agentId)
          const isActive = thread.id === activeThreadId
          const isAgentActive = thread.agentId === activeAgentId
          return (
            <div
              key={thread.id}
              onMouseEnter={() => setHoveredThreadId(thread.id)}
              onMouseLeave={() => setHoveredThreadId(null)}
              className={`group relative flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer mb-0.5 transition-colors ${
                isActive
                  ? 'bg-gray-800 border-l-2 border-blue-500 pl-1.5'
                  : 'hover:bg-gray-800 border-l-2 border-transparent'
              } ${!isAgentActive ? 'opacity-60' : ''}`}
              onClick={() => onSelectThread(thread.id)}
            >
              <span className="flex-shrink-0 text-sm mt-0.5 select-none" aria-hidden="true">
                {agent?.icon ?? '💬'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate leading-snug">
                  {thread.title || 'Untitled'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {agent?.name ?? thread.agentId} · {formatDate(thread.createdAt)}
                </p>
              </div>
              {hoveredThreadId === thread.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteThread(thread.id)
                  }}
                  className="flex-shrink-0 p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
                  title="Delete thread"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </nav>

      {/* Provider status dots */}
      {providerStatus.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-3">
          <p className="text-xs text-gray-600 mb-2">Providers</p>
          <div className="flex flex-wrap gap-2">
            {providerStatus.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-1.5"
                title={`${p.name}: ${p.status}${p.latencyMs !== undefined ? ` (${p.latencyMs}ms)` : ''}${p.error ? ` — ${p.error}` : ''}`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] ?? 'bg-gray-600'}`}
                />
                <span className="text-xs text-gray-500 truncate max-w-[60px]">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
})

export default Sidebar
