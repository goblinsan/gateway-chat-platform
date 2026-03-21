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
  message: {
    role: 'assistant'
    content: string
  }
}
