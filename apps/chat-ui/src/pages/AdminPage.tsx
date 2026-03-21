import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

interface AgentStat {
  agentId: string
  requestCount: number
  totalTokens: number
  totalCostUsd: number
}

interface ProviderStat {
  provider: string
  requestCount: number
  totalTokens: number
  totalCostUsd: number
}

interface RecentActivity {
  id: string
  agentId: string
  provider: string
  model: string
  totalTokens: number
  estimatedCostUsd: number
  latencyMs: number
  createdAt: string
}

interface AdminStats {
  requestsByAgent: AgentStat[]
  costByProvider: ProviderStat[]
  recentActivity: RecentActivity[]
}

interface ProviderStatus {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

interface ProvidersStatusResponse {
  providers: ProviderStatus[]
}

export default function AdminPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: () => axios.get<AdminStats>('/api/admin/stats').then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: providersData, isLoading: providersLoading } = useQuery<ProvidersStatusResponse>({
    queryKey: ['providers-status'],
    queryFn: () => axios.get<ProvidersStatusResponse>('/api/providers/status').then((r) => r.data),
    refetchInterval: 60_000,
  })

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Diagnostics</h1>
        <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Back to Chat</a>
      </div>

      {/* Provider Health */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-gray-300">Provider Health</h2>
        {providersLoading && <p className="text-gray-400 text-sm">Loading…</p>}
        {providersData && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {providersData.providers.map((p) => (
              <div key={p.name} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className={`text-xs mt-1 font-medium ${
                  p.status === 'ok' ? 'text-green-400' :
                  p.status === 'error' ? 'text-red-400' : 'text-gray-500'
                }`}>
                  {p.status}
                </div>
                {p.latencyMs != null && (
                  <div className="text-xs text-gray-500 mt-0.5">{p.latencyMs}ms</div>
                )}
                {p.error && (
                  <div className="text-xs text-red-400 mt-0.5 truncate" title={p.error}>{p.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Request Counts by Agent */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-gray-300">Requests by Agent</h2>
        {statsLoading && <p className="text-gray-400 text-sm">Loading…</p>}
        {stats && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-400">Agent</th>
                  <th className="text-right px-4 py-2 text-gray-400">Requests</th>
                  <th className="text-right px-4 py-2 text-gray-400">Tokens</th>
                  <th className="text-right px-4 py-2 text-gray-400">Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {stats.requestsByAgent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-gray-500 text-center">No data yet</td>
                  </tr>
                )}
                {stats.requestsByAgent.map((a) => (
                  <tr key={a.agentId} className="border-t border-gray-800">
                    <td className="px-4 py-2 font-medium">{a.agentId}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{a.requestCount}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{a.totalTokens.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-green-400">${a.totalCostUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost by Provider */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-gray-300">Cost by Provider</h2>
        {stats && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-400">Provider</th>
                  <th className="text-right px-4 py-2 text-gray-400">Requests</th>
                  <th className="text-right px-4 py-2 text-gray-400">Tokens</th>
                  <th className="text-right px-4 py-2 text-gray-400">Total Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {stats.costByProvider.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-gray-500 text-center">No data yet</td>
                  </tr>
                )}
                {stats.costByProvider.map((p) => (
                  <tr key={p.provider} className="border-t border-gray-800">
                    <td className="px-4 py-2 font-medium">{p.provider}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{p.requestCount}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{p.totalTokens.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-green-400">${p.totalCostUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-gray-300">Recent Activity</h2>
        {stats && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-400">Agent</th>
                  <th className="text-left px-4 py-2 text-gray-400">Provider</th>
                  <th className="text-left px-4 py-2 text-gray-400">Model</th>
                  <th className="text-right px-4 py-2 text-gray-400">Tokens</th>
                  <th className="text-right px-4 py-2 text-gray-400">Cost</th>
                  <th className="text-right px-4 py-2 text-gray-400">Latency</th>
                  <th className="text-right px-4 py-2 text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentActivity.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-gray-500 text-center">No activity yet</td>
                  </tr>
                )}
                {stats.recentActivity.map((a) => (
                  <tr key={a.id} className="border-t border-gray-800">
                    <td className="px-4 py-2">{a.agentId}</td>
                    <td className="px-4 py-2 text-gray-300">{a.provider}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{a.model}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{a.totalTokens}</td>
                    <td className="px-4 py-2 text-right text-green-400">${a.estimatedCostUsd.toFixed(6)}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{a.latencyMs}ms</td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
