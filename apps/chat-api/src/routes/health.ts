import type { FastifyInstance } from 'fastify'
import { getEnv } from '../config/env'
import {
  AgentServiceError,
  ingestAppleHealthSummaryInAgentService,
  ingestPersonalDataBatchInAgentService,
} from '../services/agentServiceClient'
import { checkProvider } from '../services/providerCheck'

interface AppleHealthSummaryBody {
  date?: string
  timezone?: string
  activity?: Record<string, unknown>
  nutrition?: Record<string, unknown>
}

interface PersonalDataBatchBody {
  source_system?: string
  source_device?: string
  source_app?: string
  sync_started_at?: string
  sync_completed_at?: string
  schema_version?: string
  normalization_version?: string
  metadata_json?: Record<string, unknown>
  records?: Array<Record<string, unknown>>
}

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
  app.post<{ Body: PersonalDataBatchBody }>('/personal-data/batches', async (req, reply) => {
    const body = req.body ?? {}
    if (!cleanString(body.source_system)) {
      return reply.status(400).send({ error: 'source_system is required' })
    }
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return reply.status(400).send({ error: 'records are required' })
    }
    try {
      const result = await ingestPersonalDataBatchInAgentService(req.userId, {
        source_system: cleanString(body.source_system),
        source_device: cleanString(body.source_device),
        source_app: cleanString(body.source_app),
        sync_started_at: cleanString(body.sync_started_at),
        sync_completed_at: cleanString(body.sync_completed_at),
        schema_version: cleanString(body.schema_version),
        normalization_version: cleanString(body.normalization_version),
        metadata_json: hasObjectMetrics(body.metadata_json) ? body.metadata_json : undefined,
        records: body.records,
      })
      return reply.send(result)
    } catch (err) {
      req.log.error({ err }, 'personal data batch ingest failed')
      const message = err instanceof AgentServiceError || err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: message })
    }
  })

  app.post<{ Body: AppleHealthSummaryBody }>('/health/apple/summary', async (req, reply) => {
    const body = req.body ?? {}
    if (!hasObjectMetrics(body.activity) && !hasObjectMetrics(body.nutrition)) {
      return reply.status(400).send({ error: 'activity or nutrition metrics are required' })
    }
    try {
      const result = await ingestAppleHealthSummaryInAgentService(req.userId, {
        date: cleanString(body.date),
        timezone: cleanString(body.timezone),
        activity: cleanMetrics(body.activity),
        nutrition: cleanMetrics(body.nutrition),
      })
      return reply.send(result)
    } catch (err) {
      req.log.error({ err }, 'apple health summary ingest failed')
      const message = err instanceof AgentServiceError || err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: message })
    }
  })

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

    // Keep /api/health usable as a connectivity probe for clients even when one
    // or more optional upstream providers are degraded. Reserve non-2xx only for
    // cases where this service itself cannot serve requests.
    return reply.status(200).send(body)
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

function hasObjectMetrics(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).length > 0
}

function cleanMetrics(value: unknown): Record<string, unknown> | undefined {
  if (!hasObjectMetrics(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, metricValue] of Object.entries(value)) {
    const normalizedKey = key.trim()
    if (!normalizedKey || metricValue === null || typeof metricValue === 'undefined') continue
    if (typeof metricValue === 'number' && !Number.isFinite(metricValue)) continue
    out[normalizedKey] = metricValue
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
