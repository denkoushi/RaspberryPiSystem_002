-- キオスクの共有操作パスワードで実行した訓練設定変更の追記専用監査。
-- 既存テーブル・既存行は変更せず、expand-only で追加する。
CREATE TABLE "TorqueTrainingSettingsAuditLog" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingSettingsAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TorqueTrainingSettingsAuditLog_idx_device_time"
ON "TorqueTrainingSettingsAuditLog"("clientDeviceId", "createdAt");

CREATE INDEX "TorqueTrainingSettingsAuditLog_idx_target_time"
ON "TorqueTrainingSettingsAuditLog"("targetType", "targetId", "createdAt");

ALTER TABLE "TorqueTrainingSettingsAuditLog"
ADD CONSTRAINT "TorqueTrainingSettingsAuditLog_clientDeviceId_fkey"
FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
