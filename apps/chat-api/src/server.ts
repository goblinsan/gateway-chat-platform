import path from 'path'
import fs from 'fs'
import Fastify from 'fastify'
import { loadEnv } from './config/env'
import healthRoutes from './routes/health'
import providerRoutes from './routes/providers'
import agentRoutes from './routes/agents'
import chatRoutes from './routes/chat'
import adminRoutes from './routes/admin'
import filesRoutes from './routes/files'
import compareRoutes from './routes/compare'
import promptsRoutes from './routes/prompts'
import handoffRoutes from './routes/handoff'
import workflowsRoutes from './routes/workflows'
import agentRunRoutes from './routes/run'
import ttsRoutes from './routes/tts'
import inboxRoutes from './routes/inbox'
import personaRoutes from './routes/personas'
import usageRoutes from './routes/usage'
import sessionRoutes from './routes/session'
import cfAccessPlugin from './plugins/cfAccess'
import userIdentityPlugin from './plugins/userIdentity'
import { getPrismaClient } from './services/db'
import { scheduleRetentionCleanup } from './services/retention'
import { initAgentRegistry } from './agents/registry'

// Max request body size: 64 KB — prevents oversized prompt submissions (#59)
const BODY_LIMIT = 64 * 1024

async function bootstrap() {
  const env = loadEnv()

  const loggerOptions: Record<string, unknown> = {
    level: env.LOG_LEVEL,
  }

  if (env.LOG_DIR) {
    fs.mkdirSync(env.LOG_DIR, { recursive: true })
    const logPath = path.join(env.LOG_DIR, 'app.log')
    loggerOptions['transport'] = {
      targets: [
        {
          target: 'pino/file',
          options: { destination: logPath, mkdir: true },
          level: env.LOG_LEVEL,
        },
        ...(env.NODE_ENV === 'development'
          ? [{ target: 'pino-pretty', options: { colorize: true }, level: env.LOG_LEVEL }]
          : []),
      ],
    }
  } else if (env.NODE_ENV === 'development') {
    loggerOptions['transport'] = { target: 'pino-pretty', options: { colorize: true } }
  }

  const app = Fastify({ logger: loggerOptions, bodyLimit: BODY_LIMIT })

  // Determine allowed CORS origins: explicit list, or fallback based on environment (#54)
  const corsOrigin =
    env.ALLOWED_ORIGINS.length > 0
      ? env.ALLOWED_ORIGINS
      : env.NODE_ENV !== 'production'

  // Security plugins
  await app.register(import('@fastify/helmet'), {
    // Disable HSTS in development — it forces HTTPS which breaks the local dev proxy
    hsts: env.NODE_ENV === 'production',
  })
  await app.register(import('@fastify/cors'), {
    origin: corsOrigin,
    credentials: true,
  })

  // Rate limiting — global defaults (#58)
  await app.register(import('@fastify/rate-limit'), {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  })

  // Initialize dynamic agent registry from DB (seeds defaults on first run)
  const prisma = getPrismaClient()
  await initAgentRegistry(prisma)

  // User identity resolution — sets req.userId for all routes (#85)
  await app.register(userIdentityPlugin)

  // Routes
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(providerRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(chatRoutes, { prefix: '/api' })
  await app.register(filesRoutes, { prefix: '/api' })
  await app.register(compareRoutes, { prefix: '/api' })
  await app.register(promptsRoutes, { prefix: '/api' })
  await app.register(handoffRoutes, { prefix: '/api' })
  await app.register(workflowsRoutes, { prefix: '/api' })
  await app.register(agentRunRoutes, { prefix: '/api' })
  await app.register(ttsRoutes, { prefix: '/api' })
  await app.register(inboxRoutes, { prefix: '/api' })
  await app.register(personaRoutes, { prefix: '/api' })
  await app.register(usageRoutes, { prefix: '/api' })
  await app.register(sessionRoutes, { prefix: '/api' })

  // Admin routes are protected by Cloudflare Access JWT validation (#62)
  await app.register(async (adminApp) => {
    await adminApp.register(cfAccessPlugin)
    await adminApp.register(adminRoutes, { prefix: '/api' })
  })

  // Root
  app.get('/', async () => ({ name: 'gateway-chat-api', version: env.BUILD_VERSION }))

  // Start retention cleanup scheduler
  scheduleRetentionCleanup(prisma, env.RETENTION_DAYS_CONVERSATIONS, env.RETENTION_DAYS_LOGS)

  await app.listen({ port: env.PORT, host: env.HOST })
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
