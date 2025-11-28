-- AlterTable: LoanテーブルにcancelledAtカラムを追加
-- 誤スキャン時の取消機能（ダッシュボード用データ信頼性向上）で使用
-- データを削除せず、取消フラグで管理することで、ダッシュボードで除外可能にする

-- 1. LoanテーブルにcancelledAtカラムを追加
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

-- 2. cancelledAtカラムにインデックスを追加（findActive()で除外する際に使用）
CREATE INDEX IF NOT EXISTS "Loan_cancelledAt_idx" ON "Loan"("cancelledAt");

-- AlterEnum: TransactionActionにCANCELを追加
-- 取消履歴を記録するため

-- 3. TransactionAction enumにCANCELを追加
ALTER TYPE "TransactionAction" ADD VALUE IF NOT EXISTS 'CANCEL';

