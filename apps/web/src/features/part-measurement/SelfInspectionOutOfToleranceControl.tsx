import { SelfInspectionKioskButton } from './SelfInspectionKioskButton';
import { selfInspectionKioskButtonClass } from './selfInspectionKioskTheme';

import type { SelfInspectionOutOfToleranceUiState } from './selfInspectionOutOfToleranceUiState';

type Props = {
  state: SelfInspectionOutOfToleranceUiState | null;
  disabled?: boolean;
  onRequestAcknowledgement: () => void;
};

export function SelfInspectionOutOfToleranceControl({
  state,
  disabled = false,
  onRequestAcknowledgement
}: Props) {
  if (!state) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-red-300/40 bg-red-950/35 p-2"
      data-self-inspection-out-of-tolerance-control
    >
      <div>
        <p className="text-sm font-extrabold text-red-100">{state.label}</p>
        <p className="text-xs text-white/70">
          公差外の測定値です。保存するには内容を確認してください。
        </p>
      </div>
      {state.acknowledged ? (
        <span
          role="status"
          className={selfInspectionKioskButtonClass({
            size: 'actionCompact',
            pressed: true,
            tone: 'success'
          })}
        >
          公差外で確認済み
        </span>
      ) : (
        <SelfInspectionKioskButton
          type="button"
          size="actionCompact"
          tone="danger"
          disabled={disabled}
          onClick={onRequestAcknowledgement}
        >
          公差外のまま進む
        </SelfInspectionKioskButton>
      )}
    </div>
  );
}
