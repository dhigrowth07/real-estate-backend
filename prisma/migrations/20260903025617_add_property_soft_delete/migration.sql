-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "properties_bhk_idx" ON "properties"("bhk");

-- CreateIndex
CREATE INDEX "properties_deletedAt_idx" ON "properties"("deletedAt");
