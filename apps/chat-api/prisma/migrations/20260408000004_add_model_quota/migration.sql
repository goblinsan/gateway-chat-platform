-- CreateTable
CREATE TABLE "ModelQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '*',
    "model" TEXT NOT NULL,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "maxTokens" INTEGER,
    "maxRequests" INTEGER,
    "maxCostUsd" REAL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelQuota_userId_model_key" ON "ModelQuota"("userId", "model");
