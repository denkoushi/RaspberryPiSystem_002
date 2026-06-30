import clsx from 'clsx';

import type { SelfInspectionLotEntryDto } from './types';
import type { SelfInspectionNfcRegistrationView } from './useSelfInspectionNfcRegistration';

type Props = {
  registration: SelfInspectionNfcRegistrationView;
  requireMeasuringInstrumentTag: boolean;
  instrumentUsages?: SelfInspectionLotEntryDto['instrumentUsages'];
};

function registrationValueClass(registered: boolean): string {
  return clsx(
    'min-w-0 truncate rounded border px-2 py-1 text-sm',
    registered ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white/55'
  );
}

export function SelfInspectionNfcRegistrationPanel({
  registration,
  requireMeasuringInstrumentTag,
  instrumentUsages = []
}: Props) {
  const instrumentRegistered = instrumentUsages.length > 0 || Boolean(registration.measuringInstrumentDisplayName);
  return (
    <div
      className="shrink-0 rounded border border-white/15 bg-slate-800/70 p-2"
      data-testid="self-inspection-nfc-registration-panel"
    >
      <p className="text-sm font-semibold text-white/80">使用前点検（この入力件）</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <p className="text-xs text-white/55">計測機器{requireMeasuringInstrumentTag ? '' : '（任意）'}</p>
          {instrumentUsages.length > 0 ? (
            <div className="grid gap-1">
              {instrumentUsages.map((usage) => (
                <p key={usage.id} className={registrationValueClass(true)}>
                  {usage.measuringInstrumentManagementNumberSnapshot} {usage.measuringInstrumentNameSnapshot}
                </p>
              ))}
            </div>
          ) : (
            <p className={registrationValueClass(instrumentRegistered)}>
              {registration.measuringInstrumentDisplayName ?? (requireMeasuringInstrumentTag ? '未点検' : '未点検（任意）')}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-white/55">測定者</p>
          <p className={registrationValueClass(Boolean(registration.employeeDisplayName))}>
            {registration.employeeDisplayName ?? '未登録'}
          </p>
        </div>
      </div>
      {instrumentUsages.length > 0 ? <p className="mt-2 text-xs text-emerald-100">使用前点検済</p> : null}
      {registration.message ? (
        <p className="mt-2 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs text-amber-100">
          {registration.message}
        </p>
      ) : null}
    </div>
  );
}
