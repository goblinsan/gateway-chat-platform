-- AlterTable: add executionMode column to Agent with default 'direct_provider'
ALTER TABLE "Agent" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'direct_provider';
