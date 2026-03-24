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
  normalizeCompletionResponse,
  normalizeModel,
  readSseStream,
  type OpenAIChatResponse,
  type OpenAICompletionResponse,
  type OpenAIModelsResponse,
} from './normalize'

/**
 * Adapter for LM Studio instances (hosts A and B).
 * LM Studio exposes an OpenAI-compatible REST API on the local network.
 * Issue #13: Implement LM Studio provider adapter.
 */
export class LmStudioAdapter implements ProviderAdapter {
  readonly name: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(name: string, baseUrl: string, timeoutMs = 30_000) {
    this.name = name
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
  }

  async sendChat(request: ChatRequest): Promise<ChatResponse> {
    return withRetry(() => this._doSendChat(request), { maxAttempts: 2, initialDelayMs: 500 })
  }

  private getModelParams(request: ChatRequest): Record<string, unknown> {
    return request.modelParams && typeof request.modelParams === 'object' ? request.modelParams : {}
  }

  private getChatTemplate(request: ChatRequest): string | undefined {
    const value = this.getModelParams(request).chatTemplate
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
  }

  private getRequestOptions(request: ChatRequest): Record<string, unknown> {
    const params = { ...this.getModelParams(request) }
    delete params.chatTemplate
    delete params.ttsVoiceId
    return params
  }

  private buildLlama3Prompt(messages: ChatRequest['messages']): string {
    const chunks = ['<|begin_of_text|>']
    for (const message of messages) {
      chunks.push(
        `<|start_header_id|>${message.role}<|end_header_id|>\n\n${message.content}<|eot_id|>`,
      )
    }
    chunks.push('<|start_header_id|>assistant<|end_header_id|>\n\n')
    return chunks.join('')
  }

  private sanitizeLlama3Text(text: string): string {
    return text
      .replace(/^<\|start_header_id\|>assistant<\|end_header_id\|>\s*/u, '')
      .split('<|eot_id|>')[0]
      .split('<|end_of_text|>')[0]
      .trim()
  }

  private async _doSendChat(request: ChatRequest): Promise<ChatResponse> {
    const chatTemplate = this.getChatTemplate(request)
    const requestOptions = this.getRequestOptions(request)
    if (chatTemplate === 'llama3' || chatTemplate === 'llama-3') {
      const response = await withTimeout(
        fetch(`${this.baseUrl}/v1/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            prompt: this.buildLlama3Prompt(request.messages),
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream: false,
            stop: ['<|eot_id|>', '<|end_of_text|>', '<|start_header_id|>'],
            ...requestOptions,
          }),
        }),
        this.timeoutMs,
      )

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      const data = (await response.json()) as OpenAICompletionResponse
      if (typeof data.choices?.[0]?.text === 'string') {
        data.choices[0].text = this.sanitizeLlama3Text(data.choices[0].text)
      }
      return normalizeCompletionResponse(data)
    }

    const response = await withTimeout(
      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
          ...requestOptions,
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
    const chatTemplate = this.getChatTemplate(request)
    const requestOptions = this.getRequestOptions(request)
    if (chatTemplate === 'llama3' || chatTemplate === 'llama-3') {
      try {
        const completion = await this._doSendChat({
          ...request,
          modelParams: {
            ...requestOptions,
            chatTemplate,
          },
        })
        if (completion.message.content) {
          onEvent({ type: 'token', token: completion.message.content })
        }
        onEvent({ type: 'done', finishReason: completion.finishReason ?? undefined, usage: completion.usage })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        onEvent({ type: 'error', error: message })
      }
      return
    }

    const response = await withTimeout(
      fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
          ...requestOptions,
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
      fetch(`${this.baseUrl}/v1/models`),
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
      const response = await withTimeout(fetch(`${this.baseUrl}/v1/models`), 5_000)
      const latencyMs = Date.now() - start
      if (response.ok) {
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
