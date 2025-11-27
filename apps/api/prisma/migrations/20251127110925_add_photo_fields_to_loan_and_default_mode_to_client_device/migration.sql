-- AlterTable: LoanテーブルにphotoUrlとphotoTakenAtカラムを追加
-- 写真撮影持出機能（FR-009）で使用

-- 1. LoanテーブルにphotoUrlカラムを追加
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

-- 2. LoanテーブルにphotoTakenAtカラムを追加
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "photoTakenAt" TIMESTAMP(3);

-- 3. photoTakenAtカラムにインデックスを追加（写真自動削除機能で使用）
CREATE INDEX IF NOT EXISTS "Loan_photoTakenAt_idx" ON "Loan"("photoTakenAt");

-- AlterTable: ClientDeviceテーブルにdefaultModeカラムを追加
-- クライアント端末ごとに初期表示画面を設定可能にするため

-- 4. ClientDeviceテーブルにdefaultModeカラムを追加（デフォルト値: 'TAG'）
ALTER TABLE "ClientDevice" ADD COLUMN IF NOT EXISTS "defaultMode" TEXT DEFAULT 'TAG';

