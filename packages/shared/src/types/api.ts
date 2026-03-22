import type { AgentListItem } from './agent'

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  version: string
  commit: string
  uptime: number
  nodeEnv: string
  dependencies: Record<string, { status: string; latencyMs?: number; error?: string }>
}

export interface ApiError {
  statusCode: number
  error: string
  message: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface SendMessageRequest {
  content: string
  agentId?: string
}

export interface SendMessageResponse {
  message: ChatMessage
}

/** Response for GET /api/agents */
export interface AgentsListResponse {
  agents: AgentListItem[]
}

/** Request body for POST /api/chat */
export interface AgentChatRequest {
  agentId: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Response body for POST /api/chat */
export interface AgentChatResponse {
  agentId: string
  usedProvider: string
  model?: string
  message: {
    role: 'assistant'
    content: string
  }
  latencyMs?: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  routingExplanation?: RoutingExplanation
}

export interface RoutingExplanation {
  selectedProvider: string
  reason: string
  orderedChain: string[]
  policyMatches: string[]
}

/** SSE done event emitted by POST /api/chat/stream */
export interface AgentStreamDoneEvent {
  type: 'done'
  agentId: string
  model: string
  usedProvider: string
  latencyMs: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  routingExplanation?: RoutingExplanation
}

export interface CompareRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  providerIds?: string[]
}

export interface CompareResult {
  provider: string
  model: string
  content: string
  latencyMs: number
  error?: string
}

export interface CompareResponse {
  results: CompareResult[]
}

export interface PromptItem {
  id: string
  title: string
  category: string
  prompt: string
  tags: string[]
}

export interface PromptsListResponse {
  prompts: PromptItem[]
}

export interface HandoffRequest {
  fromAgentId: string
  toAgentId: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: string
}

export interface HandoffResponse {
  toAgentId: string
  threadContext: Array<{ role: string; content: string }>
  handoffNote: string
}

/** Request body for POST /api/agents/:id/run */
export interface AgentRunRequest {
  prompt: string
  context?: {
    workflowId?: string
    source?: string
    metadata?: Record<string, unknown>
  }
  delivery?: {
    mode?: string
    channel?: string
    to?: string
  }
}

/** Response body for POST /api/agents/:id/run */
export interface AgentRunResponse {
  agentId: string
  usedProvider: string
  model: string
  content: string
  latencyMs: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}
