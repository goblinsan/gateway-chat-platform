import type { RoutingPolicy } from './routing'

export type CostClass = 'free' | 'cheap' | 'premium'

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
}

/**
 * Public agent metadata returned by GET /api/agents.
 * systemPrompt and routingPolicy are deliberately omitted to keep them server-side.
 */
export type AgentListItem = Omit<AgentConfig, 'systemPrompt' | 'routingPolicy'>

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
