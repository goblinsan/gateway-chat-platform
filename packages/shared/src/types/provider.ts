export type ProviderKind = 'lm-studio' | 'openai' | 'anthropic' | 'google'

export interface ProviderConfig {
  name: string
  kind: ProviderKind
  baseUrl: string
  enabled: boolean
}

export interface ProviderStatus {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

export interface ProvidersStatusResponse {
  providers: ProviderStatus[]
}
