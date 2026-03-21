export interface EnvironmentConfig {
  nodeEnv: 'development' | 'production' | 'test'
  port: number
  host: string
  logLevel: string

  lmStudioABaseUrl?: string
  lmStudioBBaseUrl?: string

  openaiApiKey?: string
  anthropicApiKey?: string
  googleApiKey?: string

  cfAccessTeamDomain?: string
  cfAccessAud?: string

  buildVersion: string
  buildCommit: string
}
