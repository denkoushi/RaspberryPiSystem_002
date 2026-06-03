import {
  PART_MEASUREMENT_DRAWING_FILE_ACCEPT,
  PART_MEASUREMENT_DRAWING_FILE_LABEL
} from '../partMeasurementDrawingFileInput';

import {
  inspectionDrawingCreateFileInputClassName,
  inspectionDrawingCreateFileLabelClassName,
  inspectionDrawingCreateFlatBandItemClassName
} from './inspectionDrawingKioskUi';

type Props = {
  contentReadOnly: boolean;
  onDrawingFileChange: (file: File | null) => void;
};

/** 作成/改版ヘッダー — 図面ファイル入力（band 直下） */
export function InspectionDrawingCreateDrawingFileControl({ contentReadOnly, onDrawingFileChange }: Props) {
  return (
    <label
      data-testid="inspection-drawing-create-drawing-file"
      className={`${inspectionDrawingCreateFileLabelClassName} ${inspectionDrawingCreateFlatBandItemClassName}`}
    >
      <span>図面</span>
      <input
        type="file"
        accept={PART_MEASUREMENT_DRAWING_FILE_ACCEPT}
        className={inspectionDrawingCreateFileInputClassName}
        disabled={contentReadOnly}
        aria-label={PART_MEASUREMENT_DRAWING_FILE_LABEL}
        onChange={(e) => onDrawingFileChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
