import { Fragment } from 'react';

type Props = {
  segments: string[];
  quantityInlineJa: string | null;
};

/**
 * 製番・品目コード・個数を中点区切りで1行に並べる（順位ボード子行の先頭ブロック）。
 */
export function LeaderOrderRowClusterLine({ segments, quantityInlineJa }: Props) {
  if (segments.length === 0 && !quantityInlineJa) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-[0.35em] gap-y-0.5 text-[11px] text-white/80">
      {segments.map((seg, i) => (
        <Fragment key={`${seg}-${i}`}>
          {i > 0 ? (
            <span className="select-none text-white/40" aria-hidden>
              ·
            </span>
          ) : null}
          <span className="min-w-0 break-words">{seg}</span>
        </Fragment>
      ))}
      {quantityInlineJa ? (
        <>
          {segments.length > 0 ? (
            <span className="select-none text-white/40" aria-hidden>
              ·
            </span>
          ) : null}
          <span className="shrink-0">{quantityInlineJa}</span>
        </>
      ) : null}
    </div>
  );
}
