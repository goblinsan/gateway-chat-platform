import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { decodeJwt } from 'jose'
import { getEnv } from '../config/env'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

/**
 * User identity plugin.
 *
 * Resolves a stable user identity for every incoming request and makes it
 * available as `req.userId`. Resolution order:
 *
 * 1. When CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are set, require the
 *    `CF-Access-Jwt-Assertion` header and use the decoded JWT `sub` claim as
 *    the user identifier.
 * 2. Otherwise fall back to the `X-User-Id` request header (useful for local
 *    development and service-to-service calls).
 * 3. Otherwise fall back to the CHAT_DEFAULT_USER_ID environment variable.
 *
 * No private auth topology or specific provider assumptions are baked in here.
 */
export default fp(async function userIdentityPlugin(app: FastifyInstance) {
  app.decorateRequest('userId', '')

  const env = getEnv()
  const cfConfigured = Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD)

  app.addHook('onRequest', async (req, reply) => {
    if (cfConfigured) {
      const token = req.headers['cf-access-jwt-assertion'] as string | undefined
      if (!token) {
        void reply.status(401).send({ error: 'Missing Cloudflare Access identity header' })
        return
      }

      try {
        const claims = decodeJwt(token)
        const sub = typeof claims.sub === 'string' ? claims.sub.trim() : ''
        if (sub) {
          req.userId = sub
          return
        }
      } catch {
        // fall through to the explicit Cloudflare-mode error below
      }

      void reply.status(401).send({ error: 'Invalid Cloudflare Access identity header' })
      return
    }

    const headerUserId = req.headers['x-user-id']
    if (typeof headerUserId === 'string' && headerUserId.trim()) {
      req.userId = headerUserId.trim()
      return
    }

    req.userId = env.CHAT_DEFAULT_USER_ID
  })
})
