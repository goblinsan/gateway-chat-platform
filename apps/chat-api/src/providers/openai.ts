import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
  ModelInfo,
  StreamEvent,
  ConnectionResult,
} from '@gateway/shared'
import { withRetry, withTimeout } from '../utils/retry'
import {
  normalizeChatResponse,
  normalizeModel,
  readSseStream,
  type OpenAIChatResponse,
  type OpenAIModelsResponse,
} from './normalize'

/**
 * Adapter for the OpenAI paid API.
 * Supports chat completion, streaming, model listing, and connection testing.
 * Issue #14: Implement first paid provider adapter.
 */
export class OpenAiAdapter implements ProviderAdapter {
  readonly name: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(
    name: string,
    apiKey: string,
    baseUrl = 'https://api.openai.com',
    timeoutMs = 60_000,
  ) {
    this.name = name
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  async sendChat(request: ChatRequest): Promise<ChatResponse> {
    return withRetry(() => this._doSendChat(request), { maxAttempts: 3, initialDelayMs: 1_000 })
  }

  private async _doSendChat(request: ChatRequest): Promise<ChatResponse> {
    const response = await withTimeout(
      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.authHeaders,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
        }),
      }),
      this.timeoutMs,
    )

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    const data = (await response.json()) as OpenAIChatResponse
    return normalizeChatResponse(data)
  }

  async streamChat(
    request: ChatRequest,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    const response = await withTimeout(
      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.authHeaders,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
        }),
      }),
      this.timeoutMs,
    )

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      onEvent({ type: 'error', error: `HTTP ${response.status}: ${text}` })
      return
    }

    await readSseStream(response, onEvent)
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await withTimeout(
      fetch(`${this.baseUrl}/v1/models`, { headers: this.authHeaders }),
      this.timeoutMs,
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = (await response.json()) as OpenAIModelsResponse
    return data.data.map(normalizeModel)
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now()
    try {
      const response = await withTimeout(
        fetch(`${this.baseUrl}/v1/models`, { headers: this.authHeaders }),
        5_000,
      )
      const latencyMs = Date.now() - start
      // 401 means the host is reachable even if the key is invalid
      if (response.ok || response.status === 401) {
        return { status: 'ok', latencyMs }
      }
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` }
    } catch (err) {
      const latencyMs = Date.now() - start
      const error = err instanceof Error ? err.message : String(err)
      return { status: 'error', latencyMs, error }
    }
  }
}
