import { vi, describe, it, expect, beforeEach } from 'vitest'
import { checkQuota, getUserUsageSummary } from '../services/quotaService'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindManyQuota = vi.fn()
const mockAggregateUsage = vi.fn()
const mockGroupByUsage = vi.fn()

const mockPrisma = {
  modelQuota: { findMany: mockFindManyQuota },
  usageLog: {
    aggregate: mockAggregateUsage,
    groupBy: mockGroupByUsage,
  },
}

// ── checkQuota ─────────────────────────────────────────────────────────────────

describe('checkQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no quota is configured', async () => {
    mockFindManyQuota.mockResolvedValue([])
    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    expect(result).toBeNull()
  })

  it('returns not-exceeded status when usage is under limit', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: 10000, maxRequests: null, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 3000, estimatedCostUsd: 0.015 },
      _count: { id: 5 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    expect(result).not.toBeNull()
    expect(result!.exceeded).toBe(false)
    expect(result!.nearLimit).toBe(false)
    expect(result!.usedTokens).toBe(3000)
    expect(result!.maxTokens).toBe(10000)
  })

  it('returns exceeded=true when token limit is reached', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: 1000, maxRequests: null, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 1000, estimatedCostUsd: 0.005 },
      _count: { id: 2 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    expect(result!.exceeded).toBe(true)
  })

  it('returns nearLimit=true when usage is >= 80% of limit', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: 10000, maxRequests: null, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 8500, estimatedCostUsd: 0 },
      _count: { id: 1 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    expect(result!.exceeded).toBe(false)
    expect(result!.nearLimit).toBe(true)
  })

  it('returns exceeded=true when request limit is reached', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: '*', windowHours: 24, maxTokens: null, maxRequests: 5, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 500, estimatedCostUsd: 0 },
      _count: { id: 5 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'local-model')
    expect(result!.exceeded).toBe(true)
  })

  it('returns exceeded=true when cost limit is reached', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: null, maxRequests: null, maxCostUsd: 1.0 },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 200000, estimatedCostUsd: 1.05 },
      _count: { id: 10 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    expect(result!.exceeded).toBe(true)
  })

  it('prefers user-specific quota over global quota', async () => {
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: 500, maxRequests: null, maxCostUsd: null },
      { userId: 'user-1', model: 'gpt-4o', windowHours: 24, maxTokens: 50000, maxRequests: null, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 1000, estimatedCostUsd: 0.005 },
      _count: { id: 2 },
    })

    const result = await checkQuota(mockPrisma as never, 'user-1', 'gpt-4o')
    // User-specific quota (50000 tokens) should win, so 1000 tokens is not exceeded
    expect(result!.exceeded).toBe(false)
    expect(result!.maxTokens).toBe(50000)
  })
})

// ── getUserUsageSummary ────────────────────────────────────────────────────────

describe('getUserUsageSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty summary when there are no usage logs', async () => {
    mockGroupByUsage.mockResolvedValue([])

    const summary = await getUserUsageSummary(mockPrisma as never, 'user-1', 24)
    expect(summary.entries).toHaveLength(0)
    expect(summary.totalTokens).toBe(0)
    expect(summary.totalCostUsd).toBe(0)
    expect(summary.totalRequests).toBe(0)
    expect(summary.userId).toBe('user-1')
    expect(summary.periodHours).toBe(24)
  })

  it('aggregates entries with no quota', async () => {
    mockGroupByUsage.mockResolvedValue([
      {
        model: 'gpt-4o',
        provider: 'openai',
        _count: { id: 3 },
        _sum: { promptTokens: 300, completionTokens: 150, totalTokens: 450, estimatedCostUsd: 0.003 },
      },
    ])
    mockFindManyQuota.mockResolvedValue([])

    const summary = await getUserUsageSummary(mockPrisma as never, 'user-1', 24)
    expect(summary.entries).toHaveLength(1)
    expect(summary.entries[0].model).toBe('gpt-4o')
    expect(summary.entries[0].totalTokens).toBe(450)
    expect(summary.entries[0].quota).toBeNull()
    expect(summary.totalTokens).toBe(450)
    expect(summary.totalRequests).toBe(3)
  })

  it('attaches quota status when a quota is configured', async () => {
    mockGroupByUsage.mockResolvedValue([
      {
        model: 'gpt-4o',
        provider: 'openai',
        _count: { id: 2 },
        _sum: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUsd: 0.001 },
      },
    ])
    mockFindManyQuota.mockResolvedValue([
      { userId: '*', model: 'gpt-4o', windowHours: 24, maxTokens: 10000, maxRequests: null, maxCostUsd: null },
    ])
    mockAggregateUsage.mockResolvedValue({
      _sum: { totalTokens: 150, estimatedCostUsd: 0.001 },
      _count: { id: 2 },
    })

    const summary = await getUserUsageSummary(mockPrisma as never, 'user-1', 24)
    expect(summary.entries[0].quota).not.toBeNull()
    expect(summary.entries[0].quota!.exceeded).toBe(false)
    expect(summary.entries[0].quota!.maxTokens).toBe(10000)
  })
})
