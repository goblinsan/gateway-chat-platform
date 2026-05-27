-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vision" TEXT,
    "status" TEXT NOT NULL DEFAULT 'on_track',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "reviewCadence" TEXT,
    "nextReviewAt" DATETIME,
    "tagsJson" TEXT,
    "sourceSystemsJson" TEXT,
    "metricsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlanMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'on_track',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanMilestone_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'on_track',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PlanMilestone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Plan_userId_updatedAt_idx" ON "Plan"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PlanMilestone_planId_orderIndex_idx" ON "PlanMilestone"("planId", "orderIndex");

-- CreateIndex
CREATE INDEX "PlanTask_milestoneId_orderIndex_idx" ON "PlanTask"("milestoneId", "orderIndex");
