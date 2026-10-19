export function WorkInstructionMemoReviewIndicator({ label, testId }: { label: string; testId: string }) {
  return <span className="block h-2 w-2 rounded-full bg-[#f6b93b]" role="status" aria-label={label} data-testid={testId} />;
}
