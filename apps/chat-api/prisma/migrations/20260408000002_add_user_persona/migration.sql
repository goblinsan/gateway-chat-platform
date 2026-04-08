-- Add UserPersona table for user-owned agent personalities (#89)
CREATE TABLE "UserPersona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT,
    "icon" TEXT NOT NULL DEFAULT '🧑',
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "providerName" TEXT NOT NULL DEFAULT 'auto',
    "model" TEXT NOT NULL DEFAULT 'auto',
    "temperature" REAL,
    "maxTokens" INTEGER,
    "enableReasoning" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Index on userId for fast per-user queries
CREATE INDEX "UserPersona_userId_idx" ON "UserPersona"("userId");
