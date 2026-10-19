import type { Prisma } from '@prisma/client';

export const TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS = {
  PROGRAM_CREATED: 'PROGRAM_CREATED',
  PROGRAM_REVISED: 'PROGRAM_REVISED',
  PROGRAM_DEACTIVATED: 'PROGRAM_DEACTIVATED',
  SESSION_EXCLUDED: 'SESSION_EXCLUDED'
} as const;

export type TorqueTrainingSettingsAuditAction =
  (typeof TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS)[keyof typeof TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS];

export type TorqueTrainingSettingsAuditContext = {
  clientDeviceId: string;
  clientDeviceName: string;
};

type AppendTorqueTrainingSettingsAuditInput = TorqueTrainingSettingsAuditContext & {
  action: TorqueTrainingSettingsAuditAction;
  targetType: 'PROGRAM' | 'SESSION';
  targetId: string;
};

/**
 * 共有PINで実行した設定変更を、操作と同じtransactionへ追記する。
 * 個人を識別する管理ユーザー監査ではなく、端末監査としてのみ利用する。
 */
export async function appendTorqueTrainingSettingsAudit(
  tx: Prisma.TransactionClient,
  input: AppendTorqueTrainingSettingsAuditInput
): Promise<void> {
  await tx.torqueTrainingSettingsAuditLog.create({
    data: {
      clientDeviceId: input.clientDeviceId,
      clientDeviceNameSnapshot: input.clientDeviceName,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId
    }
  });
}
