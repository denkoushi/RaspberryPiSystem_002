import clsx from 'clsx';
import { Fragment } from 'react';

export type LeaderOrderRowClusterToken = {
  value: string;
  className?: string;
  title?: string;
};

type Props = {
  tokens: readonly LeaderOrderRowClusterToken[];
};

/**
 * 順位ボード子行の先頭ブロックを中点区切りで1行に並べる。
 */
export function LeaderOrderRowClusterLine({ tokens }: Props) {
  const visibleTokens = tokens.filter((token) => token.value.trim().length > 0);

  if (visibleTokens.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-[0.35em] gap-y-0.5 text-[11px] text-white/80">
      {visibleTokens.map((token, i) => (
        <Fragment key={`${token.value}-${i}`}>
          {i > 0 ? (
            <span className="select-none text-white/40" aria-hidden>
              ·
            </span>
          ) : null}
          <span className={clsx('min-w-0 break-words', token.className)} title={token.title}>
            {token.value}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
