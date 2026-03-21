import type { CostClass } from '@gateway/shared'

/** Static capability profile for a registered provider. */
export interface ProviderCapabilities {
  /** Relative cost tier of this provider. */
  costClass: CostClass
  /** Whether the provider supports tool/function calling. */
  supportsTools: boolean
  /** Whether the provider supports extended chain-of-thought reasoning. */
  supportsReasoning: boolean
  /** Maximum input+output context window in tokens. */
  maxContextTokens: number
  /** True for self-hosted / local providers; false for remote cloud APIs. */
  isLocal: boolean
}

/**
 * Default capability profiles for known providers.
 * These can be overridden at runtime by registering a custom map.
 */
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  'lm-studio-a': {
    costClass: 'free',
    supportsTools: false,
    supportsReasoning: false,
    maxContextTokens: 4096,
    isLocal: true,
  },
  'lm-studio-b': {
    costClass: 'free',
    supportsTools: false,
    supportsReasoning: false,
    maxContextTokens: 4096,
    isLocal: true,
  },
  openai: {
    costClass: 'premium',
    supportsTools: true,
    supportsReasoning: true,
    maxContextTokens: 128000,
    isLocal: false,
  },
}

/** Numeric ordering for cost classes (lower = cheaper). */
const COST_ORDER: Record<string, number> = { free: 0, cheap: 1, premium: 2 }

/** Returns a numeric value for a cost class string for comparison. */
export function costClassValue(c: string): number {
  return COST_ORDER[c] ?? 99
}
