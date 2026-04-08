import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { UserPersona, PersonaListItem, CreatePersonaRequest, UpdatePersonaRequest } from '@gateway/shared'
import { getPrismaClient } from '../services/db'

const SYSTEM_PROMPT_MAX = 4096
const NAME_MAX = 128
const DESCRIPTION_MAX = 512

/** Strip systemPrompt from a persona for list responses. */
function toListItem(persona: UserPersona): PersonaListItem {
  const { systemPrompt: _sp, ...rest } = persona
  return rest
}

/**
 * User persona management routes.
 * All routes are scoped to the requesting user via req.userId.
 * Users cannot read or modify other users' personas.
 */
export default async function personaRoutes(app: FastifyInstance) {
  const prisma = getPrismaClient()

  /** GET /personas — list the caller's personas */
  app.get('/personas', async (req, reply) => {
    const personas = await prisma.userPersona.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    })
    const items: PersonaListItem[] = personas.map((p) => toListItem({
      ...p,
      description: p.description ?? undefined,
      systemPrompt: p.systemPrompt ?? undefined,
      temperature: p.temperature ?? undefined,
      maxTokens: p.maxTokens ?? undefined,
      enableReasoning: p.enableReasoning || undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }))
    return reply.send({ personas: items })
  })

  /** GET /personas/:id — get a single persona with full config (including systemPrompt) */
  app.get<{ Params: { id: string } }>('/personas/:id', async (req, reply) => {
    const persona = await prisma.userPersona.findFirst({
      where: { id: req.params.id, userId: req.userId },
    })
    if (!persona) {
      return reply.status(404).send({ error: 'Persona not found' })
    }
    const full: UserPersona = {
      ...persona,
      description: persona.description ?? undefined,
      systemPrompt: persona.systemPrompt ?? undefined,
      temperature: persona.temperature ?? undefined,
      maxTokens: persona.maxTokens ?? undefined,
      enableReasoning: persona.enableReasoning || undefined,
      createdAt: persona.createdAt.toISOString(),
      updatedAt: persona.updatedAt.toISOString(),
    }
    return reply.send(full)
  })

  /** POST /personas — create a new persona */
  app.post<{ Body: CreatePersonaRequest }>('/personas', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
          description: { type: 'string', maxLength: DESCRIPTION_MAX },
          systemPrompt: { type: 'string', maxLength: SYSTEM_PROMPT_MAX },
          icon: { type: 'string', maxLength: 8 },
          color: { type: 'string', maxLength: 16 },
          providerName: { type: 'string', minLength: 1, maxLength: 64 },
          model: { type: 'string', minLength: 1, maxLength: 128 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          maxTokens: { type: 'integer', minimum: 1, maximum: 32768 },
          enableReasoning: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const id = randomUUID()
    const now = new Date()
    const row = await prisma.userPersona.create({
      data: {
        id,
        userId: req.userId,
        name: req.body.name,
        description: req.body.description ?? null,
        systemPrompt: req.body.systemPrompt ?? null,
        icon: req.body.icon ?? '🧑',
        color: req.body.color ?? '#8b5cf6',
        providerName: req.body.providerName ?? 'auto',
        model: req.body.model ?? 'auto',
        temperature: req.body.temperature ?? null,
        maxTokens: req.body.maxTokens ?? null,
        enableReasoning: req.body.enableReasoning ?? false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    })
    req.log.info({ personaId: row.id, userId: req.userId }, 'Persona created')
    const created: UserPersona = {
      ...row,
      description: row.description ?? undefined,
      systemPrompt: row.systemPrompt ?? undefined,
      temperature: row.temperature ?? undefined,
      maxTokens: row.maxTokens ?? undefined,
      enableReasoning: row.enableReasoning || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
    return reply.status(201).send(created)
  })

  /** PUT /personas/:id — update a persona (ownership enforced) */
  app.put<{ Params: { id: string }; Body: UpdatePersonaRequest }>('/personas/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
          description: { type: 'string', maxLength: DESCRIPTION_MAX },
          systemPrompt: { type: 'string', maxLength: SYSTEM_PROMPT_MAX },
          icon: { type: 'string', maxLength: 8 },
          color: { type: 'string', maxLength: 16 },
          providerName: { type: 'string', minLength: 1, maxLength: 64 },
          model: { type: 'string', minLength: 1, maxLength: 128 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          maxTokens: { type: 'integer', minimum: 1, maximum: 32768 },
          enableReasoning: { type: 'boolean' },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const existing = await prisma.userPersona.findFirst({
      where: { id: req.params.id, userId: req.userId },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'Persona not found' })
    }
    const row = await prisma.userPersona.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name !== undefined && { name: req.body.name }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.systemPrompt !== undefined && { systemPrompt: req.body.systemPrompt }),
        ...(req.body.icon !== undefined && { icon: req.body.icon }),
        ...(req.body.color !== undefined && { color: req.body.color }),
        ...(req.body.providerName !== undefined && { providerName: req.body.providerName }),
        ...(req.body.model !== undefined && { model: req.body.model }),
        ...(req.body.temperature !== undefined && { temperature: req.body.temperature }),
        ...(req.body.maxTokens !== undefined && { maxTokens: req.body.maxTokens }),
        ...(req.body.enableReasoning !== undefined && { enableReasoning: req.body.enableReasoning }),
        ...(req.body.enabled !== undefined && { enabled: req.body.enabled }),
        updatedAt: new Date(),
      },
    })
    req.log.info({ personaId: row.id, userId: req.userId }, 'Persona updated')
    const updated: UserPersona = {
      ...row,
      description: row.description ?? undefined,
      systemPrompt: row.systemPrompt ?? undefined,
      temperature: row.temperature ?? undefined,
      maxTokens: row.maxTokens ?? undefined,
      enableReasoning: row.enableReasoning || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
    return reply.send(updated)
  })

  /** DELETE /personas/:id — remove a persona (ownership enforced) */
  app.delete<{ Params: { id: string } }>('/personas/:id', async (req, reply) => {
    const existing = await prisma.userPersona.findFirst({
      where: { id: req.params.id, userId: req.userId },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'Persona not found' })
    }
    await prisma.userPersona.delete({ where: { id: req.params.id } })
    req.log.info({ personaId: req.params.id, userId: req.userId }, 'Persona deleted')
    return reply.status(204).send()
  })

  /** POST /personas/:id/duplicate — copy a persona with a new name */
  app.post<{ Params: { id: string }; Body: { name?: string } }>('/personas/:id/duplicate', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
        },
      },
    },
  }, async (req, reply) => {
    const source = await prisma.userPersona.findFirst({
      where: { id: req.params.id, userId: req.userId },
    })
    if (!source) {
      return reply.status(404).send({ error: 'Persona not found' })
    }
    const newId = randomUUID()
    const now = new Date()
    const copy = await prisma.userPersona.create({
      data: {
        id: newId,
        userId: req.userId,
        name: req.body.name ?? `${source.name} (copy)`,
        description: source.description,
        systemPrompt: source.systemPrompt,
        icon: source.icon,
        color: source.color,
        providerName: source.providerName,
        model: source.model,
        temperature: source.temperature,
        maxTokens: source.maxTokens,
        enableReasoning: source.enableReasoning,
        enabled: source.enabled,
        createdAt: now,
        updatedAt: now,
      },
    })
    req.log.info({ personaId: copy.id, sourceId: source.id, userId: req.userId }, 'Persona duplicated')
    const duplicated: UserPersona = {
      ...copy,
      description: copy.description ?? undefined,
      systemPrompt: copy.systemPrompt ?? undefined,
      temperature: copy.temperature ?? undefined,
      maxTokens: copy.maxTokens ?? undefined,
      enableReasoning: copy.enableReasoning || undefined,
      createdAt: copy.createdAt.toISOString(),
      updatedAt: copy.updatedAt.toISOString(),
    }
    return reply.status(201).send(duplicated)
  })
}
