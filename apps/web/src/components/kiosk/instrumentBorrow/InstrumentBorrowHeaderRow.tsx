import type { ReactNode } from 'react';

export type InstrumentBorrowHeaderRowProps = {
  title: string;
  /** NFC / バリデーションなどの一行メッセージ（null のときはレイアウト用に空枠） */
  statusMessage: string | null;
  /** 点検項目が取得できたときの NG ボタンなど */
  trailing?: ReactNode;
};

/**
 * カード内タイトル行。ステータスは flex で伸長し、末尾アクション（NG）とバランスを取る。
 */
export function InstrumentBorrowHeaderRow({ title, statusMessage, trailing }: InstrumentBorrowHeaderRowProps) {
  return (
    <>
      <h2 className="shrink-0 text-xl font-bold text-slate-900">{title}</h2>
      <p className="min-w-[200px] flex-1 text-[13px] font-semibold leading-snug text-slate-700">
        {statusMessage ?? ''}
      </p>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </>
  );
}
