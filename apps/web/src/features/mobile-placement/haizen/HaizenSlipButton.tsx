export function HaizenSlipButton({ label, sub, value, color, disabled, onClick }: {
  label: '移動票' | '現品票'; sub: string; value?: string; color: string; disabled?: boolean; onClick: () => void;
}) {
  return <button type="button" aria-label={`${label}を読む`} style={{ color }} disabled={disabled} onClick={onClick}
    className="min-w-0 rounded-2xl border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] px-0.5 py-0.5 leading-[1.1] disabled:opacity-40">
    <span className="flex flex-wrap items-baseline justify-center gap-x-1"><span className="text-[22px] font-black leading-[1.1]">{label}</span><span className="text-[13px] font-bold">{sub}</span></span>
    {value && <span className="block truncate font-mono text-[17px] font-bold tabular-nums text-[var(--hp-ink)]">{value}</span>}
  </button>;
}
