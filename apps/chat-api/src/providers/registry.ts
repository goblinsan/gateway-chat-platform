import type { ProviderAdapter, ChatRequest, ChatResponse, StreamEvent } from '@gateway/shared'
import { LmStudioAdapter } from './lmStudio'
import { OpenAiAdapter } from './openai'
import type { Env } from '../config/env'

/** Result of a chat request that includes which provider ultimately served it. */
export interface FallbackChatResult {
  response: ChatResponse
  usedProvider: string
}

/**
 * Registry that holds all configured provider adapters and supports
 * ordered fallback chains for resilient request handling.
 * Issue #18: Implement provider fallback handling.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()
  private readonly fallbackChains = new Map<string, string[]>()

  /** Register a provider adapter under its own name. */
  register(adapter: ProviderAdapter): this {
    this.adapters.set(adapter.name, adapter)
    return this
  }

  /**
   * Declare an ordered fallback chain for a primary provider.
   * When the primary fails, the registry will try each fallback in order.
   */
  setFallbackChain(primaryName: string, fallbacks: string[]): this {
    this.fallbackChains.set(primaryName, fallbacks)
    return this
  }

  /** Look up a registered adapter by name. */
  get(name: string): ProviderAdapter | undefined {
    return this.adapters.get(name)
  }

  /** Return all registered adapters. */
  getAll(): ProviderAdapter[] {
    return Array.from(this.adapters.values())
  }

  /**
   * Send a chat request, trying the primary provider first and then each
   * configured fallback in order if the primary is unavailable.
   * Throws only if all providers in the chain fail.
   */
  async sendChatWithFallback(
    primaryName: string,
    request: ChatRequest,
  ): Promise<FallbackChatResult> {
    const chain = [primaryName, ...(this.fallbackChains.get(primaryName) ?? [])]
    let lastError: unknown

    for (const name of chain) {
      const adapter = this.adapters.get(name)
      if (!adapter) continue
      try {
        const response = await adapter.sendChat(request)
        return { response, usedProvider: name }
      } catch (err) {
        lastError = err
      }
    }

    throw (
      lastError ??
      new Error(`No available provider in chain: ${chain.join(' -> ')}`)
    )
  }

  /**
   * Stream a chat response, trying the primary provider first and then each
   * configured fallback in order if the primary is unavailable.
   * Issues an 'error' StreamEvent and throws only if all providers fail.
   */
  async streamChatWithFallback(
    primaryName: string,
    request: ChatRequest,
    onEvent: (event: StreamEvent) => void,
  ): Promise<string> {
    const chain = [primaryName, ...(this.fallbackChains.get(primaryName) ?? [])]
    let lastError: unknown

    for (const name of chain) {
      const adapter = this.adapters.get(name)
      if (!adapter) continue
      try {
        await adapter.streamChat(request, onEvent)
        return name
      } catch (err) {
        lastError = err
      }
    }

    const error =
      lastError instanceof Error ? lastError.message : `No available provider in chain: ${chain.join(' -> ')}`
    onEvent({ type: 'error', error })
    throw lastError ?? new Error(error)
  }
}

/**
 * Builds and returns a ProviderRegistry populated from the application
 * environment configuration. Registers all enabled providers and configures
 * default fallback chains (lm-studio-a → lm-studio-b → openai).
 */
export function buildRegistry(env: Env): ProviderRegistry {
  const registry = new ProviderRegistry()

  if (env.LM_STUDIO_A_BASE_URL) {
    registry.register(new LmStudioAdapter('lm-studio-a', env.LM_STUDIO_A_BASE_URL))
  }
  if (env.LM_STUDIO_B_BASE_URL) {
    registry.register(new LmStudioAdapter('lm-studio-b', env.LM_STUDIO_B_BASE_URL))
  }
  if (env.OPENAI_API_KEY) {
    registry.register(new OpenAiAdapter('openai', env.OPENAI_API_KEY))
  }

  // Default fallback chain: lm-studio-a → lm-studio-b → openai
  if (env.LM_STUDIO_A_BASE_URL) {
    const fallbacks: string[] = []
    if (env.LM_STUDIO_B_BASE_URL) fallbacks.push('lm-studio-b')
    if (env.OPENAI_API_KEY) fallbacks.push('openai')
    registry.setFallbackChain('lm-studio-a', fallbacks)
  }

  return registry
}
