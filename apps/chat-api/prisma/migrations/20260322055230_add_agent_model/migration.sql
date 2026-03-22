-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🤖',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "providerName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "costClass" TEXT NOT NULL DEFAULT 'free',
    "systemPrompt" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "enableReasoning" BOOLEAN NOT NULL DEFAULT false,
    "featureFlags" TEXT,
    "routingPolicy" TEXT,
    "endpointConfig" TEXT,
    "contextSources" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
