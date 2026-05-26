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
    toolName?: string
    toolParams?: Record<string, unknown>
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
        toolName?: string
        toolParams?: Record<string, unknown>
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
          usage: normalizeAutomationUsage(data.usage),
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
            toolName: typeof data.tool_name === 'string' ? data.tool_name : undefined,
            toolParams: typeof data.params === 'object' && data.params !== null
              ? data.params as Record<string, unknown>
              : undefined,
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
    request.workflowId || request.workflowSource || request.deliveryMode || request.channelId,
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
      request_id: request.threadId ?? request.workflowId ?? request.agentId,
      thread_id: request.threadId,
      user_id: request.userId,
      agent_id: request.agentId,
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
    toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
    toolParams: typeof value.toolParams === 'object' && value.toolParams !== null
      ? value.toolParams as Record<string, unknown>
      : undefined,
  }
}

function normalizeStatus(raw: unknown): AgentServiceResponse['status'] | undefined {
  if (raw === 'completed' || raw === 'approval_required' || raw === 'paused') {
    return raw
  }
  return undefined
}

function normalizeAutomationUsage(raw: unknown): AgentServiceResponse['usage'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const promptTokens = typeof value.prompt_tokens === 'number' ? value.prompt_tokens : undefined
  const completionTokens = typeof value.completion_tokens === 'number' ? value.completion_tokens : undefined
  const totalTokens = typeof value.total_tokens === 'number'
    ? value.total_tokens
    : typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : undefined
  if (
    typeof promptTokens !== 'number'
    || typeof completionTokens !== 'number'
    || typeof totalTokens !== 'number'
  ) {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens }
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

// ----------------------------------------------------------------------------
// Per-user thread browsing
//
// These helpers proxy chat-api's /threads routes to agent-service's
// /internal/threads endpoints so the web chat-ui and the iOS GatewayApp can
// list, load, rename, and delete a user's prior conversations (which are
// persisted server-side as agent-service sessions/runs).
// ----------------------------------------------------------------------------

export interface AgentServiceThreadSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  last_snippet?: string
  last_agent_id?: string
}

export interface AgentServiceThreadMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  run_id?: string
  agent_id?: string
}

function buildUserHeaders(userId: string, accept = 'application/json'): Record<string, string> {
  return { ...buildHeaders(accept), 'X-User-ID': userId }
}

function requireAgentServiceUrl(): string {
  const env = getEnv()
  if (!env.AGENT_SERVICE_URL) {
    throw new AgentServiceError('AGENT_SERVICE_URL is not configured: cannot reach agent-service')
  }
  return env.AGENT_SERVICE_URL
}

export async function fetchThreadsFromAgentService(
  userId: string,
  limit?: number,
): Promise<AgentServiceThreadSummary[]> {
  const base = requireAgentServiceUrl()
  const url = new URL(`${base}/internal/threads`)
  if (limit && limit > 0) url.searchParams.set('limit', String(limit))
  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  const body = (await res.json()) as { threads?: AgentServiceThreadSummary[] }
  return body.threads ?? []
}

