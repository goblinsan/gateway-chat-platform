/**
 * APNs (Apple Push Notification service) provider.
 *
 * Sends push notifications via the APNs HTTP/2 API using token-based
 * (JWT) authentication.  Configuration is loaded from environment
 * variables:
 *
 *   APNS_TEAM_ID        – 10-character Team ID from developer.apple.com
 *   APNS_KEY_ID         – 10-character Key ID for the .p8 signing key
 *   APNS_BUNDLE_ID      – App bundle identifier (e.g. com.example.myapp)
 *   APNS_PRIVATE_KEY_PATH   – path to the .p8 file  (provide exactly one
 *   APNS_PRIVATE_KEY_BASE64   of these two; they are mutually exclusive)
 *   APNS_SANDBOX        – "true" to target the sandbox endpoint
 */

import fs from 'node:fs'
import http2 from 'node:http2'
import { SignJWT, importPKCS8 } from 'jose'
import { getEnv } from '../config/env'

export interface ApnsPayload {
  title: string
  body: string
  /** Optional collapse identifier (apns-collapse-id). */
  collapseId?: string
  /** Custom data to include in the aps payload. */
  data?: Record<string, unknown>
}

export type ApnsResult =
  | { ok: true }
  | { ok: false; reason: string; stale: boolean }

// APNs JWT tokens are valid for 60 minutes; we refresh 10 minutes early.
const TOKEN_TTL_MS = 50 * 60 * 1000

interface TokenCache {
  jwt: string
  expiresAt: number
}

let _tokenCache: TokenCache | undefined

function readPrivateKey(): string {
  const env = getEnv()
  if (env.APNS_PRIVATE_KEY_BASE64) {
    return Buffer.from(env.APNS_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')
  }
  if (env.APNS_PRIVATE_KEY_PATH) {
    return fs.readFileSync(env.APNS_PRIVATE_KEY_PATH, 'utf-8')
  }
  throw new Error('APNs private key not configured (set APNS_PRIVATE_KEY_PATH or APNS_PRIVATE_KEY_BASE64)')
}

async function getApnsJwt(): Promise<string> {
  const now = Date.now()
  if (_tokenCache && _tokenCache.expiresAt > now) {
    return _tokenCache.jwt
  }

  const env = getEnv()
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID) {
    throw new Error('APNs not configured: APNS_TEAM_ID and APNS_KEY_ID are required')
  }

  const privateKeyPem = readPrivateKey()
  const privateKey = await importPKCS8(privateKeyPem, 'ES256')

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APNS_KEY_ID })
    .setIssuer(env.APNS_TEAM_ID)
    .setIssuedAt()
    .sign(privateKey)

  _tokenCache = { jwt, expiresAt: now + TOKEN_TTL_MS }
  return jwt
}

/** Invalidates the cached JWT so it is regenerated on the next send. */
export function invalidateApnsJwtCache(): void {
  _tokenCache = undefined
}

function apnsHostname(sandbox: boolean): string {
  return sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
}

/**
 * Sends an APNs push notification to a single device.
 *
 * @param rawToken  The plain-text (hex) APNs device token.
 * @param payload   Notification payload.
 * @returns         ApnsResult — ok=true on success, or ok=false with reason
 *                  and stale=true when the token is invalid/expired.
 */
export async function sendApnsNotification(
  rawToken: string,
  payload: ApnsPayload,
): Promise<ApnsResult> {
  const env = getEnv()
  if (!env.APNS_BUNDLE_ID) {
    throw new Error('APNs not configured: APNS_BUNDLE_ID is required')
  }

  const jwt = await getApnsJwt()
  const hostname = apnsHostname(env.APNS_SANDBOX)

  const body: Record<string, unknown> = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    },
    ...(payload.data ?? {}),
  }

  const bodyJson = JSON.stringify(body)

  return new Promise<ApnsResult>((resolve, reject) => {
    const client = http2.connect(`https://${hostname}`)

    client.on('error', (err) => {
      client.destroy()
      reject(err)
    })

    const reqHeaders: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${rawToken}`,
      ':scheme': 'https',
      ':authority': hostname,
      'authorization': `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bodyJson).toString(),
    }

    if (payload.collapseId) {
      reqHeaders['apns-collapse-id'] = payload.collapseId
    }

    const req = client.request(reqHeaders)

    let statusCode = 0
    req.on('response', (headers) => {
      statusCode = Number(headers[':status'] ?? 0)
    })

    let responseBody = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk: string) => { responseBody += chunk })

    req.on('end', () => {
      client.close()

      if (statusCode === 200) {
        resolve({ ok: true })
        return
      }

      let reason = 'UnknownError'
      try {
        const parsed = JSON.parse(responseBody) as { reason?: string }
        if (parsed.reason) reason = parsed.reason
      } catch {
        // use default reason
      }

      // 410 Gone → Unregistered; 400 BadDeviceToken → stale/invalid token
      const stale =
        statusCode === 410 ||
        (statusCode === 400 && reason === 'BadDeviceToken')

      resolve({ ok: false, reason, stale })
    })

    req.on('error', (err) => {
      client.destroy()
      reject(err)
    })

    req.write(bodyJson)
    req.end()
  })
}

/** Returns true when APNs is fully configured, false otherwise. */
export function isApnsConfigured(): boolean {
  const env = getEnv()
  const hasKey =
    Boolean(env.APNS_PRIVATE_KEY_PATH) || Boolean(env.APNS_PRIVATE_KEY_BASE64)
  return Boolean(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_BUNDLE_ID && hasKey)
}
