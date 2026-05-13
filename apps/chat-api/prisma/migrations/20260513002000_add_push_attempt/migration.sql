-- AlterTable: add enabled column to MobileDevice
ALTER TABLE "MobileDevice" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PushAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'apns',
    "alertId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushAttempt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PushAttempt_deviceId_idx" ON "PushAttempt"("deviceId");
