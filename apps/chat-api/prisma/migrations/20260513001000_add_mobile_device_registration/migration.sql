-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MobileDevice_userId_platform_idx" ON "MobileDevice"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_userId_platform_tokenHash_key" ON "MobileDevice"("userId", "platform", "tokenHash");
