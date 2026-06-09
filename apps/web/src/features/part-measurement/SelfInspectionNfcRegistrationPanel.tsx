import clsx from 'clsx';

import type { SelfInspectionNfcRegistrationView } from './useSelfInspectionNfcRegistration';

type Props = {
  registration: SelfInspectionNfcRegistrationView;
};

function registrationValueClass(registered: boolean): string {
  return clsx(
    'rounded border px-2 py-1 text-sm',
    registered ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white/55'
  );
}

export function SelfInspectionNfcRegistrationPanel({ registration }: Props) {
  return (
    <div
      className="shrink-0 rounded border border-white/15 bg-slate-800/70 p-2"
      data-testid="self-inspection-nfc-registration-panel"
    >
      <p className="text-sm font-semibold text-white/80">NFC 登録（この入力件）</p>
      <div className="mt-2 grid gap-2">
        <div>
          <p className="text-xs text-white/55">測定機器</p>
          <p className={registrationValueClass(Boolean(registration.measuringInstrumentDisplayName))}>
            {registration.measuringInstrumentDisplayName ?? '未登録'}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/55">測定者</p>
          <p className={registrationValueClass(Boolean(registration.employeeDisplayName))}>
            {registration.employeeDisplayName ?? '未登録'}
          </p>
        </div>
      </div>
      {registration.isLocked ? (
        <p className="mt-2 text-xs text-white/50">保存済みの登録は変更できません。</p>
      ) : registration.nextActionLabel ? (
        <p className="mt-2 text-xs text-cyan-100">{registration.nextActionLabel}</p>
      ) : null}
      {registration.message ? (
        <p className="mt-2 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs text-amber-100">
          {registration.message}
        </p>
      ) : null}
    </div>
  );
}
