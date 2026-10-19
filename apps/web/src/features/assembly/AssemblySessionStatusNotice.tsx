import type { ReactNode } from 'react';

export type AssemblySessionStatusNoticeProps = {
  message?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
};

/**
 * 共通ヘッダー中央に置く作業状態の表示。
 * 表示だけを担当し、APIや作業状態の判断は呼び出し側に残す。
 */
export function AssemblySessionStatusNotice({
  message,
  tone = 'default',
  className = ''
}: AssemblySessionStatusNoticeProps) {
  const isError = tone === 'error';
  const toneClassName = isError
    ? 'border-rose-300/30 bg-rose-950/70 text-rose-100 whitespace-normal break-words'
    : 'border-white/10 bg-slate-950/65 text-amber-200 truncate';

  return (
    <div
      className={`min-w-0 rounded border px-3 py-2 text-sm font-semibold ${toneClassName} ${className}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid="assembly-work-session-status"
      title={typeof message === 'string' ? message : undefined}
    >
      {message ?? ' '}
    </div>
  );
}
