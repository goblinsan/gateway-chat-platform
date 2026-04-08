import { useEffect, useState } from 'react'
import type { UsageSummaryResponse, ModelRatesResponse, ModelUsageSummaryEntry } from '@gateway/shared'

interface UsagePanelProps {
  isOpen: boolean
  summary: UsageSummaryResponse | null
  rates: ModelRatesResponse | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onClose: () => void
}

type Window = 24 | 48 | 168

const WINDOW_OPTIONS: { label: string; hours: Window }[] = [
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7d', hours: 168 },
]

function QuotaBar({ used, max }: { used: number; max: number }) {
  const pct = Math.min(100, (used / max) * 100)
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function QuotaDetail({ entry }: { entry: ModelUsageSummaryEntry }) {
  const q = entry.quota
  if (!q) return null

  const pctTokens =
    q.maxTokens != null ? Math.min(100, (q.usedTokens / q.maxTokens) * 100) : null
  const pctRequests =
    q.maxRequests != null ? Math.min(100, (q.usedRequests / q.maxRequests) * 100) : null
  const pctCost =
    q.maxCostUsd != null ? Math.min(100, (q.usedCostUsd / q.maxCostUsd) * 100) : null

  const statusColor = q.exceeded
    ? 'text-red-400'
    : q.nearLimit
    ? 'text-yellow-400'
    : 'text-green-400'
  const statusLabel = q.exceeded ? 'Quota exceeded' : q.nearLimit ? 'Near limit' : 'Within quota'

  return (
    <div className="mt-2 space-y-1.5">
      <div className={`text-xs font-medium ${statusColor}`}>{statusLabel}</div>

      {q.maxTokens != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Tokens</span>
            <span>
              {q.usedTokens.toLocaleString()} / {q.maxTokens.toLocaleString()}
            </span>
          </div>
          <QuotaBar used={q.usedTokens} max={q.maxTokens} />
        </div>
      )}

      {q.maxRequests != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Requests</span>
            <span>
              {q.usedRequests} / {q.maxRequests}
            </span>
          </div>
          <QuotaBar used={q.usedRequests} max={q.maxRequests} />
        </div>
      )}

      {q.maxCostUsd != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Spend</span>
            <span>
              ${q.usedCostUsd.toFixed(4)} / ${q.maxCostUsd.toFixed(4)}
            </span>
          </div>
          {/* pctCost is guaranteed non-null when maxCostUsd is non-null */}
          <QuotaBar used={pctCost!} max={100} />
        </div>
      )}

      {/* suppress unused warning */}
      {pctTokens != null && pctRequests != null && null}
      <div className="text-xs text-gray-600">{q.windowHours}h rolling window</div>
    </div>
  )
}

export default function UsagePanel({
  isOpen,
  summary,
  rates,
  loading,
  error,
  onRefresh,
  onClose,
}: UsagePanelProps) {
  const [window, setWindow] = useState<Window>(24)
  const [activeTab, setActiveTab] = useState<'usage' | 'rates'>('usage')

  useEffect(() => {
    if (isOpen) onRefresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleWindowChange = (h: Window) => {
    setWindow(h)
    onRefresh()
  }

  if (!isOpen) return null

  return (
    <aside className="w-full md:w-96 border-l border-gray-800 bg-gray-900/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">Usage &amp; Quotas</p>
          {summary && (
            <p className="text-xs text-gray-500">
              {summary.totalRequests} requests · {summary.totalTokens.toLocaleString()} tokens
              {summary.totalCostUsd > 0 ? ` · $${summary.totalCostUsd.toFixed(4)}` : ''}
            </p>
          )}
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

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {(['usage', 'rates'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'usage' ? 'Usage & Quotas' : 'Pricing Rates'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <p className="text-xs text-gray-500 animate-pulse text-center">Loading…</p>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}

        {activeTab === 'usage' && !loading && (
          <>
            {/* Window selector */}
            <div className="flex gap-1">
              {WINDOW_OPTIONS.map(({ label, hours }) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => handleWindowChange(hours)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    window === hours
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {summary && summary.entries.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-8">No usage in this period.</p>
            )}

            {summary?.entries.map((entry) => (
              <div
                key={`${entry.model}:${entry.provider}`}
                className="bg-gray-800/60 rounded-lg p-3 border border-gray-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs text-gray-100 font-medium">{entry.model}</span>
                    <span className="ml-2 text-xs text-gray-500">via {entry.provider}</span>
                  </div>
                  {entry.quota?.exceeded && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 font-medium shrink-0">
                      Exceeded
                    </span>
                  )}
                  {entry.quota?.nearLimit && !entry.quota.exceeded && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/60 text-yellow-400 font-medium shrink-0">
                      Near limit
                    </span>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-gray-500">Requests</div>
                    <div className="font-medium text-gray-200">{entry.requestCount}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Tokens</div>
                    <div className="font-medium text-gray-200">
                      {entry.totalTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Cost</div>
                    <div className={`font-medium ${entry.estimatedCostUsd > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                      {entry.estimatedCostUsd > 0 ? `$${entry.estimatedCostUsd.toFixed(4)}` : '—'}
                    </div>
                  </div>
                </div>

                <QuotaDetail entry={entry} />
              </div>
            ))}
          </>
        )}

        {activeTab === 'rates' && !loading && (
          <>
            {rates && rates.rates.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-8">No pricing data available.</p>
            )}

            {rates && rates.rates.length > 0 && (
              <div className="bg-gray-800/60 rounded-lg border border-gray-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-400 font-medium">Model</th>
                      <th className="text-right px-3 py-2 text-gray-400 font-medium">Input /1M</th>
                      <th className="text-right px-3 py-2 text-gray-400 font-medium">Output /1M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.rates.map((r) => (
                      <tr key={r.model} className="border-t border-gray-700">
                        <td className="px-3 py-2 font-mono text-gray-200">{r.model}</td>
                        <td className="px-3 py-2 text-right text-gray-300">
                          ${r.inputPer1MTokens.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-300">
                          ${r.outputPer1MTokens.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-gray-600 text-center">
              Prices in USD per 1 million tokens. Local models cost $0.
            </p>
          </>
        )}
      </div>
    </aside>
  )
}
