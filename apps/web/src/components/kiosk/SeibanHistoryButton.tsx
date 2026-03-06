const MAX_MACHINE_NAME_CHARS = 36;

const toHalfWidthAscii = (value: string): string =>
  value.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');

const normalizeMachineName = (value: string | null | undefined): string => {
  const normalized = toHalfWidthAscii(value?.trim() ?? '').toUpperCase();
  if (normalized.length <= MAX_MACHINE_NAME_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_MACHINE_NAME_CHARS)}...`;
};

type SeibanHistoryButtonProps = {
  seiban: string;
  machineName?: string | null;
  isActive: boolean;
  isComplete: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
};

export function SeibanHistoryButton({
  seiban,
  machineName,
  isActive,
  isComplete,
  canMoveLeft,
  canMoveRight,
  onToggle,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: SeibanHistoryButtonProps) {
  const normalizedMachineName = normalizeMachineName(machineName);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      className={`relative flex h-16 w-36 cursor-pointer flex-col justify-start rounded-2xl border px-3 py-1 text-xs font-semibold transition-colors ${
        isActive
          ? 'border-emerald-300 bg-emerald-400 text-slate-900 hover:bg-emerald-300'
          : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      <span className="min-h-[16px] leading-4">{seiban}</span>
      <span className="line-clamp-2 min-h-[32px] break-all text-[10px] leading-4">{normalizedMachineName}</span>
      <button
        type="button"
        aria-label={`履歴から削除: ${seiban}`}
        title={isComplete ? '完了' : '未完'}
        className={`absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-slate-900 shadow box-border ${
          isComplete
            ? 'bg-slate-300 border-2 border-white hover:bg-slate-200'
            : 'bg-white border-2 border-transparent hover:bg-slate-100'
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
        <button
          type="button"
          aria-label={`${seiban} を左に移動`}
          disabled={!canMoveLeft}
          className="flex h-5 w-5 items-center justify-center rounded text-[10px] leading-none disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={(event) => {
            event.stopPropagation();
            if (canMoveLeft) onMoveLeft();
          }}
        >
          ←
        </button>
        <button
          type="button"
          aria-label={`${seiban} を右に移動`}
          disabled={!canMoveRight}
          className="flex h-5 w-5 items-center justify-center rounded text-[10px] leading-none disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={(event) => {
            event.stopPropagation();
            if (canMoveRight) onMoveRight();
          }}
        >
          →
        </button>
      </div>
    </div>
  );
}
