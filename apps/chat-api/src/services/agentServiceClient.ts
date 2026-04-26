import type { ProviderMessage } from '@gateway/shared'
import { getEnv } from '../config/env'

export interface AgentServiceRequest {
  agentId: string
  model: string
  messages: ProviderMessage[]
  temperature?: number
  maxTokens?: number
  modelParams?: Record<string, unknown>
  workflowId?: string
  workflowSource?: string
  deliveryMode?: string
  userId?: string
  channelId?: string
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
  status?: 'completed' | 'approval_required' | 'paused'
  orchestrationState?: {
    runId?: string
    checkpointId?: string
    reason?: string
    requiredApprovers?: string[]
  }
  resultThreadId?: string
}

export type AgentServiceStreamEvent =
  | { type: 'token'; token: string }
  | {
      type: 'done'
      model: string
      status?: 'completed' | 'approval_required' | 'paused'
      orchestrationState?: {
        runId?: string
        checkpointId?: string
        reason?: string
        requiredApprovers?: string[]
      }
    }

export interface AgentServiceRun {
  ID: string
  Status: string
  Response?: string
  ModelBackend?: string
  Usage?: {
    PromptTokens?: number
    CompletionTokens?: number
    TotalTokens?: number
  }
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

const INITIAL_BACKOFF_MS = 200

export async function sendToAgentService(
  request: AgentServiceRequest,
): Promise<AgentServiceResponse> {
  const env = getEnv()

  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError(
      'AGENT_SERVICE_URL is not configured: cannot route request to agent-service',
    )
  }

  const isAutomationRequest = isAutomation(request)
  const url = isAutomationRequest
    ? `${env.AGENT_SERVICE_URL}/internal/automation`
    : `${env.AGENT_SERVICE_URL}/internal/chat`
  const headers = buildHeaders('application/json')
  const body = JSON.stringify(buildRequestBody(request, isAutomationRequest, 'sync'))
  const maxAttempts = Math.max(1, env.AGENT_SERVICE_RETRY_COUNT + 1)

  let lastError: Error = new AgentServiceError('No attempts made')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
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
          status: normalizeStatus(data.status),
          orchestrationState: extractOrchestrationState(data.orchestration_state),
          ...(request.threadId ? { resultThreadId: request.threadId } : {}),
        }
      }
      return data as unknown as AgentServiceResponse
    } catch (err) {
      lastError = err instanceof Error ? err : new AgentServiceError(String(err))
      if (err instanceof AgentServiceError && err.statusCode && err.statusCode < 500) {
        throw err
      }
      if (attempt < maxAttempts) {
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
  }

  throw lastError
}

export async function streamFromAgentService(
  request: AgentServiceRequest,
  onEvent: (event: AgentServiceStreamEvent) => void,
): Promise<AgentServiceResponse> {
  const env = getEnv()

  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError(
      'AGENT_SERVICE_URL is not configured: cannot route request to agent-service',
    )
  }

  const url = `${env.AGENT_SERVICE_URL}/internal/chat`
  const headers = buildHeaders('text/event-stream')
  const body = JSON.stringify(buildRequestBody(request, false, 'stream'))
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let selectedModel = request.model
  let pausedState: AgentServiceResponse['orchestrationState']
  let status: AgentServiceResponse['status']

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = JSON.parse(line.slice(6)) as { type?: string; data?: Record<string, unknown> }
      const data = payload.data ?? {}

      switch (payload.type) {
        case 'run.model_selected':
          selectedModel = String(data.backend ?? selectedModel)
          break
        case 'run.assistant_delta': {
          const token = String(data.delta ?? '')
          if (!token) break
          content += token
          onEvent({ type: 'token', token })
          break
        }
        case 'run.approval_requested':
          pausedState = {
            runId: typeof data.run_id === 'string' ? data.run_id : undefined,
            checkpointId: typeof data.approval_id === 'string' ? data.approval_id : undefined,
            reason: typeof data.reason === 'string' ? data.reason : undefined,
            requiredApprovers: [],
          }
          break
        case 'run.paused':
          status = 'approval_required'
          onEvent({
            type: 'done',
            model: selectedModel,
            status,
            orchestrationState: pausedState,
          })
          await reader.cancel().catch(() => undefined)
          return {
            agentId: request.agentId,
            usedProvider: 'agent-service',
            model: selectedModel,
            message: { role: 'assistant', content },
            status,
            orchestrationState: pausedState,
            ...(request.threadId ? { resultThreadId: request.threadId } : {}),
          }
        case 'run.completed':
          selectedModel = String(data.model_backend ?? selectedModel)
          if (!content && typeof data.response === 'string') {
            content = data.response
          }
          onEvent({ type: 'done', model: selectedModel, status: 'completed' })
          return {
            agentId: request.agentId,
            usedProvider: 'agent-service',
            model: selectedModel,
            message: { role: 'assistant', content },
            status: 'completed',
            ...(request.threadId ? { resultThreadId: request.threadId } : {}),
          }
        case 'run.failed':
          throw new AgentServiceError(String(data.error ?? 'agent-service run failed'))
      }
    }
  }

  onEvent({ type: 'done', model: selectedModel, status: status ?? 'completed', orchestrationState: pausedState })
  return {
    agentId: request.agentId,
    usedProvider: 'agent-service',
    model: selectedModel,
    message: { role: 'assistant', content },
    status: status ?? 'completed',
    orchestrationState: pausedState,
    ...(request.threadId ? { resultThreadId: request.threadId } : {}),
  }
}

