import type { FastifyInstance } from 'fastify'
import { getEnv } from '../config/env'
import { checkProvider } from '../services/providerCheck'

interface DependencyStatus {
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  version: string
  commit: string
  uptime: number
  nodeEnv: string
  dependencies: Record<string, DependencyStatus>
}

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const env = getEnv()
    const dependencies: Record<string, DependencyStatus> = {}

    const providers: Array<{ name: string; baseUrl?: string; apiKey?: string }> = [
      { name: 'lm-studio-a', baseUrl: env.LM_STUDIO_A_BASE_URL },
      { name: 'lm-studio-b', baseUrl: env.LM_STUDIO_B_BASE_URL },
      { name: 'openai', apiKey: env.OPENAI_API_KEY, baseUrl: 'https://api.openai.com' },
      { name: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, baseUrl: 'https://api.anthropic.com' },
      { name: 'google', apiKey: env.GOOGLE_API_KEY, baseUrl: 'https://generativelanguage.googleapis.com' },
    ]

    for (const p of providers) {
      if (!p.baseUrl && !p.apiKey) {
        dependencies[p.name] = { status: 'unconfigured' }
        continue
      }
      dependencies[p.name] = await checkProvider(p.name, p.baseUrl ?? '', p.apiKey)
    }

    const hasError = Object.values(dependencies).some((d) => d.status === 'error')
    const allOk = Object.values(dependencies).every(
      (d) => d.status === 'ok' || d.status === 'unconfigured',
    )

    const body: HealthResponse = {
      status: hasError ? 'degraded' : allOk ? 'ok' : 'degraded',
      version: env.BUILD_VERSION,
      commit: env.BUILD_COMMIT,
      uptime: process.uptime(),
      nodeEnv: env.NODE_ENV,
      dependencies,
    }

    const statusCode = body.status === 'ok' ? 200 : 503
    return reply.status(statusCode).send(body)
  })
}
