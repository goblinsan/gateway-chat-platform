import type { RoutingPolicy, RoutingDecision, RejectedCandidate, ProviderMessage } from '@gateway/shared'
import { PROVIDER_CAPABILITIES, costClassValue } from './capabilities'

/**
 * Estimates the token count of a list of messages using a simple heuristic
 * (~4 characters per token). Used to evaluate prompt-length thresholds without
 * a full tokeniser dependency.
 */
export function estimatePromptTokens(messages: Array<Pick<ProviderMessage, 'content'>>): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  return Math.ceil(totalChars / 4)
}

/**
 * Evaluates a routing policy against the set of currently registered providers
 * and returns an ordered chain of providers to attempt, together with
 * diagnostic information about every decision made.
 *
 * The chain should be passed to `ProviderRegistry.sendChatWithChain` or
 * `streamChatWithChain`; the registry will try each provider in order and
 * stop on the first success.
 *
 * Issue #47 – routing rules engine
 * Issue #49 – policy-based routing options
 * Issue #50 – smart failover policy rules
 * Issue #51 – routing decisions logged by the caller
 */
export function resolveProviderChain(
  policy: RoutingPolicy,
  promptTokenCount: number,
  availableProviders: string[],
): RoutingDecision {
  const rejectedCandidates: RejectedCandidate[] = []
  const policyMatches: string[] = []

  // ── Step 1: Hard-filter by allowedProviders whitelist ────────────────────
  let candidates = policy.allowedProviders?.length
    ? availableProviders.filter(p => policy.allowedProviders!.includes(p))
    : [...availableProviders]

  availableProviders
    .filter(p => !candidates.includes(p))
    .forEach(p => rejectedCandidates.push({ provider: p, reason: 'Not in allowedProviders list' }))

  if (policy.allowedProviders?.length) {
    policyMatches.push('allowedProviders filter applied')
  }

  // Helper: apply a filter, recording rejections and matching policy labels.
  function applyFilter(
    filterFn: (p: string) => boolean,
    rejectReason: (p: string) => string,
    matchDesc: string,
  ): void {
    const before = candidates
    candidates = candidates.filter(filterFn)
    const rejected = before.filter(p => !candidates.includes(p))
    rejected.forEach(p => rejectedCandidates.push({ provider: p, reason: rejectReason(p) }))
    if (rejected.length > 0) policyMatches.push(matchDesc)
  }

  // ── Step 2: Capability filters (hard constraints) ────────────────────────
  if (policy.requiresTools) {
    applyFilter(
      p => PROVIDER_CAPABILITIES[p]?.supportsTools !== false,
      () => 'Does not support tool use',
      'requiresTools filter applied',
    )
  }

  if (policy.requiresReasoning) {
    applyFilter(
      p => PROVIDER_CAPABILITIES[p]?.supportsReasoning !== false,
      () => 'Does not support extended reasoning',
      'requiresReasoning filter applied',
    )
  }

  // ── Step 3: Context-window filter ────────────────────────────────────────
  if (promptTokenCount > 0) {
    applyFilter(
      p => {
        const caps = PROVIDER_CAPABILITIES[p]
        return !caps || caps.maxContextTokens >= promptTokenCount
      },
      p => {
        const caps = PROVIDER_CAPABILITIES[p]
        return `Context window (${caps?.maxContextTokens ?? '?'} tokens) too small for prompt (${promptTokenCount} tokens)`
      },
      `Context window filter applied (prompt: ${promptTokenCount} tokens)`,
    )
  }

  // ── Step 4: Cost filter (soft constraint — may be bypassed by fallback) ──
  // Separate the "over-budget" providers so they can be re-admitted later by
  // allowPaidFallback without re-running the hard filters.
  let overBudget: string[] = []
  let primaryCandidates = candidates

  if (policy.maxCostClass !== undefined) {
    const maxValue = costClassValue(policy.maxCostClass)
    overBudget = candidates.filter(p => {
      const caps = PROVIDER_CAPABILITIES[p]
      return caps !== undefined && costClassValue(caps.costClass) > maxValue
    })
    primaryCandidates = candidates.filter(p => !overBudget.includes(p))
    overBudget.forEach(p => {
      const caps = PROVIDER_CAPABILITIES[p]
      rejectedCandidates.push({
        provider: p,
        reason: `Cost class '${caps?.costClass}' exceeds maxCostClass '${policy.maxCostClass}'`,
      })
    })
    if (overBudget.length > 0) {
      policyMatches.push(`maxCostClass '${policy.maxCostClass}' enforced`)
    }
  }

  // ── Step 5: Prompt-length threshold — reorder to prefer remote providers ─
  const exceedsThreshold =
    policy.promptLengthThreshold !== undefined &&
    promptTokenCount > policy.promptLengthThreshold

  // Helper: providers without a known capability entry are treated as non-local
  // (remote), which is the safe default when a provider's locality is unknown.
  const isLocalProvider = (p: string): boolean =>
    PROVIDER_CAPABILITIES[p]?.isLocal === true

  if (exceedsThreshold) {
    policyMatches.push(
      `promptLengthThreshold (${policy.promptLengthThreshold}) exceeded (prompt: ${promptTokenCount} tokens)`,
    )
    // Move remote providers to the front so they are attempted first.
    const local = primaryCandidates.filter(p => isLocalProvider(p))
    const remote = primaryCandidates.filter(p => !isLocalProvider(p))
    primaryCandidates = [...remote, ...local]
  }

  // ── Step 6: Sort primary candidates ──────────────────────────────────────
  const preferred = policy.preferredProvider

  if (exceedsThreshold) {
    // Remote-first; within each locality group, preferred before cost-sort.
    primaryCandidates.sort((a, b) => {
      const aLocal = isLocalProvider(a)
      const bLocal = isLocalProvider(b)
      if (aLocal !== bLocal) return aLocal ? 1 : -1
      if (a === preferred) return -1
      if (b === preferred) return 1
      return (
        costClassValue(PROVIDER_CAPABILITIES[a]?.costClass ?? 'premium') -
        costClassValue(PROVIDER_CAPABILITIES[b]?.costClass ?? 'premium')
      )
    })
  } else {
    // Normal: preferred provider first, then cost ascending.
    primaryCandidates.sort((a, b) => {
      if (a === preferred) return -1
      if (b === preferred) return 1
      return (
        costClassValue(PROVIDER_CAPABILITIES[a]?.costClass ?? 'premium') -
        costClassValue(PROVIDER_CAPABILITIES[b]?.costClass ?? 'premium')
      )
    })
  }

  // ── Step 7: allowPaidFallback — append over-budget remote providers ───────
  let usedFallback = false
  let fallbackReason: string | undefined
  let fallbackExtension: string[] = []

  if (policy.allowPaidFallback) {
    // Re-admit providers that were excluded only by the cost filter and are
    // not local (paid cloud APIs) as an ordered fallback extension.
    fallbackExtension = overBudget.filter(
      p => !isLocalProvider(p),
    )
    if (fallbackExtension.length > 0) {
      policyMatches.push('allowPaidFallback extension added')
      if (primaryCandidates.length === 0) {
        usedFallback = true
        fallbackReason =
          'No primary candidates available within cost budget; activating paid fallback'
      }
    }
  }

  const orderedChain = [...primaryCandidates, ...fallbackExtension]

  if (orderedChain.length === 0) {
    const rejectSummary = rejectedCandidates
      .map(r => `${r.provider} (${r.reason})`)
      .join(', ')
    throw new Error(
      `No suitable provider found for routing policy.${rejectSummary ? ` Rejected: ${rejectSummary}` : ' No providers registered.'}`,
    )
  }

  const selectedProvider = orderedChain[0]

  return {
    selectedProvider,
    orderedChain,
    reason:
      preferred && selectedProvider === preferred
        ? `Using preferred provider '${preferred}'`
        : `Selected '${selectedProvider}' based on routing policy`,
    rejectedCandidates,
    policyMatches,
    usedFallback,
    fallbackReason,
  }
}
