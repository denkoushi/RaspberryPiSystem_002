import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import {
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingKioskToggleInactiveClass
} from './inspectionDrawingKioskUi';

import type { PartMeasurementProcessGroup } from '../types';

export type InspectionDrawingToolbarMode = 'place' | 'test';

type Props = {
  processGroup: PartMeasurementProcessGroup;
  onProcessGroupChange: (group: PartMeasurementProcessGroup) => void;
  mode: InspectionDrawingToolbarMode;
  onModeChange: (mode: InspectionDrawingToolbarMode) => void;
  hasDrawingImage: boolean;
  hasMeasurementPoints: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  saveBusy?: boolean;
};

export function InspectionDrawingCreateToolbar({
  processGroup,
  onProcessGroupChange,
  mode,
  onModeChange,
  hasDrawingImage,
  hasMeasurementPoints,
  onSave,
  saveDisabled = false,
  saveBusy = false
}: Props) {
  const toggleClass = (isActive: boolean) =>
    clsx(inspectionDrawingKioskToggleInactiveClass(isActive), inspectionDrawingKioskDisabledButtonClass);

  const placeDisabled = !hasDrawingImage;
  const testDisabled = !hasDrawingImage || !hasMeasurementPoints;
  const saveBlocked = saveDisabled || saveBusy || !onSave;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">工程</span>
      <Button
        type="button"
        variant="primary"
        aria-pressed={processGroup === 'cutting'}
        className={toggleClass(processGroup === 'cutting')}
        onClick={() => onProcessGroupChange('cutting')}
      >
        切削
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-pressed={processGroup === 'grinding'}
        className={toggleClass(processGroup === 'grinding')}
        onClick={() => onProcessGroupChange('grinding')}
      >
        研削
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" aria-hidden />

      <Button
        type="button"
        variant="primary"
        aria-pressed={mode === 'place'}
        className={toggleClass(mode === 'place')}
        disabled={placeDisabled}
        onClick={() => onModeChange('place')}
      >
        点を配置
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-pressed={mode === 'test'}
        className={toggleClass(mode === 'test')}
        disabled={testDisabled}
        onClick={() => onModeChange('test')}
      >
        テスト入力
      </Button>

      <Button
        type="button"
        variant="primary"
        className={inspectionDrawingKioskDisabledButtonClass}
        disabled={saveBlocked}
        onClick={onSave ? () => onSave() : undefined}
      >
        {saveBusy ? '保存中…' : '保存'}
      </Button>
    </div>
  );
}
