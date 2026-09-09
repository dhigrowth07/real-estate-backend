-- AlterEnum: Add new values to LeadSource
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WHATSAPP';

-- AlterEnum: Add new values to LeadStage
ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'UNQUALIFIED';

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'TEMPLATE', 'AUTO_REPLY');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookPlatform" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED');

-- AlterTable: leads
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "instagramUserId" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "whatsappOptInEvidence" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "interestedPropertyId" TEXT;

-- AlterTable: matches
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "isExplicit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "breakdown" JSONB;

-- CreateTable: conversations
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "channel" "ChannelType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "windowOpenUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: messages
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "rawText" TEXT NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "externalMessageId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: post_property_mappings
CREATE TABLE "post_property_mappings" (
    "id" TEXT NOT NULL,
    "instagramMediaId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_property_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pending_interests
CREATE TABLE "pending_interests" (
    "id" TEXT NOT NULL,
    "commentId" TEXT,
    "instagramUserId" TEXT NOT NULL,
    "commenterUsername" TEXT,
    "propertyId" TEXT NOT NULL,
    "commentText" TEXT NOT NULL,
    "commentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: webhook_logs
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "platform" "WebhookPlatform" NOT NULL,
    "eventType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: templates
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL DEFAULT 'MARKETING',
    "language" TEXT NOT NULL DEFAULT 'en',
    "headerType" TEXT,
    "bodyText" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TemplateStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "leads_instagramUserId_key" ON "leads"("instagramUserId");
CREATE INDEX IF NOT EXISTS "leads_instagramUserId_idx" ON "leads"("instagramUserId");
CREATE INDEX IF NOT EXISTS "leads_interestedPropertyId_idx" ON "leads"("interestedPropertyId");

CREATE INDEX IF NOT EXISTS "matches_isExplicit_idx" ON "matches"("isExplicit");

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_channel_externalId_key" ON "conversations"("channel", "externalId");
CREATE INDEX IF NOT EXISTS "conversations_leadId_idx" ON "conversations"("leadId");
CREATE INDEX IF NOT EXISTS "conversations_channel_idx" ON "conversations"("channel");
CREATE INDEX IF NOT EXISTS "conversations_externalId_idx" ON "conversations"("externalId");
CREATE INDEX IF NOT EXISTS "conversations_windowOpenUntil_idx" ON "conversations"("windowOpenUntil");

CREATE UNIQUE INDEX IF NOT EXISTS "messages_externalMessageId_key" ON "messages"("externalMessageId");
CREATE INDEX IF NOT EXISTS "messages_conversationId_idx" ON "messages"("conversationId");
CREATE INDEX IF NOT EXISTS "messages_direction_idx" ON "messages"("direction");
CREATE INDEX IF NOT EXISTS "messages_status_idx" ON "messages"("status");
CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "post_property_mappings_instagramMediaId_key" ON "post_property_mappings"("instagramMediaId");
CREATE INDEX IF NOT EXISTS "post_property_mappings_instagramMediaId_idx" ON "post_property_mappings"("instagramMediaId");
CREATE INDEX IF NOT EXISTS "post_property_mappings_propertyId_idx" ON "post_property_mappings"("propertyId");

CREATE UNIQUE INDEX IF NOT EXISTS "pending_interests_commentId_key" ON "pending_interests"("commentId");
CREATE INDEX IF NOT EXISTS "pending_interests_commentId_idx" ON "pending_interests"("commentId");
CREATE INDEX IF NOT EXISTS "pending_interests_instagramUserId_idx" ON "pending_interests"("instagramUserId");
CREATE INDEX IF NOT EXISTS "pending_interests_propertyId_idx" ON "pending_interests"("propertyId");
CREATE INDEX IF NOT EXISTS "pending_interests_resolved_idx" ON "pending_interests"("resolved");

CREATE INDEX IF NOT EXISTS "webhook_logs_platform_idx" ON "webhook_logs"("platform");
CREATE INDEX IF NOT EXISTS "webhook_logs_eventType_idx" ON "webhook_logs"("eventType");
CREATE INDEX IF NOT EXISTS "webhook_logs_status_idx" ON "webhook_logs"("status");
CREATE INDEX IF NOT EXISTS "webhook_logs_createdAt_idx" ON "webhook_logs"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "templates_name_key" ON "templates"("name");
CREATE INDEX IF NOT EXISTS "templates_name_idx" ON "templates"("name");
CREATE INDEX IF NOT EXISTS "templates_status_idx" ON "templates"("status");

-- Foreign Keys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_interestedPropertyId_fkey') THEN
        ALTER TABLE "leads" ADD CONSTRAINT "leads_interestedPropertyId_fkey" FOREIGN KEY ("interestedPropertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_leadId_fkey') THEN
        ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversationId_fkey') THEN
        ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_property_mappings_propertyId_fkey') THEN
        ALTER TABLE "post_property_mappings" ADD CONSTRAINT "post_property_mappings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_interests_propertyId_fkey') THEN
        ALTER TABLE "pending_interests" ADD CONSTRAINT "pending_interests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
