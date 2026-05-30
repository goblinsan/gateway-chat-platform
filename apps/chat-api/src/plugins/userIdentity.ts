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

function mobileTokenMatches(bearerToken: string, configuredTokens: string[]): boolean {
  return configuredTokens.some((token) => secureCompare(bearerToken, token))
}

function isMobileClientRequest(headers: Record<string, unknown>, url: string): boolean {
  const path = url.split('?')[0] ?? url
  if (path.startsWith('/api/mobile/')) return true

  const platformHeader = headers['x-gateway-client-platform']
  const platform = Array.isArray(platformHeader) ? platformHeader[0] : platformHeader
  if (typeof platform !== 'string') return false

  const normalized = platform.trim().toLowerCase()
  return normalized === 'ios' || normalized === 'android' || normalized === 'mobile'
}

/**
 * User identity plugin.
 *
 * Resolves a stable user identity for every incoming request and makes it
 * available as `req.userId`. Resolution order:
 *
 * 1. If a mobile bearer token is presented, validate it against
 *    MOBILE_SHARED_TOKEN and resolve the configured mobile user. Native clients
 *    do not participate in Cloudflare Access.
 * 2. When CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are set, require the
 *    `CF-Access-Jwt-Assertion` header. If MOBILE_SHARED_USER_ID is configured,
 *    reuse that stable identifier for browser requests so native and web
 *    clients can share the same server-backed thread namespace in single-user
 *    deployments; otherwise use the decoded JWT `sub` claim.
 * 3. Otherwise fall back to the `X-User-Id` request header (useful for local
 *    development and service-to-service calls).
 * 4. Otherwise fall back to the CHAT_DEFAULT_USER_ID environment variable.
 *
 * No private auth topology or specific provider assumptions are baked in here.
 */
export default fp(async function userIdentityPlugin(app: FastifyInstance) {
  app.decorateRequest('userId', '')

  const env = getEnv()
  const cfConfigured = Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD)
  const mobileSharedToken = env.MOBILE_SHARED_TOKEN?.trim()
  const configuredMobileSharedTokens = Array.isArray(env.MOBILE_SHARED_TOKENS)
    ? env.MOBILE_SHARED_TOKENS
    : []
  const mobileSharedTokens = [mobileSharedToken, ...configuredMobileSharedTokens]
    .map((token) => token?.trim() ?? '')
    .filter((token) => token.length > 0)
  const mobileSharedUserId = env.MOBILE_SHARED_USER_ID?.trim()
  const mobileFallbackUserId = mobileSharedUserId || env.CHAT_DEFAULT_USER_ID

  app.addHook('onRequest', async (req, reply) => {
    const bearerToken = extractBearerToken(req.headers.authorization)
    if (bearerToken) {
      if (mobileSharedTokens.length === 0) {
        void reply.status(401).send({ error: 'Mobile bearer auth is not configured' })
        return
      }

      if (!mobileTokenMatches(bearerToken, mobileSharedTokens)) {
        void reply.status(401).send({ error: 'Invalid mobile bearer token' })
        return
      }

      req.userId = mobileFallbackUserId
      return
    }

    if (isMobileClientRequest(req.headers, req.url)) {
      void reply.status(401).send({ error: 'Missing mobile bearer token' })
      return
    }

    const cfToken =
      (req.headers['cf-access-jwt-assertion'] as string | undefined) ||
      extractCfAuthorizationCookie(req.headers.cookie)
    if (cfToken) {
      try {
        const claims = decodeJwt(cfToken)
        const sub = typeof claims.sub === 'string' ? claims.sub.trim() : ''
        if (mobileSharedUserId) {
          req.userId = mobileSharedUserId
          return
        }
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

    if (cfConfigured) {
      void reply.status(401).send({ error: 'Missing Cloudflare Access identity header' })
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

/**
 * Cloudflare Access also sets the JWT as a `CF_Authorization` cookie on the
 * browser; accept it as a fallback when the upstream proxy does not inject
 * the header (e.g. Tunnel routes outside the Access policy).
 */
function extractCfAuthorizationCookie(cookieHeader: string | string[] | undefined): string | undefined {
  if (!cookieHeader) return undefined
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const name = part.slice(0, idx).trim()
    if (name === 'CF_Authorization') {
      const value = part.slice(idx + 1).trim()
      return value || undefined
    }
  }
  return undefined
}
