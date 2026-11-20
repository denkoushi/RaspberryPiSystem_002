import type { HaizenVerifyRecord } from './haizenRecordTypes';

export const verifyResults = {
  match: { mark: '✓', label: '一致', color: 'text-inv-green', background: 'bg-inv-green/10', solid: 'bg-inv-green text-inv-green-ink' },
  mismatch: { mark: '×', label: '不一致', color: 'text-inv-red', background: 'bg-inv-red/10', solid: 'bg-inv-red text-[#2b0606]' },
  not_found: { mark: '?', label: '未登録', color: 'text-inv-amber', background: 'bg-inv-amber/10', solid: 'bg-inv-amber text-inv-amber-ink' },
  error: { mark: '!', label: '照合できませんでした', color: 'text-inv-muted', background: 'bg-inv-muted/10', solid: 'bg-inv-muted text-inv-bg' }
};

type RecheckFields = Pick<HaizenVerifyRecord, 'result' | 'recheckOutcome'>;

/** The result shown in filters and counts: the automatic recheck wins over the original. */
export const effectiveVerifyResult = (record: RecheckFields): HaizenVerifyRecord['result'] => record.recheckOutcome ?? record.result;

const badgeSize = { sm: 'h-5 w-5 text-xs -bottom-1.5 -right-1.5', lg: 'h-[26px] w-[26px] text-[15px] -bottom-2 -right-2' };

export function RecheckBadge({ outcome, size }: { outcome: HaizenVerifyRecord['recheckOutcome']; size: keyof typeof badgeSize }) {
  if (!outcome) return null;
  const view = verifyResults[outcome];
  return <span data-testid="recheck-badge" aria-hidden="true" className={`absolute flex items-center justify-center rounded-full border-2 border-inv-s1 font-bold leading-none ${badgeSize[size]} ${view.solid}`}>{view.mark}</span>;
}
