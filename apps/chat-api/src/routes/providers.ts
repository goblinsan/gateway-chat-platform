import type { FastifyInstance } from 'fastify'
import { getEnv } from '../config/env'
import { checkProvider } from '../services/providerCheck'
import { type KnownProviderName } from '../config/providers'

interface ProviderTestResult {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

export default async function providerRoutes(app: FastifyInstance) {
  app.get('/providers/status', async (_req, reply) => {
    const env = getEnv()

    const providers: Array<{ name: KnownProviderName; baseUrl?: string; apiKey?: string }> = [
      { name: 'lm-studio-a', baseUrl: env.LM_STUDIO_A_BASE_URL },
      { name: 'lm-studio-b', baseUrl: env.LM_STUDIO_B_BASE_URL },
      { name: 'openai', apiKey: env.OPENAI_API_KEY, baseUrl: 'https://api.openai.com' },
      { name: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, baseUrl: 'https://api.anthropic.com' },
      { name: 'google', apiKey: env.GOOGLE_API_KEY, baseUrl: 'https://generativelanguage.googleapis.com' },
    ]

    const results: ProviderTestResult[] = []

    for (const p of providers) {
      if (!p.baseUrl && !p.apiKey) {
        results.push({ name: p.name, status: 'unconfigured' })
        continue
      }
      const check = await checkProvider(p.name, p.baseUrl ?? '', p.apiKey)
      // baseUrl is intentionally omitted from the response to avoid leaking
      // internal infrastructure details to the browser (#55)
      results.push({ name: p.name, ...check })
    }

    return reply.send({ providers: results })
  })

  app.get('/providers/:name/test', async (req, reply) => {
    const env = getEnv()
    const { name } = req.params as { name: string }

    const providerMap: Record<string, { baseUrl?: string; apiKey?: string }> = {
      'lm-studio-a': { baseUrl: env.LM_STUDIO_A_BASE_URL },
      'lm-studio-b': { baseUrl: env.LM_STUDIO_B_BASE_URL },
      openai: { apiKey: env.OPENAI_API_KEY, baseUrl: 'https://api.openai.com' },
      anthropic: { apiKey: env.ANTHROPIC_API_KEY, baseUrl: 'https://api.anthropic.com' },
      google: { apiKey: env.GOOGLE_API_KEY, baseUrl: 'https://generativelanguage.googleapis.com' },
    }

    const provider = providerMap[name]
    if (!provider) {
      return reply.status(404).send({ error: `Provider '${name}' not found` })
    }

    if (!provider.baseUrl && !provider.apiKey) {
      return reply.send({ name, status: 'unconfigured' })
    }

    const result = await checkProvider(name, provider.baseUrl ?? '', provider.apiKey)
    // baseUrl is intentionally omitted from the response (#55)
    return reply.send({ name, ...result })
  })
}
