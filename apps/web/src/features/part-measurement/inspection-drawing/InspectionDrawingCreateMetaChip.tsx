import {
  inspectionDrawingCreateMetaChipClassName,
  inspectionDrawingCreateMetaChipTermClassName,
  inspectionDrawingCreateMetaChipValueClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingSopTargetProps } from './inspectionDrawingSopAnnotations';
import type { ReactNode } from 'react';

type Props = {
  term: string;
  children: ReactNode;
  /** フォームコントロール用 — dt を label htmlFor にし、子要素に同 id を付与する */
  controlId?: string;
  annotationProps?: InspectionDrawingSopTargetProps;
};

/** 作成/改版ヘッダー — ラベル + 値のコンパクト chip（正本 HTML の meta-chip） */
export function InspectionDrawingCreateMetaChip({ term, children, controlId, annotationProps }: Props) {
  return (
    <div
      {...annotationProps}
      className={inspectionDrawingCreateMetaChipClassName}
      data-testid="inspection-drawing-create-meta-chip"
      data-chip-term={term}
    >
      <dt className={inspectionDrawingCreateMetaChipTermClassName}>
        {controlId ? (
          <label htmlFor={controlId} className="cursor-pointer">
            {term}
          </label>
        ) : (
          term
        )}
      </dt>
      <dd className={inspectionDrawingCreateMetaChipValueClassName}>{children}</dd>
    </div>
  );
}
