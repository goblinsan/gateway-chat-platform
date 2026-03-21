import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

interface HealthResponse {
  status: string
  version: string
  uptime: number
  dependencies: Record<string, { status: string; latencyMs?: number }>
}

export default function HealthPage() {
  const { data, isLoading, isError } = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => axios.get('/api/health').then((r) => r.data),
  })

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Platform Health</h1>
      {isLoading && <p className="text-gray-400">Checking…</p>}
      {isError && <p className="text-red-400">Could not reach API.</p>}
      {data && (
        <div className="space-y-4">
          <div className="flex gap-3 items-center">
            <span
              className={`px-2 py-0.5 rounded text-sm font-medium ${
                data.status === 'ok' ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'
              }`}
            >
              {data.status}
            </span>
            <span className="text-gray-400 text-sm">v{data.version}</span>
          </div>
          <table className="w-full text-sm border border-gray-800 rounded-lg overflow-hidden">
            <thead className="bg-gray-900">
              <tr>
                <th className="text-left px-4 py-2 text-gray-400">Dependency</th>
                <th className="text-left px-4 py-2 text-gray-400">Status</th>
                <th className="text-left px-4 py-2 text-gray-400">Latency</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.dependencies).map(([name, dep]) => (
                <tr key={name} className="border-t border-gray-800">
                  <td className="px-4 py-2">{name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`font-medium ${
                        dep.status === 'ok' ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {dep.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400">
                    {dep.latencyMs != null ? `${dep.latencyMs}ms` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
