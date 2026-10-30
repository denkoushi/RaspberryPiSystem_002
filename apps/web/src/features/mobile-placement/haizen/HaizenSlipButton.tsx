export function HaizenSlipButton({ label, value, color, disabled, onClick, onClear }: {
  label: '移動票' | '現品票'; value?: string; color: string; disabled?: boolean; onClick: () => void; onClear?: () => void;
}) {
  return <div className="relative flex min-w-0">
    <button type="button" aria-label={`${label}を読む`} style={{ color }} disabled={disabled} onClick={onClick}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] px-0.5 leading-[1.1] disabled:opacity-40">
      <span className={`${value ? 'text-[15px]' : 'text-[22px]'} font-black`}>{label}</span>
      {value && <span className={`block max-w-full truncate font-mono text-sm font-bold tabular-nums text-[var(--hp-ink)] ${onClear ? 'pr-6' : ''}`}>{value}</span>}
    </button>
    {value && onClear && <button type="button" aria-label="読み直す" className="absolute bottom-0 right-0 h-11 w-7 text-lg text-[var(--hp-ink2)]" onClick={onClear}>×</button>}
  </div>;
}
