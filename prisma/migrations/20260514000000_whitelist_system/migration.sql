-- CreateEnum
CREATE TYPE "WhitelistEdition" AS ENUM ('JAVA', 'BEDROCK');

-- CreateEnum
CREATE TYPE "WhitelistRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "WhitelistConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requestChannelId" TEXT NOT NULL,
    "staffChannelId" TEXT NOT NULL,
    "requestMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhitelistConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistModRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhitelistModRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "edition" "WhitelistEdition" NOT NULL,
    "status" "WhitelistRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhitelistRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistConfig_guildId_key" ON "WhitelistConfig"("guildId");

-- CreateIndex
CREATE INDEX "WhitelistModRole_guildId_idx" ON "WhitelistModRole"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistModRole_guildId_roleId_key" ON "WhitelistModRole"("guildId", "roleId");

-- CreateIndex
CREATE INDEX "WhitelistRequest_guildId_status_idx" ON "WhitelistRequest"("guildId", "status");

-- CreateIndex
CREATE INDEX "WhitelistRequest_guildId_userId_status_idx" ON "WhitelistRequest"("guildId", "userId", "status");

-- AddForeignKey
ALTER TABLE "WhitelistModRole" ADD CONSTRAINT "WhitelistModRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "WhitelistConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhitelistRequest" ADD CONSTRAINT "WhitelistRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "WhitelistConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
