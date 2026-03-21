import { describe, it, expect } from 'vitest'
import { estimateCostUsd } from '../services/costEstimator'

describe('estimateCostUsd', () => {
  it('returns 0 for unknown model', () => {
    expect(estimateCostUsd('unknown-model', 1000, 500)).toBe(0)
  })

  it('calculates cost for gpt-4o correctly', () => {
    // gpt-4o: input $5/1M, output $15/1M
    // 1000 prompt tokens = 1000/1M * 5 = 0.005
    // 500 completion tokens = 500/1M * 15 = 0.0075
    // total = 0.0125
    const cost = estimateCostUsd('gpt-4o', 1000, 500)
    expect(cost).toBeCloseTo(0.0125, 6)
  })

  it('calculates cost for gpt-4o-mini correctly', () => {
    // gpt-4o-mini: input $0.15/1M, output $0.6/1M
    const cost = estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.75, 4)
  })

  it('calculates cost for claude-3-5-sonnet', () => {
    // claude-3-5-sonnet: input $3/1M, output $15/1M
    const cost = estimateCostUsd('claude-3-5-sonnet', 2000, 1000)
    // input: 2000/1M * 3 = 0.006
    // output: 1000/1M * 15 = 0.015
    // total: 0.021
    expect(cost).toBeCloseTo(0.021, 6)
  })

  it('calculates cost for gemini-1.5-flash (cheapest model)', () => {
    // gemini-1.5-flash: input $0.075/1M, output $0.3/1M
    const cost = estimateCostUsd('gemini-1.5-flash', 100_000, 50_000)
    // input: 0.1M * 0.075 = 0.0075
    // output: 0.05M * 0.3 = 0.015
    // total: 0.0225
    expect(cost).toBeCloseTo(0.0225, 4)
  })

  it('returns 0 for zero tokens with unknown model', () => {
    expect(estimateCostUsd('some-random-model', 0, 0)).toBe(0)
  })

  it('returns 0 for zero tokens even with known model', () => {
    expect(estimateCostUsd('gpt-4', 0, 0)).toBe(0)
  })

  it('result is a number with at most 8 decimal places', () => {
    const cost = estimateCostUsd('gpt-4', 123, 456)
    expect(typeof cost).toBe('number')
    const str = cost.toString()
    const decimals = str.includes('.') ? str.split('.')[1].length : 0
    expect(decimals).toBeLessThanOrEqual(8)
  })
})
