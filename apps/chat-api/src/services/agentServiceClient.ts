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

  const url = `${env.AGENT_SERVICE_URL}/run`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (env.AGENT_SERVICE_API_KEY) {
    headers['Authorization'] = `Bearer ${env.AGENT_SERVICE_API_KEY}`
  }

  const body = JSON.stringify(request)
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

      const data = (await res.json()) as AgentServiceResponse
      return data
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
