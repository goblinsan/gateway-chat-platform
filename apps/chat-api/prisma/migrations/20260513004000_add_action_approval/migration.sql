-- CreateTable
CREATE TABLE "ActionApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "actionType" TEXT NOT NULL,
    "targetNode" TEXT,
    "targetService" TEXT,
    "proposedByAgentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "metadataJson" TEXT
);

-- CreateIndex
CREATE INDEX "ActionApproval_userId_status_idx" ON "ActionApproval"("userId", "status");

-- CreateIndex
CREATE INDEX "ActionApproval_userId_createdAt_idx" ON "ActionApproval"("userId", "createdAt");
