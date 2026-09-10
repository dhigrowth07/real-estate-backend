-- CreateEnum
CREATE TYPE "LeadQualificationStatus" AS ENUM ('UNQUALIFIED', 'IN_PROGRESS', 'QUALIFIED', 'REQUESTED_AGENT');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('NOT_STARTED', 'ASK_PROPERTY_TYPE', 'ASK_BUDGET', 'ASK_LOCATION', 'ASK_TIMELINE', 'COMPLETE');

-- AlterTable: leads
ALTER TABLE "leads" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "budgetMin" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "budgetMin" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "budgetMax" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "budgetMax" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "propertyType" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "propertyType" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "purpose" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "purpose" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "urgency" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "urgency" DROP DEFAULT;
ALTER TABLE "leads" ADD COLUMN "qualificationStatus" "LeadQualificationStatus" NOT NULL DEFAULT 'UNQUALIFIED';

-- CreateIndex
CREATE INDEX "leads_qualificationStatus_idx" ON "leads"("qualificationStatus");

-- AlterTable: conversations
ALTER TABLE "conversations" ADD COLUMN "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateIndex
CREATE INDEX "conversations_onboardingStep_idx" ON "conversations"("onboardingStep");
