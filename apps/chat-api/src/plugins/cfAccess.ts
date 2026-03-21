import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getEnv } from '../config/env'

/**
 * Cloudflare Access JWT validation plugin.
 *
 * When CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are configured, this plugin
 * registers a hook that validates the `CF-Access-Jwt-Assertion` header
 * (set by Cloudflare Access) on every request. Requests without a valid
 * JWT are rejected with 401.
 *
 * If the env vars are not set the hook is not registered, so the server
 * still starts in local/development environments without Cloudflare.
 */
export default fp(async function cfAccessPlugin(app: FastifyInstance) {
  const env = getEnv()

  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    app.log.warn(
      'CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not configured — Cloudflare Access validation disabled',
    )
    return
  }

  const certsUrl = new URL(
    '/cdn-cgi/access/certs',
    `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
  )
  const JWKS = createRemoteJWKSet(certsUrl)
  const audience = env.CF_ACCESS_AUD

  app.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token =
        req.headers['cf-access-jwt-assertion'] as string | undefined

      if (!token) {
        return reply.status(401).send({ error: 'Missing Cloudflare Access token' })
      }

      try {
        await jwtVerify(token, JWKS, { audience })
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired Cloudflare Access token' })
      }
    },
  )
})
