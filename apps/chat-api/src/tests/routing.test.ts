/**
 * Tests for the routing engine and policy-based provider selection.
 * Issue #52 — test coverage for routing scenarios.
 */
import { describe, it, expect } from 'vitest'
import { resolveProviderChain, estimatePromptTokens } from '../routing/engine'
import type { RoutingPolicy } from '@gateway/shared'

/** All three providers registered for tests that need a full pool. */
const ALL_PROVIDERS = ['lm-studio-a', 'lm-studio-b', 'openai']
const LOCAL_PROVIDERS = ['lm-studio-a', 'lm-studio-b']
const SHORT_PROMPT = 50    // tokens — well below any threshold
const LONG_PROMPT  = 2000  // tokens — exceeds typical promptLengthThreshold

// ── estimatePromptTokens ────────────────────────────────────────────────────

describe('estimatePromptTokens', () => {
  it('returns zero for an empty array', () => {
    expect(estimatePromptTokens([])).toBe(0)
  })

  it('estimates roughly 1 token per 4 characters', () => {
    // 40 chars → ceil(40/4) = 10
    const msgs = [{ content: 'a'.repeat(40) }]
    expect(estimatePromptTokens(msgs)).toBe(10)
  })

  it('sums content across multiple messages', () => {
    const msgs = [{ content: 'a'.repeat(20) }, { content: 'b'.repeat(20) }]
    expect(estimatePromptTokens(msgs)).toBe(10)
  })
})

// ── Static agent-to-provider routing (Issue #48) ────────────────────────────

