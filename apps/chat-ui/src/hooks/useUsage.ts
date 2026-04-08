import { useState, useCallback } from 'react'
import type { UsageSummaryResponse, ModelRatesResponse } from '@gateway/shared'

export interface UseUsageResult {
  summary: UsageSummaryResponse | null
  rates: ModelRatesResponse | null
  loading: boolean
  error: string | null
  refresh: (hours?: number) => Promise<void>
}

export function useUsage(): UseUsageResult {
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null)
  const [rates, setRates] = useState<ModelRatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (hours = 24) => {
    setLoading(true)
    setError(null)
    try {
      const [summaryRes, ratesRes] = await Promise.all([
        fetch(`/api/usage/summary?hours=${hours}`),
        fetch('/api/usage/rates'),
      ])
      if (!summaryRes.ok) throw new Error(`Failed to load usage summary (${summaryRes.status})`)
      if (!ratesRes.ok) throw new Error(`Failed to load model rates (${ratesRes.status})`)
      const [summaryData, ratesData] = await Promise.all([
        summaryRes.json() as Promise<UsageSummaryResponse>,
        ratesRes.json() as Promise<ModelRatesResponse>,
      ])
      setSummary(summaryData)
      setRates(ratesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data')
    } finally {
      setLoading(false)
    }
  }, [])

  return { summary, rates, loading, error, refresh }
}
