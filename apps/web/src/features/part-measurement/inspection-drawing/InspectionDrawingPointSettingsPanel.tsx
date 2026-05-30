import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import {
  inspectionDrawingPointSettingInputClassName,
  inspectionDrawingPointSettingPanelClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingPoint } from './types';

type Props = {
  point: InspectionDrawingPoint;
  disabled?: boolean;
  onChange: (patch: Partial<InspectionDrawingPoint>) => void;
  onRemove?: () => void;
};

/** 作成/編集画面右欄 — 測定点の名称・基準・上下限（本番・開発プレビュー共通） */
export function InspectionDrawingPointSettingsPanel({
  point,
  disabled = false,
  onChange,
  onRemove
}: Props) {
  return (
    <div className={inspectionDrawingPointSettingPanelClassName}>
      <p className="text-[1.02rem] font-bold">測定点の設定</p>
      <label className="grid gap-1 text-[1rem] font-semibold">
        名称
        <Input
          value={point.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-[1rem] font-semibold">
        基準値
        <Input
          type="number"
          inputMode="decimal"
          value={point.nominal}
          onChange={(e) => onChange({ nominal: parseFloat(e.target.value) || 0 })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-[1rem] font-semibold">
        下限
        <Input
          type="number"
          inputMode="decimal"
          value={point.lower}
          onChange={(e) => onChange({ lower: parseFloat(e.target.value) || 0 })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-[1rem] font-semibold">
        上限
        <Input
          type="number"
          inputMode="decimal"
          value={point.upper}
          onChange={(e) => onChange({ upper: parseFloat(e.target.value) || 0 })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      {onRemove ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRemove}>
          この点を削除
        </Button>
      ) : null}
    </div>
  );
}
