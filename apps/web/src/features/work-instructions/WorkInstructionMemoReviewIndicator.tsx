type WorkInstructionMemoReviewIndicatorProps = {
  label: string;
  testId: string;
};

export function WorkInstructionMemoReviewIndicator({
  label,
  testId
}: WorkInstructionMemoReviewIndicatorProps) {
  return (
    <span
      className="rounded border border-amber-300/50 bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-100"
      role="status"
      aria-label={label}
      data-testid={testId}
    >
      メモ要確認
    </span>
  );
}