describe('static provider routing', () => {
  it('uses the preferred provider when available and unrestricted', () => {
    const policy: RoutingPolicy = { preferredProvider: 'lm-studio-a' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('lm-studio-a')
    expect(decision.orderedChain[0]).toBe('lm-studio-a')
  })

  it('uses the preferred provider from a single-provider pool', () => {
    const policy: RoutingPolicy = { preferredProvider: 'openai' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ['openai'])
    expect(decision.selectedProvider).toBe('openai')
  })

  it('reason message names the preferred provider', () => {
    const policy: RoutingPolicy = { preferredProvider: 'lm-studio-b' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.reason).toContain("lm-studio-b")
  })
})

// ── allowedProviders whitelist (hard constraint) ─────────────────────────────

describe('allowedProviders filter', () => {
  it('excludes providers not in the whitelist', () => {
    const policy: RoutingPolicy = {
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('openai')
  })

  it('records excluded providers as rejected candidates', () => {
    const policy: RoutingPolicy = { allowedProviders: ['lm-studio-a'] }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    const names = decision.rejectedCandidates.map(r => r.provider)
    expect(names).toContain('lm-studio-b')
    expect(names).toContain('openai')
  })

  it('respects whitelist even when allowPaidFallback is true', () => {
    const policy: RoutingPolicy = {
      allowedProviders: ['lm-studio-a'],
      allowPaidFallback: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('openai')
  })
})

// ── maxCostClass filter ──────────────────────────────────────────────────────

describe('maxCostClass filter', () => {
  it('excludes providers above the cost cap', () => {
    const policy: RoutingPolicy = { maxCostClass: 'free' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('openai')
    expect(decision.orderedChain.length).toBeGreaterThan(0)
  })

  it('records over-budget provider with cost-class reason', () => {
    const policy: RoutingPolicy = { maxCostClass: 'free' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    const openaiRejection = decision.rejectedCandidates.find(r => r.provider === 'openai')
    expect(openaiRejection).toBeDefined()
    expect(openaiRejection?.reason).toContain('premium')
  })

  it('allows providers within the cost cap', () => {
    const policy: RoutingPolicy = { maxCostClass: 'premium' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).toContain('openai')
    expect(decision.orderedChain).toContain('lm-studio-a')
  })
})

// ── requiresTools filter (Issue #49) ────────────────────────────────────────

describe('requiresTools filter', () => {
  it('selects openai when tools are required (Issue #49)', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('openai')
  })

  it('excludes local providers that do not support tools', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('lm-studio-a')
    expect(decision.orderedChain).not.toContain('lm-studio-b')
  })

  it('records tool-incapable providers as rejected', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    const reasons = decision.rejectedCandidates.map(r => r.reason)
    expect(reasons.some(r => r.includes('tool'))).toBe(true)
  })

  it('throws when tools required but no capable provider is available', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    expect(() => resolveProviderChain(policy, SHORT_PROMPT, LOCAL_PROVIDERS)).toThrow()
  })
})

// ── requiresReasoning filter (Issue #49) ────────────────────────────────────

describe('requiresReasoning filter — reasoning tasks (Issue #52)', () => {
  it('routes reasoning tasks to openai (Issue #49)', () => {
    const policy: RoutingPolicy = { requiresReasoning: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('openai')
  })

  it('excludes local providers that do not support reasoning', () => {
    const policy: RoutingPolicy = { requiresReasoning: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('lm-studio-a')
  })

  it('throws when reasoning required but no capable provider available', () => {
    const policy: RoutingPolicy = { requiresReasoning: true }
    expect(() => resolveProviderChain(policy, SHORT_PROMPT, LOCAL_PROVIDERS)).toThrow()
  })
})

// ── promptLengthThreshold (Issue #49, #52 code-heavy / long prompts) ─────────

describe('promptLengthThreshold', () => {
  it('short prompt below threshold: preferred local provider is selected', () => {
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
      promptLengthThreshold: 1000,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('lm-studio-a')
  })

  it('long prompt above threshold: remote provider is prioritised (Issue #52)', () => {
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
      promptLengthThreshold: 1000,
    }
    const decision = resolveProviderChain(policy, LONG_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('openai')
    // Local providers are still in the chain as final fallback
    expect(decision.orderedChain).toContain('lm-studio-a')
  })

  it('records threshold policy match when exceeded', () => {
    const policy: RoutingPolicy = {
      promptLengthThreshold: 1000,
    }
    const decision = resolveProviderChain(policy, LONG_PROMPT, ALL_PROVIDERS)
    expect(decision.policyMatches.some(m => m.includes('promptLengthThreshold'))).toBe(true)
  })

  it('does not reorder when prompt equals threshold exactly', () => {
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
      promptLengthThreshold: 1000,
    }
    // exactly 1000 tokens — threshold is not exceeded (strictly greater)
    const decision = resolveProviderChain(policy, 1000, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('lm-studio-a')
  })
})

// ── Context window filter (Issue #49) ───────────────────────────────────────

describe('context window filter', () => {
  it('excludes providers whose context window is smaller than the prompt', () => {
    // lm-studio-a has maxContextTokens: 4096
    // A prompt of 5000 tokens should exclude both local providers
    const policy: RoutingPolicy = {}
    const decision = resolveProviderChain(policy, 5000, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('lm-studio-a')
    expect(decision.orderedChain).not.toContain('lm-studio-b')
    expect(decision.orderedChain).toContain('openai')
  })

  it('records context window rejection reason', () => {
    const policy: RoutingPolicy = {}
    const decision = resolveProviderChain(policy, 5000, ALL_PROVIDERS)
    const rejection = decision.rejectedCandidates.find(r => r.provider === 'lm-studio-a')
    expect(rejection?.reason).toContain('Context window')
  })
})

// ── allowPaidFallback — smart failover (Issue #50) ──────────────────────────

describe('allowPaidFallback — smart failover (Issue #50)', () => {
  it('appends paid provider to chain when maxCostClass excludes it', () => {
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
      maxCostClass: 'free',
      allowPaidFallback: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    // Primary: local providers; fallback: openai
    expect(decision.orderedChain[0]).toBe('lm-studio-a')
    expect(decision.orderedChain[decision.orderedChain.length - 1]).toBe('openai')
  })

  it('marks usedFallback when paid fallback is the only option', () => {
    // allowedProviders only covers openai; maxCostClass: 'free' excludes it from
    // primary — but allowPaidFallback should re-admit it
    const policy: RoutingPolicy = {
      maxCostClass: 'free',
      allowPaidFallback: true,
    }
    // Simulate only openai being registered
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ['openai'])
    expect(decision.usedFallback).toBe(true)
    expect(decision.orderedChain).toContain('openai')
  })

  it('does not add paid fallback when allowPaidFallback is false', () => {
    const policy: RoutingPolicy = {
      maxCostClass: 'free',
      allowPaidFallback: false,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.orderedChain).not.toContain('openai')
  })

  it('records fallbackReason when fallback is activated', () => {
    const policy: RoutingPolicy = {
      maxCostClass: 'free',
      allowPaidFallback: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ['openai'])
    expect(decision.fallbackReason).toBeDefined()
    expect(decision.fallbackReason).toMatch(/fallback/i)
  })

  it('policyMatches includes allowPaidFallback entry when activated', () => {
    const policy: RoutingPolicy = {
      maxCostClass: 'free',
      allowPaidFallback: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ['openai'])
    expect(decision.policyMatches.some(m => m.includes('allowPaidFallback'))).toBe(true)
  })
})

// ── Provider outage / unavailability (Issue #52) ────────────────────────────

describe('provider outage scenarios (Issue #52)', () => {
  it('includes fallback providers in ordered chain after preferred', () => {
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    // All available providers should be in the chain
    expect(decision.orderedChain).toContain('lm-studio-a')
    expect(decision.orderedChain).toContain('openai')
    // Preferred provider is first
    expect(decision.orderedChain[0]).toBe('lm-studio-a')
  })

  it('throws when no providers are available', () => {
    const policy: RoutingPolicy = { preferredProvider: 'lm-studio-a' }
    expect(() => resolveProviderChain(policy, SHORT_PROMPT, [])).toThrow()
  })

  it('throws when requiresTools and no tool-capable provider is registered', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    expect(() => resolveProviderChain(policy, SHORT_PROMPT, LOCAL_PROVIDERS)).toThrow()
  })
})

// ── Policy override combinations ────────────────────────────────────────────

describe('policy override combinations (Issue #52)', () => {
  it('tool-agent policy routes only to openai', () => {
    // Mirrors tool-agent config
    const policy: RoutingPolicy = {
      preferredProvider: 'openai',
      requiresTools: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('openai')
    expect(decision.orderedChain.every(p => p === 'openai')).toBe(true)
  })

  it('deep-reasoner policy routes only to openai', () => {
    // Mirrors deep-reasoner config
    const policy: RoutingPolicy = {
      preferredProvider: 'openai',
      requiresReasoning: true,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('openai')
  })

  it('local-analyst policy restricts to free local providers', () => {
    // Mirrors local-analyst config
    const policy: RoutingPolicy = {
      preferredProvider: 'lm-studio-a',
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
      maxCostClass: 'free',
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBe('lm-studio-a')
    expect(decision.orderedChain).not.toContain('openai')
  })

  it('fast-helper policy routes long prompts to openai first', () => {
    // Mirrors fast-helper config
    const policy: RoutingPolicy = {
      preferredProvider: 'openai',
      promptLengthThreshold: 1000,
      allowPaidFallback: true,
    }
    const decision = resolveProviderChain(policy, LONG_PROMPT, ALL_PROVIDERS)
    // openai is already the preferred provider and is remote, so it comes first
    expect(decision.orderedChain[0]).toBe('openai')
  })
})

// ── Routing decision structure (Issue #51 logging support) ──────────────────

describe('routing decision structure (Issue #51)', () => {
  it('always returns selectedProvider, orderedChain, reason, and policyMatches', () => {
    const policy: RoutingPolicy = { preferredProvider: 'lm-studio-a' }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.selectedProvider).toBeDefined()
    expect(Array.isArray(decision.orderedChain)).toBe(true)
    expect(decision.reason).toBeDefined()
    expect(Array.isArray(decision.policyMatches)).toBe(true)
    expect(Array.isArray(decision.rejectedCandidates)).toBe(true)
    expect(typeof decision.usedFallback).toBe('boolean')
  })

  it('rejected candidates include provider name and reason', () => {
    const policy: RoutingPolicy = { requiresTools: true }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    decision.rejectedCandidates.forEach(r => {
      expect(r.provider).toBeDefined()
      expect(r.reason).toBeDefined()
    })
  })

  it('policyMatches records every triggered rule', () => {
    const policy: RoutingPolicy = {
      allowedProviders: ['lm-studio-a', 'openai'],
      maxCostClass: 'free',
      requiresTools: false,
    }
    const decision = resolveProviderChain(policy, SHORT_PROMPT, ALL_PROVIDERS)
    expect(decision.policyMatches.some(m => m.includes('allowedProviders'))).toBe(true)
    expect(decision.policyMatches.some(m => m.includes('maxCostClass'))).toBe(true)
  })
})
