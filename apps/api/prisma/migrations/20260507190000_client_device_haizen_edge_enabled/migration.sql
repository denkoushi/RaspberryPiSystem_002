-- AlterTable
ALTER TABLE "ClientDevice" ADD COLUMN "haizenEdgeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: 既存運用の文字列ルール（apiKey/name に zero2w）に一致した端末を haizen エッジとして有効化
UPDATE "ClientDevice"
SET "haizenEdgeEnabled" = true
WHERE LOWER("apiKey") LIKE '%zero2w%' OR LOWER("name") LIKE '%zero2w%';
