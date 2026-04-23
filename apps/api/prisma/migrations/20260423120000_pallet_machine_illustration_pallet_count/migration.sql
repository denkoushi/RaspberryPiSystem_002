-- AlterTable: optional image for count-only rows, per-machine pallet count (default 10)
ALTER TABLE "PalletMachineIllustration" ADD COLUMN "palletCount" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PalletMachineIllustration" ALTER COLUMN "imageRelativeUrl" DROP NOT NULL;
