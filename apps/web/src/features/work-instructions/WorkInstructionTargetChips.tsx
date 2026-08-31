export type WorkInstructionTargetChipsProps = {
  targets: readonly string[];
  onSelect: (target: string) => void;
  disabled?: boolean;
};

/**
 * Displays the available shooting targets as a compact, touch-friendly strip.
 * Selection and target ordering stay with the page/controller.
 */
export function WorkInstructionTargetChips({
  targets,
  onSelect,
  disabled = false
}: WorkInstructionTargetChipsProps) {
  if (targets.length === 0) return null;

  return (
    <div
      className="flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto whitespace-nowrap"
      role="group"
      aria-label="撮影対象"
    >
      {targets.map((target, index) => (
        <button
          key={`${target}-${index}`}
          type="button"
          className="min-h-11 shrink-0 rounded-full border border-cyan-200/50 bg-cyan-950/60 px-2.5 text-sm font-bold text-cyan-50 hover:bg-cyan-900/80 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => onSelect(target)}
          disabled={disabled}
        >
          {target}
        </button>
      ))}
    </div>
  );
}
