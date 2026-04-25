/**
 * Internal agent-service client (Issue #107).
 *
 * Forwards orchestrated chat requests to the internal agent-service with:
 * - Stable service-to-service authentication via a pre-shared API key.
 * - Configurable request timeout (AGENT_SERVICE_TIMEOUT_MS).
 * - Automatic retries with exponential back-off (AGENT_SERVICE_RETRY_COUNT).
 * - Normalized request/response payloads compatible with AgentChatResponse.
 */

import type { ProviderMessage } from '@gateway/shared'
import { getEnv } from '../config/env'

export interface AgentServiceRequest {
  agentId: string
  model: string
  messages: ProviderMessage[]
  temperature?: number
  maxTokens?: number
  modelParams?: Record<string, unknown>
  /** Workflow identifier passed from the automation context (Issue #114). */
  workflowId?: string
  /** Originating source passed from the automation context (Issue #114). */
  workflowSource?: string
  /** Delivery mode requested by the caller (Issue #114). */
  deliveryMode?: string
  /** Target user for inbox/channel delivery (Issue #114). */
  userId?: string
  /** Target channel for inbox/channel delivery (Issue #114). */
  channelId?: string
  /** Thread identifier for conversation attribution (Issue #114). */
  threadId?: string
}

export interface AgentServiceResponse {
  agentId: string
  usedProvider: string
  model: string
  message: {
    role: 'assistant'
    content: string
  }
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /**
   * Orchestration status returned by the agent-service (Issue #115).
   * Absent or `'completed'` means normal completion.
   * `'approval_required'` and `'paused'` indicate the run has been suspended.
   */
  status?: 'completed' | 'approval_required' | 'paused'
  /**
   * Additional orchestration state detail surfaced when the run is paused
   * or requires approval (Issue #115).
   */
  orchestrationState?: {
    checkpointId?: string
    reason?: string
    requiredApprovers?: string[]
  }
  /**
   * Optional thread identifier returned by the orchestrator for inbox/chat
   * delivery attribution (Issue #116).
   */
  resultThreadId?: string
}

export class AgentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'AgentServiceError'
  }
}

/** Initial back-off duration in milliseconds for the first retry. Subsequent retries double this value. */
const INITIAL_BACKOFF_MS = 200

/**
 * Send a chat request to the internal agent-service.
 * Throws `AgentServiceError` on unrecoverable failure after all retries.
 */
export async function sendToAgentService(
  request: AgentServiceRequest,
): Promise<AgentServiceResponse> {
  const env = getEnv()

  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError(
      'AGENT_SERVICE_URL is not configured: cannot route request to agent-service',
    )
  }

  const isAutomationRequest = Boolean(
    request.workflowId || request.workflowSource || request.deliveryMode || request.userId || request.channelId,
  )
  const url = isAutomationRequest
    ? `${env.AGENT_SERVICE_URL}/internal/automation`
    : `${env.AGENT_SERVICE_URL}/internal/chat`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (env.AGENT_SERVICE_API_KEY) {
    headers['Authorization'] = `Bearer ${env.AGENT_SERVICE_API_KEY}`
  }

  const body = JSON.stringify(
    isAutomationRequest
      ? {
          source: request.workflowSource ?? 'gateway-chat-platform',
          job_type: request.workflowId ? 'gateway_workflow' : 'gateway_automation',
          workflow_id: request.workflowId,
          prompt: request.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '',
          messages: request.messages,
          model_preferences: {
            preferred: request.model,
            ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
          },
          response_mode: 'sync',
          metadata: {
            ...(request.deliveryMode ? { delivery_mode: request.deliveryMode } : {}),
            ...(request.userId ? { user_id: request.userId } : {}),
            ...(request.channelId ? { channel_id: request.channelId } : {}),
            ...(request.threadId ? { thread_id: request.threadId } : {}),
          },
        }
      : {
          request_id: request.threadId ?? request.agentId,
          thread_id: request.threadId,
          user_id: request.userId,
          agent_id: request.agentId,
          messages: request.messages,
          model_preferences: {
            preferred: request.model,
            ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
          },
        },
  )
  const timeoutMs = env.AGENT_SERVICE_TIMEOUT_MS
  const maxAttempts = Math.max(1, env.AGENT_SERVICE_RETRY_COUNT + 1)

  let lastError: Error = new AgentServiceError('No attempts made')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new AgentServiceError(
          `agent-service returned ${res.status}: ${text}`,
          res.status,
        )
      }

      const data = await res.json() as Record<string, unknown>
      if (isAutomationRequest) {
        return {
          agentId: request.agentId,
          usedProvider: 'agent-service',
          model: String(data.model_backend ?? request.model),
          message: {
            role: 'assistant',
            content: String(data.output ?? ''),
          },
          ...(request.threadId ? { resultThreadId: request.threadId } : {}),
        }
      }
      return data as AgentServiceResponse
    } catch (err) {
      lastError = err instanceof Error ? err : new AgentServiceError(String(err))

      // Do not retry on client-side errors (4xx) — they won't succeed on retry
      if (err instanceof AgentServiceError && err.statusCode && err.statusCode < 500) {
        throw err
      }

      if (attempt < maxAttempts) {
        // Exponential back-off: INITIAL_BACKOFF_MS, 2×, 4×, …
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