export async function fetchThreadFromAgentService(
  userId: string,
  threadId: string,
): Promise<{ threadId: string; messages: AgentServiceThreadMessage[] }> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/threads/${encodeURIComponent(threadId)}`, {
    method: 'GET',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  const body = (await res.json()) as { thread_id?: string; messages?: AgentServiceThreadMessage[] }
  return { threadId: body.thread_id ?? threadId, messages: body.messages ?? [] }
}

export async function renameThreadInAgentService(
  userId: string,
  threadId: string,
  title: string,
): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: buildUserHeaders(userId),
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function deleteThreadInAgentService(
  userId: string,
  threadId: string,
): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export interface AgentServiceNotification {
  id: string
  user_id: string
  kind: string
  title: string
  body?: string
  thread_id?: string
  source_run_id?: string
  payload?: Record<string, unknown>
  read_at?: string
  dismissed_at?: string
  created_at: string
}

function normalizeNotificationRecord(input: Record<string, unknown>): AgentServiceNotification {
  return {
    id: String(input.id ?? input.ID ?? ''),
    user_id: String(input.user_id ?? input.UserID ?? ''),
    kind: String(input.kind ?? input.Kind ?? 'notification'),
    title: String(input.title ?? input.Title ?? ''),
    body: typeof (input.body ?? input.Body) === 'string' ? String(input.body ?? input.Body) : undefined,
    thread_id: typeof (input.thread_id ?? input.ThreadID) === 'string' ? String(input.thread_id ?? input.ThreadID) : undefined,
    source_run_id: typeof (input.source_run_id ?? input.SourceRunID) === 'string' ? String(input.source_run_id ?? input.SourceRunID) : undefined,
    payload: typeof (input.payload ?? input.Payload) === 'object' && (input.payload ?? input.Payload) !== null
      ? (input.payload ?? input.Payload) as Record<string, unknown>
      : undefined,
    read_at: typeof (input.read_at ?? input.ReadAt) === 'string' ? String(input.read_at ?? input.ReadAt) : undefined,
    dismissed_at: typeof (input.dismissed_at ?? input.DismissedAt) === 'string' ? String(input.dismissed_at ?? input.DismissedAt) : undefined,
    created_at: String(input.created_at ?? input.CreatedAt ?? ''),
  }
}

export interface AgentServiceSchedule {
  id: string
  user_id: string
  kind: string
  prompt: string
  thread_id?: string
  agent_id?: string
  payload?: Record<string, unknown>
  run_at: string
  recurrence?: string
  status: string
  last_run_at?: string
  created_at: string
  updated_at: string
}

export async function fetchNotificationsFromAgentService(
  userId: string,
  unreadOnly = true,
  limit?: number,
): Promise<AgentServiceNotification[]> {
  const base = requireAgentServiceUrl()
  const url = new URL(`${base}/internal/notifications`)
  url.searchParams.set('unread_only', unreadOnly ? 'true' : 'false')
  if (limit && limit > 0) url.searchParams.set('limit', String(limit))
  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  const body = (await res.json()) as { notifications?: Record<string, unknown>[] }
  return (body.notifications ?? []).map(normalizeNotificationRecord)
}

export async function markNotificationReadInAgentService(userId: string, notificationId: string): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function markAllNotificationsReadInAgentService(userId: string): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/notifications/read-all`, {
    method: 'POST',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function deleteNotificationInAgentService(userId: string, notificationId: string): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/notifications/${encodeURIComponent(notificationId)}`, {
    method: 'DELETE',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function createScheduleInAgentService(
  userId: string,
  input: {
    kind?: string
    prompt: string
    run_at: string
    recurrence?: string
    thread_id?: string
    agent_id?: string
    payload?: Record<string, unknown>
  },
): Promise<AgentServiceSchedule> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/schedules`, {
    method: 'POST',
    headers: buildUserHeaders(userId),
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  return await res.json() as AgentServiceSchedule
}

export async function listSchedulesFromAgentService(userId: string, limit?: number): Promise<AgentServiceSchedule[]> {
  const base = requireAgentServiceUrl()
  const url = new URL(`${base}/internal/schedules`)
  if (limit && limit > 0) url.searchParams.set('limit', String(limit))
  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
  const body = (await res.json()) as { schedules?: AgentServiceSchedule[] }
  return body.schedules ?? []
}

export async function deleteScheduleInAgentService(userId: string, scheduleId: string): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function registerDeviceTokenInAgentService(
  userId: string,
  input: { platform: string; token: string; app_version?: string },
): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/device-tokens`, {
    method: 'POST',
    headers: buildUserHeaders(userId),
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}

export async function unregisterDeviceTokenInAgentService(userId: string, token: string): Promise<void> {
  const base = requireAgentServiceUrl()
  const res = await fetchWithTimeout(`${base}/internal/device-tokens/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    headers: buildUserHeaders(userId),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AgentServiceError(`agent-service returned ${res.status}: ${text}`, res.status)
  }
}
