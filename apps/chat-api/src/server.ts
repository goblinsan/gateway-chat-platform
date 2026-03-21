import path from 'path'
import fs from 'fs'
import Fastify from 'fastify'
import { loadEnv } from './config/env'
import healthRoutes from './routes/health'
import providerRoutes from './routes/providers'
import agentRoutes from './routes/agents'
import chatRoutes from './routes/chat'
import adminRoutes from './routes/admin'
import { getPrismaClient } from './services/db'
import { scheduleRetentionCleanup } from './services/retention'

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

  const app = Fastify({ logger: loggerOptions })

  // Security plugins
  await app.register(import('@fastify/helmet'))
  await app.register(import('@fastify/cors'), {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  })

  // Routes
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(providerRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(chatRoutes, { prefix: '/api' })
  await app.register(adminRoutes, { prefix: '/api' })

  // Root
  app.get('/', async () => ({ name: 'gateway-chat-api', version: env.BUILD_VERSION }))

  // Start retention cleanup scheduler
  const prisma = getPrismaClient()
  scheduleRetentionCleanup(prisma, env.RETENTION_DAYS_CONVERSATIONS, env.RETENTION_DAYS_LOGS)

  await app.listen({ port: env.PORT, host: env.HOST })
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
