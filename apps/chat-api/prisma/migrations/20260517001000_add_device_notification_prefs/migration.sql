-- Add notification preference and app version tracking to mobile devices.
-- notificationMinSeverity controls which alert severity levels trigger a push
-- notification for a given device.  Defaults to "high" (high + critical).
-- appVersion is recorded for debugging and analytics.

ALTER TABLE "MobileDevice" ADD COLUMN "notificationMinSeverity" TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "MobileDevice" ADD COLUMN "appVersion" TEXT;
