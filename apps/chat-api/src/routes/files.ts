import type { FastifyInstance } from 'fastify'

interface FileMetadata {
  id: string
  name: string
  size: number
  mimeType: string
  uploadedAt: string
  threadId: string
}

interface FileRecord extends FileMetadata {
  content: string
}

const fileStore = new Map<string, FileRecord[]>()

// MAX_FILE_SIZE is enforced against the reported `size` field (original bytes).
// The base64-encoded `content` field will be ~33% larger than this limit.
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB (original file size)
// Max files stored per thread to prevent unbounded memory growth
const MAX_FILES_PER_THREAD = 20

const uploadBodySchema = {
  type: 'object',
  required: ['threadId', 'name', 'mimeType', 'content', 'size'],
  properties: {
    threadId: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    mimeType: { type: 'string', minLength: 1, maxLength: 128 },
    content: { type: 'string', minLength: 1 },
    size: { type: 'number', minimum: 1, maximum: MAX_FILE_SIZE },
  },
} as const

export default async function filesRoutes(app: FastifyInstance) {
  app.post<{
    Body: { threadId: string; name: string; mimeType: string; content: string; size: number }
  }>(
    '/files',
    {
      schema: { body: uploadBodySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { threadId, name, mimeType, content, size } = req.body
      const id = crypto.randomUUID()
      const uploadedAt = new Date().toISOString()
      const record: FileRecord = { id, name, size, mimeType, uploadedAt, threadId, content }
      const existing = fileStore.get(threadId) ?? []
      if (existing.length >= MAX_FILES_PER_THREAD) {
        return reply.status(429).send({ error: 'File limit per thread reached' })
      }
      fileStore.set(threadId, [...existing, record])
      const metadata: FileMetadata = { id, name, size, mimeType, uploadedAt, threadId }
      return reply.status(201).send(metadata)
    },
  )

  app.get<{ Querystring: { threadId?: string } }>(
    '/files',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { threadId: { type: 'string', maxLength: 64 } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { threadId } = req.query
      if (!threadId) {
        return reply.status(400).send({ error: 'threadId query parameter is required' })
      }
      const records = fileStore.get(threadId) ?? []
      const files: FileMetadata[] = records.map(({ content: _c, ...meta }) => meta)
      return reply.send({ files })
    },
  )
}
