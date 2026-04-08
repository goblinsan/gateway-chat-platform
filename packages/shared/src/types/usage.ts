/** Quota status for a single model returned by GET /api/usage/summary */
export interface ModelQuotaStatus {
  model: string
  windowHours: number
  usedTokens: number
  usedRequests: number
  usedCostUsd: number
  maxTokens: number | null
  maxRequests: number | null
  maxCostUsd: number | null
  exceeded: boolean
  nearLimit: boolean
}

/** One row in the usage summary, one per (model, provider) combination */
export interface ModelUsageSummaryEntry {
  model: string
  provider: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  /** Quota status, or null if no quota is configured for this model */
  quota: ModelQuotaStatus | null
}

/** Response for GET /api/usage/summary */
export interface UsageSummaryResponse {
  userId: string
  periodHours: number
  entries: ModelUsageSummaryEntry[]
  totalTokens: number
  totalCostUsd: number
  totalRequests: number
}

/** One entry in the rates table */
export interface ModelRateEntry {
  model: string
  inputPer1MTokens: number
  outputPer1MTokens: number
}

/** Response for GET /api/usage/rates */
export interface ModelRatesResponse {
  rates: ModelRateEntry[]
}
