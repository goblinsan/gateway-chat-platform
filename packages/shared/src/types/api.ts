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
