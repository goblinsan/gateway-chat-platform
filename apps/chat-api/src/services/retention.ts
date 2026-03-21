import type { PrismaClient } from '@prisma/client'

export async function runRetentionCleanup(
  prisma: PrismaClient,
  retentionDaysConversations: number,
  retentionDaysLogs: number,
): Promise<{ deletedConversations: number; deletedLogs: number }> {
  const conversationCutoff = new Date()
  conversationCutoff.setDate(conversationCutoff.getDate() - retentionDaysConversations)

  const logCutoff = new Date()
  logCutoff.setDate(logCutoff.getDate() - retentionDaysLogs)

  const [deletedLogs, deletedConversations] = await Promise.all([
    prisma.usageLog.deleteMany({
      where: { createdAt: { lt: logCutoff } },
    }),
    prisma.conversation.deleteMany({
      where: { updatedAt: { lt: conversationCutoff } },
    }),
  ])

  return {
    deletedConversations: deletedConversations.count,
    deletedLogs: deletedLogs.count,
  }
}

export function scheduleRetentionCleanup(
  prisma: PrismaClient,
  retentionDaysConversations: number,
  retentionDaysLogs: number,
  intervalMs = 24 * 60 * 60 * 1000, // 24 hours
): NodeJS.Timeout {
  const run = () => {
    void runRetentionCleanup(prisma, retentionDaysConversations, retentionDaysLogs)
      .then(({ deletedConversations, deletedLogs }) => {
        if (deletedConversations > 0 || deletedLogs > 0) {
          process.stdout.write(
            JSON.stringify({
              level: 30,
              time: Date.now(),
              msg: 'Retention cleanup completed',
              deletedConversations,
              deletedLogs,
            }) + '\n',
          )
        }
      })
      .catch((err: unknown) => {
        process.stderr.write(
          JSON.stringify({
            level: 50,
            time: Date.now(),
            msg: 'Retention cleanup failed',
            err: err instanceof Error ? err.message : String(err),
          }) + '\n',
        )
      })
  }

  run() // run immediately on startup
  return setInterval(run, intervalMs)
}
