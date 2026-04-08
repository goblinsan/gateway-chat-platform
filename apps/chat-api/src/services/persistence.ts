import type { PrismaClient } from '@prisma/client'

export interface PersistConversationInput {
  id: string
  userId: string
  agentId: string
  title: string
}

export interface PersistMessageInput {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface PersistUsageLogInput {
  userId: string
  conversationId?: string
  agentId: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  latencyMs: number
}

export async function upsertConversation(
  prisma: PrismaClient,
  input: PersistConversationInput,
): Promise<void> {
  await prisma.conversation.upsert({
    where: { id: input.id },
    update: { title: input.title },
    create: { id: input.id, userId: input.userId, agentId: input.agentId, title: input.title },
  })
}

export async function persistMessage(
  prisma: PrismaClient,
  input: PersistMessageInput,
): Promise<void> {
  await prisma.message.upsert({
    where: { id: input.id },
    update: {},
    create: {
      id: input.id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
    },
  })
}

export async function persistUsageLog(
  prisma: PrismaClient,
  input: PersistUsageLogInput,
): Promise<void> {
  await prisma.usageLog.create({ data: input })
}
