import type { ChatResponse, ModelInfo, StreamEvent, TokenUsage, ProviderMessage } from '@gateway/shared'

// OpenAI wire-format types (used by both LM Studio and OpenAI adapters)
export interface OpenAIMessage {
  role: string
  content: string | null
  reasoning_content?: string | null
}

export interface OpenAIChoice {
  message?: OpenAIMessage
  delta?: Partial<OpenAIMessage>
  finish_reason: string | null
  index: number
}

export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface OpenAIChatResponse {
  id: string
  model: string
  choices: OpenAIChoice[]
  usage?: OpenAIUsage
}

export interface OpenAICompletionChoice {
  text?: string | null
  finish_reason: string | null
  index: number
}

export interface OpenAICompletionResponse {
  id: string
  model: string
  choices: OpenAICompletionChoice[]
  usage?: OpenAIUsage
}

function isChatChoice(choice: OpenAIChoice | OpenAICompletionChoice | undefined): choice is OpenAIChoice {
  return Boolean(choice && typeof choice === 'object' && 'delta' in choice)
}

function isCompletionChoice(
  choice: OpenAIChoice | OpenAICompletionChoice | undefined,
): choice is OpenAICompletionChoice {
  return Boolean(choice && typeof choice === 'object' && 'text' in choice)
}

export interface OpenAIModel {
  id: string
  object: string
  owned_by?: string
}

export interface OpenAIModelsResponse {
  data: OpenAIModel[]
}

/** Maps an OpenAI finish_reason string to the normalized value. */
export function normalizeFinishReason(
  raw: string | null | undefined,
): ChatResponse['finishReason'] {
  switch (raw) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool_calls':
      return 'tool_calls'
    default:
      return null
  }
}

/** Maps raw OpenAI usage object to normalized TokenUsage. */
export function normalizeUsage(raw?: OpenAIUsage): TokenUsage | undefined {
  if (!raw) return undefined
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  }
}

/** Converts a full OpenAI chat completion response to the normalized ChatResponse. */
export function normalizeChatResponse(raw: OpenAIChatResponse): ChatResponse {
  const choice = raw.choices[0]
  const msg = choice?.message
  const content = msg?.content || msg?.reasoning_content || ''
  return {
    id: raw.id,
    model: raw.model,
    message: {
      role: (msg?.role as ProviderMessage['role']) ?? 'assistant',
      content,
    },
    finishReason: normalizeFinishReason(choice?.finish_reason),
    usage: normalizeUsage(raw.usage),
  }
}

/** Converts a full OpenAI completion response to the normalized ChatResponse. */
export function normalizeCompletionResponse(raw: OpenAICompletionResponse): ChatResponse {
  const choice = raw.choices[0]
  const content = choice?.text ?? ''
  return {
    id: raw.id,
    model: raw.model,
    message: {
      role: 'assistant',
      content,
    },
    finishReason: normalizeFinishReason(choice?.finish_reason),
    usage: normalizeUsage(raw.usage),
  }
}

/** Converts a raw OpenAI model entry to the normalized ModelInfo. */
export function normalizeModel(raw: OpenAIModel): ModelInfo {
  return { id: raw.id, name: raw.id }
}

/**
 * Parses one SSE line into a StreamEvent.
 * Returns null for blank lines or non-data lines.
 */
export function parseStreamLine(line: string): StreamEvent | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return { type: 'done' }

  try {
    const parsed = JSON.parse(data) as OpenAIChatResponse | OpenAICompletionResponse
    const choice = parsed.choices?.[0]
    const delta = isChatChoice(choice) ? choice.delta : undefined

    if (choice?.finish_reason) {
      return {
        type: 'done',
        finishReason: choice.finish_reason,
        usage: normalizeUsage(parsed.usage),
      }
    }

    if (delta?.content) {
      return { type: 'token', token: delta.content }
    }

    if (isCompletionChoice(choice) && typeof choice.text === 'string' && choice.text.length > 0) {
      return { type: 'token', token: choice.text }
    }

    // Skip reasoning_content during streaming — it's the model's internal
    // chain-of-thought (e.g. Qwen3.5) and should not be shown to the user.
    // The actual answer arrives in subsequent `content` deltas.

    return null
  } catch {
    return null
  }
}

/**
 * Reads an SSE response body and emits normalized StreamEvents.
 * Handles both standard SSE delimiters and long single-line events.
 */
export async function readSseStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    onEvent({ type: 'error', error: 'No response body' })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    let reading = true
    while (reading) {
      const { done, value } = await reader.read()
      if (done) {
        reading = false
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line || !line.startsWith('data: ')) continue
        const event = parseStreamLine(line)
        if (event) {
          onEvent(event)
          if (event.type === 'done' || event.type === 'error') return
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
