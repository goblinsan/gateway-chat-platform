// Normalized message format (Issue #15)
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Normalized chat request (Issue #15)
export interface ChatRequest {
  model: string
  messages: ProviderMessage[]
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
}

// Normalized token usage (Issue #15)
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// Normalized chat response (Issue #15)
export interface ChatResponse {
  id: string
  model: string
  message: ProviderMessage
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error' | null
  usage?: TokenUsage
}

// Normalized model listing entry
export interface ModelInfo {
  id: string
  name: string
  description?: string
}

// Unified streaming event format (Issue #16)
export interface StreamEvent {
  type: 'token' | 'done' | 'error'
  token?: string
  finishReason?: string
  usage?: TokenUsage
  error?: string
}

// Provider connection test result
export interface ConnectionResult {
  status: 'ok' | 'error'
  latencyMs: number
  error?: string
}

// Provider adapter interface (Issue #12)
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  result?: string
}

export interface ProviderAdapter {
  readonly name: string
  sendChat(request: ChatRequest): Promise<ChatResponse>
  streamChat(request: ChatRequest, onEvent: (event: StreamEvent) => void): Promise<void>
  listModels(): Promise<ModelInfo[]>
  testConnection(): Promise<ConnectionResult>
}
