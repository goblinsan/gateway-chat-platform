export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Classifies an error as retryable (network issues, rate limits).
 * Non-idempotent operations should not be retried regardless.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      error.name === 'AbortError' ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('network') ||
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    )
  }
  return false
}

/**
 * Retries an async function with exponential backoff.
 * Only retries on errors classified as retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 200, maxDelayMs = 5000 } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts || !isRetryableError(err)) {
        throw err
      }
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Wraps a promise with a timeout. Rejects with an error if the timeout elapses.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    promise.then(
      result => {
        clearTimeout(timer)
        resolve(result)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
