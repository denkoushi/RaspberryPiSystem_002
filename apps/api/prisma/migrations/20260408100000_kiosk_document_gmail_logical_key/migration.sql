-- Gmail 取り込み: 添付名ベースの論理キー（同一キーは新しいメールで上書き）と Gmail internalDate 用

-- AlterTable
ALTER TABLE "KioskDocument" ADD COLUMN "gmailLogicalKey" TEXT;
ALTER TABLE "KioskDocument" ADD COLUMN "gmailInternalDateMs" BIGINT;

-- 既存 Gmail 行へ論理キーを付与（実行時のアプリ正規化の簡易版: lower + trim）
UPDATE "KioskDocument"
SET "gmailLogicalKey" = LOWER(REPLACE(TRIM("sourceAttachmentName"), E'\\', '/'))
WHERE "sourceType" = 'GMAIL'
  AND "sourceAttachmentName" IS NOT NULL
  AND TRIM("sourceAttachmentName") <> '';

-- 論理キー重複: 最新 createdAt を残し、他は無効化してキーを外す（一意制約作成前提）
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "gmailLogicalKey"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM "KioskDocument"
  WHERE "gmailLogicalKey" IS NOT NULL
)
UPDATE "KioskDocument" d
SET
  "enabled" = false,
  "gmailLogicalKey" = NULL
FROM ranked r
WHERE d.id = r.id AND r.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "KioskDocument_gmailLogicalKey_key" ON "KioskDocument"("gmailLogicalKey");
