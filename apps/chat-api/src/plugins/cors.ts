import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import { getEnv } from '../config/env'

export default fp(async function corsPlugin(app: FastifyInstance) {
  const env = getEnv()
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  })
})
