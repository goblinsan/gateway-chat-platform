import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { decodeJwt } from 'jose'
import { getEnv } from '../config/env'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

function extractBearerToken(headerValue: unknown): string | undefined {
  if (typeof headerValue !== 'string') return undefined
  const trimmed = headerValue.trim()
  if (!trimmed) return undefined

  const match = /^Bearer\s+(.+)$/i.exec(trimmed)
  const token = match?.[1]?.trim()
  return token ? token : undefined
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length != rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
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
  const mobileSharedToken = env.MOBILE_SHARED_TOKEN?.trim()
  const mobileSharedUserId =
    env.MOBILE_SHARED_USER_ID?.trim() || env.CHAT_DEFAULT_USER_ID

  app.addHook('onRequest', async (req, reply) => {
    const cfToken = req.headers['cf-access-jwt-assertion'] as string | undefined
    if (cfToken) {
      try {
        const claims = decodeJwt(cfToken)
        const sub = typeof claims.sub === 'string' ? claims.sub.trim() : ''
        if (sub) {
          req.userId = sub
          return
        }
      } catch {
        // fall through to the explicit error below
      }

      void reply.status(401).send({ error: 'Invalid Cloudflare Access identity header' })
      return
    }

    const bearerToken = extractBearerToken(req.headers.authorization)
    if (
      mobileSharedToken &&
      bearerToken &&
      secureCompare(bearerToken, mobileSharedToken)
    ) {
      req.userId = mobileSharedUserId
      return
    }

    if (cfConfigured) {
      void reply.status(401).send({
        error: mobileSharedToken
          ? 'Missing Cloudflare Access identity header or valid mobile bearer token'
          : 'Missing Cloudflare Access identity header',
      })
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
