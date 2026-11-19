-- AlterTable
ALTER TABLE "Server" ADD COLUMN "statusMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Server_guildId_idx" ON "Server"("guildId");

-- AlterTable
ALTER TABLE "WhitelistRequest" ADD COLUMN "reviewNote" TEXT;
