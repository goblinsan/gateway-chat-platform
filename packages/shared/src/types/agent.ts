export interface AgentConfig {
  id: string
  name: string
  providerName: string
  model: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
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
