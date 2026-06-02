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

/** 作成/編集画面右欄 — 測定点の名称・基準・公差（本番・開発プレビュー共通） */
export function InspectionDrawingPointSettingsPanel({
  point,
  disabled = false,
  onChange,
  onRemove
}: Props) {
  return (
    <div className={inspectionDrawingPointSettingPanelClassName}>
      <p className="text-[1.02rem] font-bold">測定点の設定（No.{point.markerNo}）</p>
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
          type="text"
          inputMode="decimal"
          value={point.nominalRaw}
          onChange={(e) => onChange({ nominalRaw: e.target.value })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-[1rem] font-semibold">
        下側公差（幅）
        <Input
          type="text"
          inputMode="decimal"
          value={point.lowerToleranceRaw}
          onChange={(e) => onChange({ lowerToleranceRaw: e.target.value })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <label className="grid gap-1 text-[1rem] font-semibold">
        上側公差（幅）
        <Input
          type="text"
          inputMode="decimal"
          value={point.upperToleranceRaw}
          onChange={(e) => onChange({ upperToleranceRaw: e.target.value })}
          className={inspectionDrawingPointSettingInputClassName}
          disabled={disabled}
        />
      </label>
      <p className="text-xs text-white/55">合格範囲は「基準値 − 下側」〜「基準値 ＋ 上側」です。</p>
      {onRemove ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRemove}>
          この点を削除
        </Button>
      ) : null}
    </div>
  );
}
