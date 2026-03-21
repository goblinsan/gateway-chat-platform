import { PrismaClient } from '@prisma/client'

let _prisma: PrismaClient | undefined

export function getPrismaClient(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient()
  }
  return _prisma
}

export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = undefined
  }
}
