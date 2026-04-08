-- Add userId to Conversation for per-user workspace ownership (#85)
ALTER TABLE "Conversation" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'me';

-- Add userId to UsageLog so usage records can be scoped per user (#85)
ALTER TABLE "UsageLog" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'me';
