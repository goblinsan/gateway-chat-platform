interface CompareResult {
  provider: string
  model: string
  content: string
  latencyMs: number
  error?: string
}

interface ComparePanelProps {
  results: CompareResult[]
  isLoading: boolean
}

export default function ComparePanel({ results, isLoading }: ComparePanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500 text-sm">
        <span className="animate-pulse">Comparing providers…</span>
      </div>
    )
  }

  if (results.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 p-4 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {results.map((r) => (
        <div key={r.provider} className="flex flex-col bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800">
            <span className="text-sm font-medium text-gray-200">{r.provider}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-mono">{r.model}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${r.error ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'}`}>
                {r.error ? 'error' : `${r.latencyMs}ms`}
              </span>
            </div>
          </div>
          <div className="flex-1 px-4 py-3 text-sm text-gray-200 whitespace-pre-wrap overflow-y-auto max-h-64">
            {r.error ? (
              <span className="text-red-400">⚠️ {r.error}</span>
            ) : (
              r.content || <span className="text-gray-500">No response</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
