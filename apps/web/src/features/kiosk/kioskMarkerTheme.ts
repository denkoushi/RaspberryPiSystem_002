import clsx from 'clsx';

export type KioskMarkerStatus = 'pending' | 'ok' | 'ng';

export const KIOSK_MARKER_STATUS_CLASS: Record<KioskMarkerStatus, string> = {
  pending: 'bg-white text-slate-900 ring-2 ring-slate-400',
  ok: 'bg-emerald-500 text-white ring-2 ring-emerald-200',
  ng: 'bg-red-600 text-white ring-2 ring-red-200'
};

export function kioskMarkerInputTargetOutlineClass(isInputTarget: boolean): string {
  return isInputTarget
    ? 'rounded-full outline outline-[3px] outline-offset-2 outline-sky-400'
    : '';
}

export function kioskMarkerButtonClass(status: KioskMarkerStatus): string {
  return clsx(
    'flex h-9 min-w-9 items-center justify-center rounded-full px-1 text-sm font-bold tabular-nums shadow-md',
    KIOSK_MARKER_STATUS_CLASS[status]
  );
}
