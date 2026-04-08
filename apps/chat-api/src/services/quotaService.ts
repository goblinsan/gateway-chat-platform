import type { PrismaClient } from '@prisma/client'

export interface QuotaStatus {
  model: string
  windowHours: number
  usedTokens: number
  usedRequests: number
  usedCostUsd: number
  maxTokens: number | null
  maxRequests: number | null
  maxCostUsd: number | null
  /** True when at least one quota dimension is defined and would be exceeded */
  exceeded: boolean
  /** True when at least one dimension is within the final 20% of its limit */
  nearLimit: boolean
}

export interface ModelUsageSummaryEntry {
  model: string
  provider: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  quota: QuotaStatus | null
}

export interface UsageSummaryResponse {
  userId: string
  periodHours: number
  entries: ModelUsageSummaryEntry[]
  totalTokens: number
  totalCostUsd: number
  totalRequests: number
}

/** Resolve the most specific quota for a (userId, model) pair.
 *  Precedence: exact-user/exact-model > "*"/exact-model > exact-user/"*" > "*"/"*"
 */
async function resolveQuota(
  prisma: PrismaClient,
  userId: string,
  model: string,
): Promise<{
  windowHours: number
  maxTokens: number | null
  maxRequests: number | null
  maxCostUsd: number | null
} | null> {
  // Fetch all potentially applicable quota rows in a single query
  const rows = await prisma.modelQuota.findMany({
    where: {
      enabled: true,
      userId: { in: [userId, '*'] },
      model: { in: [model, '*'] },
    },
  })

  if (rows.length === 0) return null

  // Sort by specificity: exact user + exact model wins
  const score = (r: { userId: string; model: string }) =>
    (r.userId !== '*' ? 2 : 0) + (r.model !== '*' ? 1 : 0)

  rows.sort((a, b) => score(b) - score(a))
  const best = rows[0]

  return {
    windowHours: best.windowHours,
    maxTokens: best.maxTokens,
    maxRequests: best.maxRequests,
    maxCostUsd: best.maxCostUsd,
  }
}

/** Aggregate usage for a user+model pair within a rolling window. */
async function getWindowUsage(
  prisma: PrismaClient,
  userId: string,
  model: string,
  windowHours: number,
): Promise<{ usedTokens: number; usedRequests: number; usedCostUsd: number }> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  const agg = await prisma.usageLog.aggregate({
    where: { userId, model, createdAt: { gte: since } },
    _sum: { totalTokens: true, estimatedCostUsd: true },
    _count: { id: true },
  })
  return {
    usedTokens: agg._sum.totalTokens ?? 0,
    usedRequests: agg._count.id ?? 0,
    usedCostUsd: agg._sum.estimatedCostUsd ?? 0,
  }
}

/**
 * Check whether sending a request for (userId, model) would exceed quota.
 * Returns null if no quota is configured for this model.
 */
export async function checkQuota(
  prisma: PrismaClient,
  userId: string,
  model: string,
): Promise<QuotaStatus | null> {
  const quota = await resolveQuota(prisma, userId, model)
  if (!quota) return null

  const { usedTokens, usedRequests, usedCostUsd } = await getWindowUsage(
    prisma,
    userId,
    model,
    quota.windowHours,
  )

  const tokenExceeded = quota.maxTokens !== null && usedTokens >= quota.maxTokens
  const requestExceeded = quota.maxRequests !== null && usedRequests >= quota.maxRequests
  const costExceeded = quota.maxCostUsd !== null && usedCostUsd >= quota.maxCostUsd

  const tokenNear =
    quota.maxTokens !== null && usedTokens >= quota.maxTokens * 0.8
  const requestNear =
    quota.maxRequests !== null && usedRequests >= quota.maxRequests * 0.8
  const costNear =
    quota.maxCostUsd !== null && usedCostUsd >= quota.maxCostUsd * 0.8

  return {
    model,
    windowHours: quota.windowHours,
    usedTokens,
    usedRequests,
    usedCostUsd,
    maxTokens: quota.maxTokens,
    maxRequests: quota.maxRequests,
    maxCostUsd: quota.maxCostUsd,
    exceeded: tokenExceeded || requestExceeded || costExceeded,
    nearLimit: tokenNear || requestNear || costNear,
  }
}

/**
 * Build a full usage summary for the current user across all models they have
 * used in the last `periodHours` hours, enriched with quota status where set.
 */
export async function getUserUsageSummary(
  prisma: PrismaClient,
  userId: string,
  periodHours = 24,
): Promise<UsageSummaryResponse> {
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000)

  // Aggregate per model+provider
  const rows = await prisma.usageLog.groupBy({
    by: ['model', 'provider'],
    where: { userId, createdAt: { gte: since } },
    _count: { id: true },
    _sum: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
    },
  })

  // Build entries with quota info
  const entries: ModelUsageSummaryEntry[] = await Promise.all(
    rows.map(async (r) => {
      const quota = await resolveQuota(prisma, userId, r.model)
      let quotaStatus: QuotaStatus | null = null
      if (quota) {
        const { usedTokens, usedRequests, usedCostUsd } = await getWindowUsage(
          prisma,
          userId,
          r.model,
          quota.windowHours,
        )
        const tokenExceeded = quota.maxTokens !== null && usedTokens >= quota.maxTokens
        const requestExceeded =
          quota.maxRequests !== null && usedRequests >= quota.maxRequests
        const costExceeded = quota.maxCostUsd !== null && usedCostUsd >= quota.maxCostUsd
        const tokenNear =
          quota.maxTokens !== null && usedTokens >= quota.maxTokens * 0.8
        const requestNear =
          quota.maxRequests !== null && usedRequests >= quota.maxRequests * 0.8
        const costNear =
          quota.maxCostUsd !== null && usedCostUsd >= quota.maxCostUsd * 0.8

        quotaStatus = {
          model: r.model,
          windowHours: quota.windowHours,
          usedTokens,
          usedRequests,
          usedCostUsd,
          maxTokens: quota.maxTokens,
          maxRequests: quota.maxRequests,
          maxCostUsd: quota.maxCostUsd,
          exceeded: tokenExceeded || requestExceeded || costExceeded,
          nearLimit: tokenNear || requestNear || costNear,
        }
      }

      return {
        model: r.model,
        provider: r.provider,
        requestCount: r._count.id,
        promptTokens: r._sum.promptTokens ?? 0,
        completionTokens: r._sum.completionTokens ?? 0,
        totalTokens: r._sum.totalTokens ?? 0,
        estimatedCostUsd: r._sum.estimatedCostUsd ?? 0,
        quota: quotaStatus,
      }
    }),
  )

  const totalTokens = entries.reduce((s, e) => s + e.totalTokens, 0)
  const totalCostUsd = entries.reduce((s, e) => s + e.estimatedCostUsd, 0)
  const totalRequests = entries.reduce((s, e) => s + e.requestCount, 0)

  return { userId, periodHours, entries, totalTokens, totalCostUsd, totalRequests }
}
