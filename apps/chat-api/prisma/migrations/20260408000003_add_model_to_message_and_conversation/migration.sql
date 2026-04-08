-- Add defaultModel to Conversation for per-chat model preference (#93)
ALTER TABLE "Conversation" ADD COLUMN "defaultModel" TEXT;

-- Add model and provider to Message for per-message model tracking (#93)
ALTER TABLE "Message" ADD COLUMN "model" TEXT;
ALTER TABLE "Message" ADD COLUMN "provider" TEXT;
