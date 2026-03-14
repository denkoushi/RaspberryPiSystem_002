type DueManagementSelectionToggleButtonProps = {
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
  size?: 'compact' | 'regular';
};

export function DueManagementSelectionToggleButton({
  isSelected,
  onToggle,
  disabled,
  size = 'regular'
}: DueManagementSelectionToggleButtonProps) {
  const paddingClass = size === 'compact' ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-[10px]';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded font-semibold ${
        isSelected
          ? 'bg-blue-600 text-white'
          : 'bg-white/10 text-white hover:bg-white/20'
      } ${paddingClass}`}
      disabled={disabled}
    >
      {isSelected ? '対象中' : '対象化'}
    </button>
  );
}
