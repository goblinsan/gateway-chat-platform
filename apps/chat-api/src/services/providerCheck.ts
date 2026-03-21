interface ProviderCheckResult {
  status: 'ok' | 'error'
  latencyMs?: number
  error?: string
}

export async function checkProvider(
  name: string,
  baseUrl: string,
  _apiKey?: string,
): Promise<ProviderCheckResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const healthPath = name.startsWith('lm-studio') ? '/v1/models' : '/v1/models'
    const url = `${baseUrl}${healthPath}`

    const response = await fetch(url, {
      signal: controller.signal,
      headers: _apiKey ? { Authorization: `Bearer ${_apiKey}` } : {},
    })
    clearTimeout(timeout)

    const latencyMs = Date.now() - start

    if (response.ok || response.status === 401) {
      return { status: 'ok', latencyMs }
    }

    return {
      status: 'error',
      latencyMs,
      error: `HTTP ${response.status}`,
    }
  } catch (err: unknown) {
    const latencyMs = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', latencyMs, error: message }
  }
}
