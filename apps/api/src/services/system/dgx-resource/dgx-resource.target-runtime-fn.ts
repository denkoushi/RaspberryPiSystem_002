import type { DgxControlTargetAction, DgxControlTargetId } from './dgx-resource.control-target.types.js';

export type TargetRuntimeEventLogMode = 'default' | 'none';

/** runTarget と同形の境界型（ワークロード遷移 / Ready 調整 / ロールバックで共通） */
export type TargetRuntimeDispatchFn = (
  targetId: DgxControlTargetId,
  action: DgxControlTargetAction,
  reason: string | undefined,
  eventLog: TargetRuntimeEventLogMode,
  modelProfileId?: string
) => Promise<{ ok: true; message: string }>;
