import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import inboxRoutes from '../routes/inbox'

const mockListInboxMessages = vi.fn()
const mockPublishInboxMessage = vi.fn()
const mockAcknowledgeInboxMessage = vi.fn()

vi.mock('../services/inbox', () => ({
  listInboxMessages: (...args: unknown[]) => mockListInboxMessages(...args),
  publishInboxMessage: (...args: unknown[]) => mockPublishInboxMessage(...args),
  acknowledgeInboxMessage: (...args: unknown[]) => mockAcknowledgeInboxMessage(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockListInboxMessages.mockResolvedValue({
    scope: { userId: 'me', channelId: 'coach' },
    unreadCount: 1,
    items: [{
      id: '1743360000000-0',
      userId: 'me',
      channelId: 'coach',
      agentId: 'ancr-coach',
      content: 'Morning priorities.',
      createdAt: '2026-03-30T08:00:00.000Z',
      kind: 'coach_prompt',
      threadId: 'ancr-coach-me',
      threadTitle: 'ANCR Coach',
      read: false,
    }],
  })
  mockPublishInboxMessage.mockResolvedValue({
    id: '1743360000000-1',
    userId: 'me',
    channelId: 'coach',
    agentId: 'ancr-coach',
    content: 'Morning priorities.',
    createdAt: '2026-03-30T08:00:00.000Z',
    kind: 'coach_prompt',
    read: false,
  })
  mockAcknowledgeInboxMessage.mockResolvedValue(undefined)
})

describe('Inbox API', () => {
  it('lists inbox items for a scoped user/channel', async () => {
    const app = Fastify()
    await app.register(inboxRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/inbox?userId=me&channelId=coach&limit=10',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.unreadCount).toBe(1)
    expect(body.items[0].threadId).toBe('ancr-coach-me')
    expect(mockListInboxMessages).toHaveBeenCalledWith({
      userId: 'me',
      channelId: 'coach',
      limit: 10,
    })
  })

  it('publishes a new inbox message', async () => {
    const app = Fastify()
    await app.register(inboxRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/messages',
      payload: {
        userId: 'me',
        channelId: 'coach',
        agentId: 'ancr-coach',
        content: 'Morning priorities.',
        threadId: 'ancr-coach-me',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(mockPublishInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'me',
      channelId: 'coach',
      threadId: 'ancr-coach-me',
    }))
  })

  it('acknowledges an inbox item', async () => {
    const app = Fastify()
    await app.register(inboxRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/1743360000000-0/ack',
      payload: {
        userId: 'me',
        channelId: 'coach',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAcknowledgeInboxMessage).toHaveBeenCalledWith({
      id: '1743360000000-0',
      userId: 'me',
      channelId: 'coach',
    })
  })
})
