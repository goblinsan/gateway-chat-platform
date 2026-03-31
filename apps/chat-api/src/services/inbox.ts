import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { getEnv } from '../config/env'

export interface InboxScope {
  userId: string
  channelId: string
}

export interface InboxItemRecord {
  id: string
  userId: string
  channelId: string
  agentId: string
  content: string
  createdAt: string
  kind: string
  threadId?: string
  threadTitle?: string
  title?: string
  metadata?: Record<string, unknown>
  read: boolean
}

export interface PublishInboxMessageInput {
  userId?: string
  channelId?: string
  agentId: string
  content: string
  kind?: string
  threadId?: string
  threadTitle?: string
  title?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

const MEMORY_MESSAGES = new Map<string, InboxItemRecord[]>()
const MEMORY_ACKED = new Map<string, Set<string>>()

type ConnectedRedisClient = Awaited<ReturnType<ReturnType<typeof createClient>['connect']>>

let redisClientPromise: Promise<ConnectedRedisClient> | null = null

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function scopeKey(scope: InboxScope): string {
  return `${scope.userId}::${scope.channelId}`
}

function streamKey(scope: InboxScope): string {
  return `chat:inbox:${scope.userId}:${scope.channelId}`
}

function ackKey(scope: InboxScope): string {
  return `chat:inbox:acked:${scope.userId}:${scope.channelId}`
}

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore invalid metadata payloads
  }
  return undefined
}

function toRecord(
  id: string,
  scope: InboxScope,
  message: Record<string, string>,
  read: boolean,
): InboxItemRecord {
  return {
    id,
    userId: scope.userId,
    channelId: scope.channelId,
    agentId: message.agentId,
    content: message.content,
    createdAt: message.createdAt,
    kind: message.kind || 'notice',
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(message.threadTitle ? { threadTitle: message.threadTitle } : {}),
    ...(message.title ? { title: message.title } : {}),
    ...(message.metadata ? { metadata: parseMetadata(message.metadata) } : {}),
    read,
  }
}

export function resolveInboxScope(input?: Partial<InboxScope>): InboxScope {
  const env = getEnv()
  return {
    userId: normalizeString(input?.userId) ?? env.CHAT_DEFAULT_USER_ID,
    channelId: normalizeString(input?.channelId) ?? env.CHAT_DEFAULT_CHANNEL_ID,
  }
}

async function getRedisClient(): Promise<ConnectedRedisClient | null> {
  const env = getEnv()
  if (!env.REDIS_URL) {
    return null
  }

  if (!redisClientPromise) {
    const client = createClient({ url: env.REDIS_URL })
    client.on('error', (err) => {
      console.warn('[inbox] Redis client error:', err)
    })
    redisClientPromise = client.connect().then(() => client)
  }

  return redisClientPromise
}

export async function publishInboxMessage(input: PublishInboxMessageInput): Promise<InboxItemRecord> {
  const scope = resolveInboxScope(input)
  const payload = {
    agentId: input.agentId,
    content: input.content,
    kind: normalizeString(input.kind) ?? 'coach_prompt',
    createdAt: normalizeString(input.createdAt) ?? new Date().toISOString(),
    threadId: normalizeString(input.threadId) ?? '',
    threadTitle: normalizeString(input.threadTitle) ?? '',
    title: normalizeString(input.title) ?? '',
    metadata: JSON.stringify(input.metadata ?? {}),
  }

  const redis = await getRedisClient()
  if (!redis) {
    const id = `mem-${randomUUID()}`
    const key = scopeKey(scope)
    const record = toRecord(id, scope, payload, false)
    const items = MEMORY_MESSAGES.get(key) ?? []
    MEMORY_MESSAGES.set(key, [record, ...items].slice(0, 200))
    return record
  }

  const id = await redis.xAdd(streamKey(scope), '*', payload)
  await redis.expire(streamKey(scope), 60 * 60 * 24 * 30)
  await redis.expire(ackKey(scope), 60 * 60 * 24 * 30)
  return toRecord(id, scope, payload, false)
}

export async function acknowledgeInboxMessage(input: { id: string; userId?: string; channelId?: string }): Promise<void> {
  const scope = resolveInboxScope(input)
  const redis = await getRedisClient()
  if (!redis) {
    const key = scopeKey(scope)
    const acked = MEMORY_ACKED.get(key) ?? new Set<string>()
    acked.add(input.id)
    MEMORY_ACKED.set(key, acked)
    return
  }

  await redis.sAdd(ackKey(scope), input.id)
  await redis.expire(ackKey(scope), 60 * 60 * 24 * 30)
}

export async function listInboxMessages(input?: {
  userId?: string
  channelId?: string
  limit?: number
  unreadOnly?: boolean
}): Promise<{ scope: InboxScope; items: InboxItemRecord[]; unreadCount: number }> {
  const scope = resolveInboxScope(input)
  const limit = Math.max(1, Math.min(100, Math.floor(input?.limit ?? 20)))
  const unreadOnly = input?.unreadOnly === true
  const redis = await getRedisClient()

  if (!redis) {
    const key = scopeKey(scope)
    const items = MEMORY_MESSAGES.get(key) ?? []
    const acked = MEMORY_ACKED.get(key) ?? new Set<string>()
    const hydrated = items.map((item) => ({ ...item, read: acked.has(item.id) }))
    const unreadCount = hydrated.filter((item) => !item.read).length
    return {
      scope,
      items: hydrated.filter((item) => !unreadOnly || !item.read).slice(0, limit),
      unreadCount,
    }
  }

  const entries = await redis.xRevRange(streamKey(scope), '+', '-', { COUNT: Math.max(limit * 4, 40) })
  const ackedFlags = await Promise.all(entries.map((entry) => redis.sIsMember(ackKey(scope), entry.id)))
  const items = entries.map((entry, index) => toRecord(entry.id, scope, entry.message as Record<string, string>, ackedFlags[index]))
  const unreadCount = items.filter((item) => !item.read).length
  return {
    scope,
    items: items.filter((item) => !unreadOnly || !item.read).slice(0, limit),
    unreadCount,
  }
}
