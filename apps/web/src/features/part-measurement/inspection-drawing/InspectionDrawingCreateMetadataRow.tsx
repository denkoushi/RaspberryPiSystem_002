import { InspectionDrawingCreateDrawingFileControl } from './InspectionDrawingCreateDrawingFileControl';
import { InspectionDrawingCreateMetaChipList } from './InspectionDrawingCreateMetaChipList';
import { InspectionDrawingCreateVersionBadge } from './InspectionDrawingCreateVersionBadge';

import type { InspectionDrawingResourceCdSelectOption } from './InspectionDrawingResourceCdSelect';
import type { PartMeasurementProcessGroup, SelfInspectionMode } from '../types';

export type InspectionDrawingCreateMetadataRowProps = {
  lineageLocked: boolean;
  fhincd: string;
  onFhincdChange: (value: string) => void;
  resourceCd: string;
  onResourceCdChange: (value: string) => void;
  resourceCds?: string[];
  onResourceCdsChange?: (values: string[]) => void;
  resourceSelectOptions: ReadonlyArray<InspectionDrawingResourceCdSelectOption>;
  resourceNameMap: Readonly<Record<string, string[]>>;
  processGroup: PartMeasurementProcessGroup;
  templateProcessGroup?: PartMeasurementProcessGroup | null;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  selfInspectionMode: SelfInspectionMode;
  onSelfInspectionModeChange: (mode: SelfInspectionMode) => void;
  selfInspectionFixedCount: string;
  onSelfInspectionFixedCountChange: (value: string) => void;
  contentReadOnly: boolean;
  onDrawingFileChange: (file: File | null) => void;
  templateVersion?: number;
  templateIsActive?: boolean;
};

/**
 * 作成/改版メタデータ — 内部部品のファサード（fragment）。
 * 本番作成画面は InspectionDrawingCreateCompactHeader を使用する。
 */
export function InspectionDrawingCreateMetadataRow(props: InspectionDrawingCreateMetadataRowProps) {
  const showVersionBadge = props.templateVersion != null && props.templateIsActive != null;

  return (
    <>
      <InspectionDrawingCreateMetaChipList {...props} />
      {showVersionBadge ? (
        <InspectionDrawingCreateVersionBadge
          version={props.templateVersion!}
          isActive={props.templateIsActive!}
        />
      ) : null}
      <InspectionDrawingCreateDrawingFileControl
        contentReadOnly={props.contentReadOnly}
        onDrawingFileChange={props.onDrawingFileChange}
      />
    </>
  );
}