function isAutomation(request: AgentServiceRequest): boolean {
  return Boolean(
    request.workflowId || request.workflowSource || request.deliveryMode || request.userId || request.channelId,
  )
}

function buildHeaders(accept: string): Record<string, string> {
  const env = getEnv()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: accept,
  }
  if (env.AGENT_SERVICE_API_KEY) {
    headers.Authorization = `Bearer ${env.AGENT_SERVICE_API_KEY}`
  }
  return headers
}

function buildRequestBody(
  request: AgentServiceRequest,
  isAutomationRequest: boolean,
  responseMode: 'sync' | 'stream',
): Record<string, unknown> {
  if (isAutomationRequest) {
    return {
      source: request.workflowSource ?? 'gateway-chat-platform',
      job_type: request.workflowId ? 'gateway_workflow' : 'gateway_automation',
      workflow_id: request.workflowId,
      prompt: request.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '',
      messages: request.messages,
      model_preferences: {
        preferred: request.model,
        ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
      },
      response_mode: responseMode,
      metadata: {
        ...(request.deliveryMode ? { delivery_mode: request.deliveryMode } : {}),
        ...(request.userId ? { user_id: request.userId } : {}),
        ...(request.channelId ? { channel_id: request.channelId } : {}),
        ...(request.threadId ? { thread_id: request.threadId } : {}),
      },
    }
  }

  return {
    request_id: request.threadId ?? request.agentId,
    thread_id: request.threadId,
    user_id: request.userId,
    agent_id: request.agentId,
    messages: request.messages,
    model_preferences: {
      preferred: request.model,
      ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
    },
  }
}

function extractOrchestrationState(raw: unknown): AgentServiceResponse['orchestrationState'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  return {
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    checkpointId: typeof value.checkpointId === 'string' ? value.checkpointId : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    requiredApprovers: Array.isArray(value.requiredApprovers)
      ? value.requiredApprovers.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  }
}

function normalizeStatus(raw: unknown): AgentServiceResponse['status'] | undefined {
  if (raw === 'completed' || raw === 'approval_required' || raw === 'paused') {
    return raw
  }
  return undefined
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const env = getEnv()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.AGENT_SERVICE_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function approveAgentServiceApproval(approvalId: string): Promise<void> {
  await postApprovalDecision(approvalId, 'approve')
}

export async function denyAgentServiceApproval(approvalId: string, reason?: string): Promise<void> {
  await postApprovalDecision(approvalId, 'deny', reason)
}

export async function fetchAgentServiceRun(runId: string): Promise<AgentServiceRun> {
  const env = getEnv()
  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError('AGENT_SERVICE_URL is not configured: cannot fetch run state')
  }

  const res = await fetchWithTimeout(`${env.AGENT_SERVICE_URL}/runs/${runId}`, {
    method: 'GET',
    headers: buildHeaders('application/json'),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  return await res.json() as AgentServiceRun
}

async function postApprovalDecision(
  approvalId: string,
  action: 'approve' | 'deny',
  reason?: string,
): Promise<void> {
  const env = getEnv()
  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError('AGENT_SERVICE_URL is not configured: cannot update approval state')
  }

  const res = await fetchWithTimeout(`${env.AGENT_SERVICE_URL}/approvals/${approvalId}/${action}`, {
    method: 'POST',
    headers: buildHeaders('application/json'),
    ...(action === 'deny' ? { body: JSON.stringify({ reason }) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}
