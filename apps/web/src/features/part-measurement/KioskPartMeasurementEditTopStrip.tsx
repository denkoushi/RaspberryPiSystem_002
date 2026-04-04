import clsx from 'clsx';

import type { ReactNode } from 'react';

export type KioskPartMeasurementEditTopStripProps = {
  actions: ReactNode;
  meta?: ReactNode;
  className?: string;
};

/**
 * 部品測定編集の最上段: 操作ボタンとシートメタを同一帯に載せ、中央寄せで折り返す。
 */
export function KioskPartMeasurementEditTopStrip({
  actions,
  meta,
  className
}: KioskPartMeasurementEditTopStripProps) {
  return (
    <section
      aria-label="操作とシート概要"
      className={clsx(
        'flex shrink-0 justify-center rounded-xl border border-white/15 bg-slate-900/90 px-3 py-2 backdrop-blur-sm',
        className
      )}
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
        {meta != null ? <div className="min-w-0 max-w-full">{meta}</div> : null}
      </div>
    </section>
  );
}
