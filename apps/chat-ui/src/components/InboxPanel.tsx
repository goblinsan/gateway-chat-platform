import type { InboxItem } from '@gateway/shared'

interface InboxPanelProps {
  isOpen: boolean
  items: InboxItem[]
  unreadCount: number
  loading: boolean
  error: string | null
  scopeLabel: string
  onRefresh: () => void
  onOpenItem: (item: InboxItem) => void
  onClose: () => void
}

export default function InboxPanel({
  isOpen,
  items,
  unreadCount,
  loading,
  error,
  scopeLabel,
  onRefresh,
  onOpenItem,
  onClose,
}: InboxPanelProps) {
  if (!isOpen) {
    return null
  }

  return (
    <aside className="w-full md:w-96 border-l border-gray-800 bg-gray-900/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">Inbox</p>
          <p className="text-xs text-gray-500">{scopeLabel} · {unreadCount} unread</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">Loading inbox…</p>
        ) : null}
        {error ? (
          <p className="px-4 py-4 text-sm text-amber-300">{error}</p>
        ) : null}
        {!loading && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No unread inbox items.</p>
        ) : null}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenItem(item)}
            className="w-full text-left px-4 py-4 border-b border-gray-800 hover:bg-gray-900 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">
                  {item.title || item.threadTitle || item.agentId}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {item.channelId} · {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-blue-300 border border-blue-500/40 px-2 py-1">
                {item.kind.split('_').join(' ')}
              </span>
            </div>
            <p className="mt-3 text-sm text-gray-300 whitespace-pre-wrap overflow-hidden max-h-32">
              {item.content}
            </p>
          </button>
        ))}
      </div>
    </aside>
  )
}
