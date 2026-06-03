import { useId } from 'react';

import { Input } from '../../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  PART_MEASUREMENT_DRAWING_FILE_ACCEPT,
  PART_MEASUREMENT_DRAWING_FILE_LABEL
} from '../partMeasurementDrawingFileInput';

import { InspectionDrawingCreateMetaChip } from './InspectionDrawingCreateMetaChip';
import {
  inspectionDrawingCreateFileInputClassName,
  inspectionDrawingCreateFileLabelClassName,
  inspectionDrawingCreateMetaChipControlClassName,
  inspectionDrawingCreateMetaChipReadonlyValueClassName,
  inspectionDrawingCreateMetaChipSelectClassName,
  inspectionDrawingCreateMetaRowClassName,
  inspectionDrawingCreateVersionBadgeClassName
} from './inspectionDrawingKioskUi';
import { InspectionDrawingResourceCdSelect } from './InspectionDrawingResourceCdSelect';

import type { InspectionDrawingResourceCdSelectOption } from './InspectionDrawingResourceCdSelect';
import type { PartMeasurementProcessGroup, SelfInspectionMode } from '../types';

function processGroupDisplayLabel(processGroup: PartMeasurementProcessGroup | null | undefined): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

export type InspectionDrawingCreateMetadataRowProps = {
  lineageLocked: boolean;
  fhincd: string;
  onFhincdChange: (value: string) => void;
  resourceCd: string;
  onResourceCdChange: (value: string) => void;
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

/** 作成/改版ページ上部 — コンパクト meta-chip 行 + インライン図面ファイル */
export function InspectionDrawingCreateMetadataRow({
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
  contentReadOnly,
  onDrawingFileChange,
  templateVersion,
  templateIsActive
}: InspectionDrawingCreateMetadataRowProps) {
  const baseId = useId();
  const fhincdFieldId = `${baseId}-fhincd`;
  const templateNameFieldId = `${baseId}-template-name`;
  const selfInspectionModeFieldId = `${baseId}-self-inspection-mode`;
  const selfInspectionFixedCountFieldId = `${baseId}-self-inspection-fixed-count`;
  const showVersionBadge = templateVersion != null && templateIsActive != null;

  return (
    <>
      <dl className={inspectionDrawingCreateMetaRowClassName}>
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
      {showVersionBadge ? (
        <span className={inspectionDrawingCreateVersionBadgeClassName}>
          v{templateVersion} · {templateIsActive ? '有効' : '履歴'}
        </span>
      ) : null}
      <label className={inspectionDrawingCreateFileLabelClassName}>
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
    </>
  );
}
