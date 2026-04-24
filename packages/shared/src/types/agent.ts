import type { RoutingPolicy } from './routing'

export type CostClass = 'free' | 'cheap' | 'premium'

/**
 * Determines how the agent is executed at runtime.
 * - `direct_provider`: Request is sent directly to a provider via the provider registry (default, preserves existing behavior).
 * - `orchestrated`: Request is forwarded to the internal agent-service for orchestrated execution.
 */
export type ExecutionMode = 'direct_provider' | 'orchestrated'

/** Configuration for a model endpoint that an agent connects to. */
export interface ModelEndpointConfig {
  /** Base URL for the model API (e.g. http://192.168.0.172:1234) */
  baseUrl?: string
  /** API key if the endpoint requires authentication */
  apiKey?: string
  /** Model-specific parameters passed to the provider */
  modelParams?: Record<string, unknown>
}

/** Location reference for context or memory that the agent should use. */
export interface ContextSource {
  /** Identifier for this context source */
  id: string
  /** Type of context source */
  type: 'url' | 'file' | 'database' | 'vector-store'
  /** Connection string, URL, or path to the source */
  location: string
  /** Human-readable description */
  description?: string
}

export interface AgentConfig {
  id: string
  name: string
  /** Emoji or short identifier displayed in the UI */
  icon: string
  /** CSS hex colour used to accent the agent tab */
  color: string
  providerName: string
  model: string
  costClass: CostClass
  /** Server-side system prompt — never sent to the browser */
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  /** Enable extended reasoning where the provider supports it */
  enableReasoning?: boolean
  featureFlags?: Record<string, boolean>
  /** Server-side routing policy — never sent to the browser */
  routingPolicy?: RoutingPolicy
  /** Model endpoint override — allows pointing the agent at a specific endpoint */
  endpointConfig?: ModelEndpointConfig
  /** Context and memory sources available to this agent */
  contextSources?: ContextSource[]
  /**
   * Controls whether this agent is executed via the direct provider registry or
   * routed through the internal agent-service orchestrator.
   * Defaults to `direct_provider` to preserve existing behavior for all agents
   * unless explicitly opted into orchestration.
   */
  executionMode?: ExecutionMode
  /** Whether this agent was loaded from an external config source (vs. seed data) */
  source?: 'seed' | 'database' | 'remote'
  /** Whether this agent is active and available for use */
  enabled?: boolean
}

/**
 * Public agent metadata returned by GET /api/agents.
 * Sensitive fields are deliberately omitted to keep them server-side.
 */
export interface AgentListItem extends Omit<AgentConfig, 'systemPrompt' | 'routingPolicy' | 'endpointConfig' | 'contextSources'> {
  ttsVoiceId?: string
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentRequest {
  agentId: string
  messages: AgentMessage[]
  stream?: boolean
}

export interface AgentResponse {
  agentId: string
  message: AgentMessage
  finishReason: 'stop' | 'length' | 'error'
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
