import clsx from 'clsx';

export type SelfInspectionAutosaveStatus = 'idle' | 'pending' | 'saved' | 'unsynced';

type Props = {
  status: SelfInspectionAutosaveStatus;
  savedAtLabel?: string | null;
};

export function SelfInspectionAutosaveBadge({ status, savedAtLabel }: Props) {
  const label =
    status === 'pending'
      ? '下書き 保存中…'
      : status === 'saved'
        ? `下書き 自動保存済${savedAtLabel ? ` ${savedAtLabel}` : ''}`
        : status === 'unsynced'
          ? '下書き 未同期'
          : null;
  if (!label) return null;

  return (
    <span
      className={clsx(
        'inline-flex min-w-0 shrink truncate rounded-full border px-2 py-0.5 text-xs font-semibold leading-none',
        status === 'saved'
          ? 'border-lime-300/40 bg-lime-400/10 text-lime-100'
          : 'border-amber-300/40 bg-amber-400/10 text-amber-100'
      )}
      data-testid="self-inspection-autosave-badge"
      title={label}
    >
      {label}
    </span>
  );
}
