export interface ChatThread {
  id: string
  agentId: string
  title: string
  createdAt: number
  messages: ThreadMessage[]
  ttsEnabled?: boolean
  defaultModel?: string
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  meta?: MessageMeta
  ttsAudioBase64?: string
}

export interface MessageMeta {
  inboxMessageId?: string
  inboxKind?: string
  inboxChannelId?: string
  status?: 'completed' | 'approval_required' | 'paused' | 'approved' | 'denied'
  orchestrationState?: {
    runId?: string
    checkpointId?: string
    reason?: string
    requiredApprovers?: string[]
    toolName?: string
    toolParams?: Record<string, unknown>
  }
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
