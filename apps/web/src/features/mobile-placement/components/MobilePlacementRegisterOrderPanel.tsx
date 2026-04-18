import clsx from 'clsx';

import { MP_PLACEHOLDER_ORDER } from '../constants';
import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

import { IconScanButton } from './IconScanButton';

import type { OrderPlacementBranchDto } from '../../../api/client';
import type { OrderPlacementPageIntent } from '../shelfSelection';

export type MobilePlacementRegisterOrderPanelProps = {
  orderBarcode: string;
  onOrderBarcodeChange: (v: string) => void;
  onOrderScan: () => void;
  orderPlacementIntent: OrderPlacementPageIntent;
  onOrderPlacementIntentChange: (v: OrderPlacementPageIntent) => void;
  branches: OrderPlacementBranchDto[];
  branchesLoading: boolean;
  branchesError: boolean;
  onRetryBranches: () => void;
  selectedBranchId: string | null;
  onSelectBranchId: (id: string) => void;
  suggestedNextBranchNo: number | null;
  registerSubmitting: boolean;
  registerDisabled: boolean;
  onRegister: () => void;
};

/**
 * 配膳スマホ下半: 製造order・分配・登録確定（teal パネル）
 */
export function MobilePlacementRegisterOrderPanel(props: MobilePlacementRegisterOrderPanelProps) {
  return (
    <div className={mpKioskTheme.orderPanelRoot}>
      <div className={mpKioskTheme.orderInputRow}>
        <label className="sr-only" htmlFor="mp-order-scan">
          {MP_PLACEHOLDER_ORDER}
        </label>
        <input
          id="mp-order-scan"
          value={props.orderBarcode}
          onChange={(e) => props.onOrderBarcodeChange(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder={MP_PLACEHOLDER_ORDER}
          className={mpKioskTheme.orderInput}
        />
        <IconScanButton variant="order" title="スキャン" aria-label="製造orderをスキャン" onClick={props.onOrderScan} />
      </div>

      <div className={mpKioskTheme.orderIntentRow}>
        <button
          type="button"
          className={clsx(
            mpKioskTheme.orderIntentButton,
            props.orderPlacementIntent === 'create_new_branch' ? mpKioskTheme.orderIntentButtonOn : ''
          )}
          onClick={() => props.onOrderPlacementIntentChange('create_new_branch')}
        >
          新規配分
        </button>
        <button
          type="button"
          className={clsx(
            mpKioskTheme.orderIntentButton,
            props.orderPlacementIntent === 'move_existing' ? mpKioskTheme.orderIntentButtonOn : ''
          )}
          onClick={() => props.onOrderPlacementIntentChange('move_existing')}
        >
          既存配分
        </button>
        <button
          type="button"
          className={mpKioskTheme.orderSubmitButton}
          disabled={props.registerDisabled}
          onClick={props.onRegister}
        >
          {props.registerSubmitting ? '処理中…' : '確定'}
        </button>
      </div>

      {props.orderBarcode.trim().length > 0 ? (
        <div className="flex flex-col gap-2">
          {props.branchesLoading ? (
            <p className="text-[11px] text-neutral-400">分配一覧を読み込み中…</p>
          ) : props.branchesError ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-red-200">分配一覧の取得に失敗しました</p>
              <button
                type="button"
                className="rounded border-2 border-teal-500/50 px-2 py-0.5 text-[10px] font-bold text-teal-100"
                onClick={props.onRetryBranches}
              >
                再試行
              </button>
            </div>
          ) : props.orderPlacementIntent === 'create_new_branch' ? (
            <p className="text-[11px] text-neutral-300">
              次に作成される分配:{' '}
              <strong className="text-teal-200">
                分配{props.suggestedNextBranchNo != null ? props.suggestedNextBranchNo : '—'}
              </strong>
            </p>
          ) : props.branches.length === 0 ? (
            <p className="text-[11px] text-amber-200/90">
              この製造orderにはまだ分配がありません。先に「新規配分」で登録してください。
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className={mpKioskTheme.branchPickLabel}>分配を選択</p>
              <div className={mpKioskTheme.branchChipWrap}>
                {props.branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={clsx(
                      mpKioskTheme.branchChipButton,
                      props.selectedBranchId === b.id ? mpKioskTheme.branchChipButtonOn : ''
                    )}
                    onClick={() => props.onSelectBranchId(b.id)}
                  >
                    <span
                      className={clsx(
                        mpKioskTheme.branchChipSub,
                        props.selectedBranchId === b.id ? mpKioskTheme.branchChipSubOn : ''
                      )}
                    >
                      分配{b.branchNo}
                    </span>
                    <span className={mpKioskTheme.branchChipMain}>{b.shelfCodeRaw}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
