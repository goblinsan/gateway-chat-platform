export interface ChatThread {
  id: string
  agentId: string
  title: string
  createdAt: number
  messages: ThreadMessage[]
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  meta?: MessageMeta
}

export interface MessageMeta {
  model?: string
  usedProvider?: string
  latencyMs?: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  costClass?: string
  toolsAvailable?: string[]
  routingExplanation?: {
    selectedProvider: string
    reason: string
    orderedChain: string[]
    policyMatches: string[]
  }
}
