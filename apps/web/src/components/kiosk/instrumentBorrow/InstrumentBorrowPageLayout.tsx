import clsx from 'clsx';

import type { ReactNode } from 'react';

export type InstrumentBorrowPageLayoutProps = {
  /** 左上: タイトル行（タイトル・ステータス・NG など） */
  header: ReactNode;
  /** 左下: フォーム＋点検カード（スクロール可） */
  leftColumn: ReactNode;
  /** 右: 点検画像（上端〜下端まで縦方向に占有） */
  rightColumn: ReactNode;
  className?: string;
};

/**
 * 計測機器持出の 2 カラム＋ヘッダ行グリッド。
 * プレビュー HTML の `grid-template-columns: 5fr 8fr` / 右列 `row 1 / -1` に相当。
 */
export function InstrumentBorrowPageLayout({
  header,
  leftColumn,
  rightColumn,
  className
}: InstrumentBorrowPageLayoutProps) {
  return (
    <div
      className={clsx(
        'min-h-0 flex-1',
        'flex flex-col gap-4',
        'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:items-stretch lg:gap-4',
        className
      )}
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-4 gap-y-3 lg:col-start-1 lg:row-start-1 lg:self-start">
        {header}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto lg:col-start-1 lg:row-start-2">
        {leftColumn}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {rightColumn}
      </div>
    </div>
  );
}
