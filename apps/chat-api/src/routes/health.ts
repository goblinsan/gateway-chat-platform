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
  app.get('/ready', async (_req, reply) => {
    return reply.status(200).send({ status: 'ready', uptime: process.uptime() })
  })

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

  app.get('/internal/diagnostics/lm-studio-connectivity', async (_req, reply) => {
    const env = getEnv()
    const baseUrl = env.LM_STUDIO_A_BASE_URL
    
    if (!baseUrl) {
      return reply.status(200).send({
        configured: false,
        error: 'LM_STUDIO_A_BASE_URL is not configured',
      })
    }

    // Test connectivity from inside this container
    const results: Record<string, unknown> = {
      configured: true,
      baseUrl,
      tests: {},
    }

    // Test /health endpoint
    const healthTestStart = Date.now()
    try {
      const healthResp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) })
      results.tests = results.tests || {}
      ;(results.tests as Record<string, unknown>)['health'] = {
        status: healthResp.status,
        ok: healthResp.ok,
        latencyMs: Date.now() - healthTestStart,
      }
    } catch (e) {
      ;(results.tests as Record<string, unknown>)['health'] = {
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - healthTestStart,
      }
    }

    // Test /api/models endpoint
    const modelsTestStart = Date.now()
    try {
      const modelsResp = await fetch(`${baseUrl}/api/models`, { signal: AbortSignal.timeout(5000) })
      ;(results.tests as Record<string, unknown>)['models'] = {
        status: modelsResp.status,
        ok: modelsResp.ok,
        latencyMs: Date.now() - modelsTestStart,
      }
    } catch (e) {
      ;(results.tests as Record<string, unknown>)['models'] = {
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - modelsTestStart,
      }
    }

    return reply.status(200).send(results)
  })
}
