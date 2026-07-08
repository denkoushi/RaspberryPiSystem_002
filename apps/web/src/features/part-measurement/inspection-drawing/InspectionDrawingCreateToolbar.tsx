import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../../components/ui/Button';

import {
  INSPECTION_DRAWING_CREATE_SAVE_STATUS_LABEL,
  type InspectionDrawingCreateSaveStatus
} from './inspectionDrawingCreateDraft';
import {
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingKioskToggleInactiveClass
} from './inspectionDrawingKioskUi';

import type { PartMeasurementProcessGroup } from '../types';

export type InspectionDrawingToolbarMode = 'place' | 'test' | 'guidedTrial';

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
  saveStatus?: InspectionDrawingCreateSaveStatus;
  /** 編集時は系譜キー（品番・工程）を変えられないため非表示 */
  showProcessGroup?: boolean;
  /** 指定時は保存ボタン右に戻るリンクを表示 */
  returnTo?: string;
  /** `returnTo` とセットで表示文言を渡す（例: 順位ボード / 一覧へ戻る） */
  returnLabel?: string;
  /** 保存済みテンプレートの帳票プレビュー（新しいタブ）。未保存変更は反映されない */
  savedPrintPath?: string;
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
  saveBusy = false,
  saveStatus,
  showProcessGroup = true,
  returnTo,
  returnLabel,
  savedPrintPath
}: Props) {
  const toggleClass = (isActive: boolean) =>
    clsx(inspectionDrawingKioskToggleInactiveClass(isActive), inspectionDrawingKioskDisabledButtonClass);

  const placeDisabled = !hasDrawingImage;
  const testDisabled = !hasDrawingImage || !hasMeasurementPoints;
  const guidedTrialDisabled = testDisabled;
  const saveBlocked = saveDisabled || saveBusy || !onSave;
  const saveStatusClassName = clsx(
    'inline-flex min-h-9 shrink-0 items-center px-1 text-[0.9rem] font-semibold',
    saveStatus === 'dirty' && 'text-amber-100',
    saveStatus === 'blocked' && 'text-white/65',
    saveStatus === 'saved' && 'text-emerald-100',
    saveStatus === 'saving' && 'text-cyan-100',
    saveStatus === 'read_only' && 'text-sky-100'
  );

  return (
    <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
      {showProcessGroup ? (
        <>
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
        </>
      ) : null}

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
        className={inspectionDrawingKioskDisabledButtonClass}
        disabled={saveBlocked}
        onClick={onSave ? () => onSave() : undefined}
      >
        {saveBusy ? '保存中…' : '保存'}
      </Button>

      {saveStatus ? (
        <span className={saveStatusClassName} aria-live="polite">
          {INSPECTION_DRAWING_CREATE_SAVE_STATUS_LABEL[saveStatus]}
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
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
          aria-pressed={mode === 'guidedTrial'}
          className={toggleClass(mode === 'guidedTrial')}
          disabled={guidedTrialDisabled}
          onClick={() => onModeChange('guidedTrial')}
        >
          ガイド試行
        </Button>

        {savedPrintPath ? (
          <Link
            to={savedPrintPath}
            target="_blank"
            rel="noopener noreferrer"
            title="未保存の変更は反映されません"
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1rem]')}
          >
            保存済み帳票
          </Link>
        ) : null}

        {returnTo && returnLabel ? (
          <Link to={returnTo} className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1rem]')}>
            {returnLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
