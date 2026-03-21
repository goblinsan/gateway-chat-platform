import type { CostClass } from './agent'

/**
 * Policy that governs how the routing engine selects a provider for a chat
 * request. Policies are attached to agent definitions server-side and are
 * never sent to the browser.
 */
export interface RoutingPolicy {
  /** Preferred provider name — used as the first candidate when it passes all filters. */
  preferredProvider?: string
  /**
   * Hard whitelist of provider names that may ever be used for this agent,
   * including in fallback. Providers not listed here are always excluded.
   */
  allowedProviders?: string[]
  /**
   * Maximum cost class permitted for primary candidate selection.
   * Providers whose cost class exceeds this value are excluded unless
   * `allowPaidFallback` re-admits them.
   */
  maxCostClass?: CostClass
  /** When true, only providers that support tool use are considered. */
  requiresTools?: boolean
  /** When true, only providers that support extended reasoning are considered. */
  requiresReasoning?: boolean
  /**
   * Estimated-token threshold above which remote (cloud) providers are
   * preferred over local ones due to larger context windows.
   */
  promptLengthThreshold?: number
  /**
   * When true, remote/paid providers that were excluded by `maxCostClass` are
   * appended at the end of the fallback chain so they can be reached at
   * runtime if all primary candidates are unavailable.
   */
  allowPaidFallback?: boolean
}

/** A single provider that was evaluated but not selected, with the reason. */
export interface RejectedCandidate {
  provider: string
  reason: string
}

/**
 * The result of running the routing engine against a policy and request
 * context. Contains the full ordered provider chain to attempt plus
 * diagnostic information to support logging and tuning.
 */
export interface RoutingDecision {
  /** The first provider in the chain — the one that will be attempted first. */
  selectedProvider: string
  /**
   * Full ordered list of providers to attempt in sequence.
   * The registry will try each in order, stopping on the first success.
   */
  orderedChain: string[]
  /** Human-readable explanation of why `selectedProvider` was chosen. */
  reason: string
  /** Providers that were available but excluded from the chain with reasons. */
  rejectedCandidates: RejectedCandidate[]
  /** Policy rules that were triggered during evaluation. */
  policyMatches: string[]
  /** True when the paid-fallback path was activated. */
  usedFallback: boolean
  /** Human-readable explanation of why the fallback path was activated. */
  fallbackReason?: string
}
