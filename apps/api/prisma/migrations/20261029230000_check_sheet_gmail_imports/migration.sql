ALTER TABLE "AssemblyCheckSheetAsset"
ADD COLUMN "gmailMessageId" TEXT,
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "dismissedAt" TIMESTAMP(3);
