type Props = {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  controlsId?: string;
  className?: string;
};

export function AssemblyRowToggle({ expanded, onToggle, label, controlsId, className }: Props) {
  return (
    <button
      type="button"
      className={
        className ??
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded text-left font-bold text-inherit hover:text-cyan-100'
      }
      aria-expanded={expanded}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-cyan-300/35 bg-cyan-500/15 text-[0.65rem] leading-none text-cyan-100"
      >
        {expanded ? '▾' : '▸'}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
