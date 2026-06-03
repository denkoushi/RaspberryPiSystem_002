import { useId } from 'react';

import { Input } from '../../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { InspectionDrawingCreateMetaChip } from './InspectionDrawingCreateMetaChip';
import {
  inspectionDrawingCreateFlatMetaRowClassName,
  inspectionDrawingCreateMetaChipControlClassName,
  inspectionDrawingCreateMetaChipReadonlyValueClassName,
  inspectionDrawingCreateMetaChipSelectClassName
} from './inspectionDrawingKioskUi';
import { InspectionDrawingResourceCdSelect } from './InspectionDrawingResourceCdSelect';

import type { InspectionDrawingCreateMetadataRowProps } from './InspectionDrawingCreateMetadataRow';
import type { PartMeasurementProcessGroup, SelfInspectionMode } from '../types';

function processGroupDisplayLabel(processGroup: PartMeasurementProcessGroup | null | undefined): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

/** 作成/改版ヘッダー — meta-chip 列（dl のみ・CompactHeader / MetadataRow から利用） */
export function InspectionDrawingCreateMetaChipList({
  lineageLocked,
  fhincd,
  onFhincdChange,
  resourceCd,
  onResourceCdChange,
  resourceSelectOptions,
  resourceNameMap,
  processGroup,
  templateProcessGroup,
  templateName,
  onTemplateNameChange,
  selfInspectionMode,
  onSelfInspectionModeChange,
  selfInspectionFixedCount,
  onSelfInspectionFixedCountChange,
  contentReadOnly
}: Omit<
  InspectionDrawingCreateMetadataRowProps,
  'onDrawingFileChange' | 'templateVersion' | 'templateIsActive'
>) {
  const baseId = useId();
  const fhincdFieldId = `${baseId}-fhincd`;
  const templateNameFieldId = `${baseId}-template-name`;
  const selfInspectionModeFieldId = `${baseId}-self-inspection-mode`;
  const selfInspectionFixedCountFieldId = `${baseId}-self-inspection-fixed-count`;

  return (
    <dl
      data-testid="inspection-drawing-create-meta-row"
      className={inspectionDrawingCreateFlatMetaRowClassName}
    >
      {lineageLocked ? (
        <>
          <InspectionDrawingCreateMetaChip term="品番">
            <span className={inspectionDrawingCreateMetaChipReadonlyValueClassName}>{fhincd}</span>
          </InspectionDrawingCreateMetaChip>
          <InspectionDrawingCreateMetaChip term="資源">
            <span
              className={inspectionDrawingCreateMetaChipReadonlyValueClassName}
              title={resourceSelectOptions.find((o) => o.value === resourceCd)?.label}
            >
              {resourceSelectOptions.find((o) => o.value === resourceCd)?.label ??
                formatResourceCdWithJapaneseNames(resourceCd, resourceNameMap)}
            </span>
          </InspectionDrawingCreateMetaChip>
          <InspectionDrawingCreateMetaChip term="工程">
            <span className={inspectionDrawingCreateMetaChipReadonlyValueClassName}>
              {processGroupDisplayLabel(templateProcessGroup ?? processGroup)}
            </span>
          </InspectionDrawingCreateMetaChip>
        </>
      ) : (
        <>
          <InspectionDrawingCreateMetaChip term="品番" controlId={fhincdFieldId}>
            <Input
              id={fhincdFieldId}
              value={fhincd}
              onChange={(e) => onFhincdChange(e.target.value)}
              className={inspectionDrawingCreateMetaChipControlClassName}
              disabled={contentReadOnly}
            />
          </InspectionDrawingCreateMetaChip>
          <InspectionDrawingResourceCdSelect
            value={resourceCd}
            onChange={onResourceCdChange}
            options={resourceSelectOptions}
            emptyOptionLabel="選択"
            widthVariant="createChip"
            disabled={contentReadOnly}
          />
        </>
      )}
      <InspectionDrawingCreateMetaChip term="テンプレ" controlId={templateNameFieldId}>
        <Input
          id={templateNameFieldId}
          value={templateName}
          onChange={(e) => onTemplateNameChange(e.target.value)}
          className={inspectionDrawingCreateMetaChipControlClassName}
          disabled={contentReadOnly}
        />
      </InspectionDrawingCreateMetaChip>
      <InspectionDrawingCreateMetaChip term="検査数" controlId={selfInspectionModeFieldId}>
        <select
          id={selfInspectionModeFieldId}
          className={inspectionDrawingCreateMetaChipSelectClassName}
          value={selfInspectionMode}
          disabled={contentReadOnly}
          onChange={(e) => onSelfInspectionModeChange(e.target.value as SelfInspectionMode)}
        >
          <option value="full">全数</option>
          <option value="single">抜き取り1個</option>
          <option value="first_last">最初と最後</option>
          <option value="fixed_count">指定数</option>
        </select>
      </InspectionDrawingCreateMetaChip>
      {selfInspectionMode === 'fixed_count' ? (
        <InspectionDrawingCreateMetaChip term="指定数" controlId={selfInspectionFixedCountFieldId}>
          <Input
            id={selfInspectionFixedCountFieldId}
            type="number"
            min={1}
            step={1}
            value={selfInspectionFixedCount}
            disabled={contentReadOnly}
            onChange={(e) => onSelfInspectionFixedCountChange(e.target.value)}
            className={inspectionDrawingCreateMetaChipControlClassName}
          />
        </InspectionDrawingCreateMetaChip>
      ) : null}
    </dl>
  );
}
