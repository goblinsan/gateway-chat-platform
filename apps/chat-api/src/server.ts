import Fastify from 'fastify'
import { loadEnv } from './config/env'
import healthRoutes from './routes/health'
import providerRoutes from './routes/providers'

async function bootstrap() {
  const env = loadEnv()

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  })

  // Security plugins
  await app.register(import('@fastify/helmet'))
  await app.register(import('@fastify/cors'), {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  })

  // Routes
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(providerRoutes, { prefix: '/api' })

  // Root
  app.get('/', async () => ({ name: 'gateway-chat-api', version: env.BUILD_VERSION }))

  await app.listen({ port: env.PORT, host: env.HOST })
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
