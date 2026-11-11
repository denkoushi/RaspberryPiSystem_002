import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

export function PlanningBoardUnitSplitButton({ resourceCd, flags, disabled, onChange }: {
  resourceCd: string;
  flags?: Readonly<Record<string, boolean>>;
  disabled: boolean;
  onChange?: (resourceCd: string, enabled: boolean) => void;
}) {
  const enabled = isPlanningBoardUnitSplitEnabled(resourceCd, flags);
  return <button type="button" aria-pressed={enabled} disabled={disabled}
    className={`flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border bg-slate-900 px-2.5 text-[15px] font-extrabold disabled:opacity-40 ${enabled ? 'border-sky-400 text-slate-100' : 'border-slate-600 text-slate-400'}`}
    onClick={() => onChange?.(resourceCd, !enabled)}>
    <span aria-hidden="true" className={`relative h-[18px] w-[30px] rounded-full ${enabled ? 'bg-sky-400' : 'bg-slate-700'}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full ${enabled ? 'left-[14px] bg-slate-950' : 'left-[2px] bg-slate-300'}`} />
    </span>1台ずつ
  </button>;
}
