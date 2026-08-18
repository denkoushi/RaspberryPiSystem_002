import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { kioskFlowButtonClass } from '../kiosk/kioskFlowButtonTheme';

import type {
  TorqueWrenchConnectionOwner,
  TorqueWrenchConnectionTargetKind
} from './torqueWrenchConnectionTransport';

export const TORQUE_TAKEOVER_CONFIRMATION_ARM_DELAY_MS = 1_200;

export type TorqueWrenchTakeoverPanelProps = {
  owner: TorqueWrenchConnectionOwner | null;
  targetKind: TorqueWrenchConnectionTargetKind;
  busy?: boolean;
  disabled?: boolean;
  onTakeover: () => void | Promise<void>;
  className?: string;
};

function defaultFunctionLabel(targetKind: TorqueWrenchConnectionTargetKind): string {
  return targetKind === 'training' ? '締付トルク訓練' : '組立作業';
}

function ownerFunctionLabel(
  owner: TorqueWrenchConnectionOwner | null,
  targetKind: TorqueWrenchConnectionTargetKind
): string {
  return owner?.functionLabel
    ?? owner?.function
    ?? (owner?.targetKind ? defaultFunctionLabel(owner.targetKind)
      : owner?.ownerKind ? defaultFunctionLabel(String(owner.ownerKind).toLowerCase() as TorqueWrenchConnectionTargetKind)
        : defaultFunctionLabel(targetKind));
}

/**
 * Deliberate physical-presence takeover shared by assembly and training.
 * The first click only opens the confirmation surface. A separate checkbox
 * becomes available after 1.2 seconds and the final action is placed below it.
 */
export function TorqueWrenchTakeoverPanel({
  owner,
  targetKind,
  busy = false,
  disabled = false,
  onTakeover,
  className = ''
}: TorqueWrenchTakeoverPanelProps) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [physicalPresenceConfirmed, setPhysicalPresenceConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(
      () => setArmed(true),
      TORQUE_TAKEOVER_CONFIRMATION_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setArmed(false);
    setPhysicalPresenceConfirmed(false);
  };

  const openConfirmation = () => {
    setArmed(false);
    setPhysicalPresenceConfirmed(false);
    setOpen(true);
  };

  return (
    <div className={`col-span-2 grid gap-2 rounded border border-amber-300/30 bg-amber-950/30 p-3 text-sm ${className}`} data-testid="torque-wrench-takeover-panel">
      <div className="grid gap-1 font-semibold text-amber-100">
        <span>
          {owner?.clientDeviceName ?? '別端末'}
          {owner?.clientDeviceLocation ? `（${owner.clientDeviceLocation}）` : ''} が使用中
        </span>
        <span className="text-xs font-normal text-amber-100/80">
          使用機能: {ownerFunctionLabel(owner, targetKind)}
        </span>
      </div>
      {!open ? (
        <button
          type="button"
          className={kioskFlowButtonClass({ disabled: disabled || busy })}
          disabled={disabled || busy}
          onClick={openConfirmation}
        >
          現物が手元にあるため引き継ぐ
        </button>
      ) : (
        <div className="grid gap-3 rounded border border-amber-200/25 bg-slate-950/70 p-3">
          <p className="text-xs font-semibold text-amber-100">レンチ本体がこの端末の前にあることを、もう一度確認してください。</p>
          <label className="flex min-h-12 items-center gap-3 rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-amber-400"
              checked={physicalPresenceConfirmed}
              disabled={busy || !armed}
              onChange={(event) => setPhysicalPresenceConfirmed(event.target.checked)}
            />
            <span>レンチ本体がこの端末の前にあることを確認しました</span>
          </label>
          <p className="text-xs text-white/65" aria-live="polite">
            {armed
              ? '確認欄にチェックしてから、接続権の引継ぎを実行してください。'
              : '誤操作防止のため、確認欄が有効になるまで少しお待ちください。'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={kioskFlowButtonClass({ disabled: busy })}
              disabled={busy}
              onClick={close}
            >
              やめる
            </button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !armed || !physicalPresenceConfirmed}
              onClick={() => {
                void Promise.resolve(onTakeover()).then(close, () => undefined);
              }}
            >
              確認して接続権を引き継ぐ
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
