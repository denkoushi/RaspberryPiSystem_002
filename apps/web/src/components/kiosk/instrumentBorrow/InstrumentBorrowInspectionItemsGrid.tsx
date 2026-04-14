import type { ReactNode } from 'react';

export type InstrumentBorrowInspectionItemsGridProps = {
  children: ReactNode;
};

/**
 * 点検項目カードをプレビューに合わせた 2 列グリッドで並べる（狭い幅では 1 列）。
 */
export function InstrumentBorrowInspectionItemsGrid({ children }: InstrumentBorrowInspectionItemsGridProps) {
  return <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>;
}
