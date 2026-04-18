import clsx from 'clsx';
import { useMemo } from 'react';

import { ViewfinderIcon } from '../icons/ViewfinderIcon';
import {
  filterStructuredShelvesByAreaLine,
  listUnstructuredShelves,
  type RegisteredShelfEntryDto
} from '../registeredShelves';
import { SHELF_AREA_OPTIONS, SHELF_LINE_OPTIONS } from '../shelfSelection/defaultShelfRegisterCatalog';
import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';
import { splitShelfCodeForDisplay } from '../ui/splitShelfCodeForDisplay';

import type { ShelfAreaId, ShelfLineId } from '../shelfSelection/shelfSelectionTypes';

export type MobilePlacementRegisterShelfPanelProps = {
  shelfCode: string;
  onSelectShelf: (code: string) => void;
  onOpenShelfRegister: () => void;
  onShelfQrScan: () => void;
  registeredShelves: RegisteredShelfEntryDto[];
  registeredShelvesLoading: boolean;
  registeredShelvesError: boolean;
  onRetryRegisteredShelves: () => void;
  areaId: ShelfAreaId | null;
  lineId: ShelfLineId | null;
  onAreaChange: (id: ShelfAreaId) => void;
  onLineChange: (id: ShelfLineId) => void;
};

/**
 * 配膳スマホ下半: 登録済み棚の絞り込み・選択（amber パネル）
 */
export function MobilePlacementRegisterShelfPanel(props: MobilePlacementRegisterShelfPanelProps) {
  const unstructured = useMemo(() => listUnstructuredShelves(props.registeredShelves), [props.registeredShelves]);

  const filteredStructured = useMemo(
    () =>
      props.areaId != null && props.lineId != null
        ? [...filterStructuredShelvesByAreaLine(props.registeredShelves, props.areaId, props.lineId)].sort(
            (a, b) => (a.slot ?? 0) - (b.slot ?? 0)
          )
        : [],
    [props.areaId, props.lineId, props.registeredShelves]
  );

  const filterReady = props.areaId !== null && props.lineId !== null;

  return (
    <div className={mpKioskTheme.shelfPanelRoot}>
      <div className={mpKioskTheme.shelfPanelHeaderRow}>
        <button
          type="button"
          className={mpKioskTheme.shelfQrButton}
          title="棚のQRコードをスキャンして棚番を入力"
          aria-label="棚をQRスキャン"
          onClick={props.onShelfQrScan}
        >
          <ViewfinderIcon className={mpKioskTheme.shelfQrIcon} />
        </button>
        <div
          className={mpKioskTheme.selectedShelfCode}
          aria-label={props.shelfCode ? `選択中の棚番 ${props.shelfCode}` : '棚番未選択'}
        >
          {props.shelfCode || '—'}
        </div>
        <button
          type="button"
          className={mpKioskTheme.shelfRegisterAddButton}
          title="棚番を新規登録（エリア→列→番号）"
          aria-label="棚番を新規登録"
          onClick={props.onOpenShelfRegister}
        >
          +
        </button>
      </div>

      <div className={mpKioskTheme.shelfAxisGrid}>
        {SHELF_AREA_OPTIONS.map((o) => (
          <button
            key={`a-${o.id}`}
            type="button"
            className={clsx(
              mpKioskTheme.shelfAxisButtonBase,
              props.areaId === o.id ? mpKioskTheme.shelfAxisButtonOn : ''
            )}
            onClick={() => props.onAreaChange(o.id)}
          >
            {o.label}
          </button>
        ))}
        {SHELF_LINE_OPTIONS.map((o, i) => (
          <button
            key={`l-${o.id}`}
            type="button"
            className={clsx(
              mpKioskTheme.shelfAxisButtonBase,
              i === 0 ? mpKioskTheme.shelfAxisLineFirst : '',
              props.lineId === o.id ? mpKioskTheme.shelfAxisButtonOn : ''
            )}
            onClick={() => props.onLineChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className={mpKioskTheme.shelfListShell}>
        {props.registeredShelvesLoading ? (
          <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center text-sm text-neutral-500">
            登録済み棚を読み込み中…
          </div>
        ) : props.registeredShelvesError ? (
          <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
            <p className="text-sm text-red-200">登録済み棚の取得に失敗しました</p>
            <button
              type="button"
              className="rounded-md border-2 border-amber-500/60 px-3 py-1.5 text-xs font-bold text-amber-100 active:bg-amber-500/15"
              onClick={props.onRetryRegisteredShelves}
            >
              再試行
            </button>
          </div>
        ) : !filterReady ? (
          <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center px-2 text-center text-sm text-neutral-500">
            エリアと列の両方をタップすると、該当する登録棚が表示されます。
          </div>
        ) : (
          <>
            {filteredStructured.length === 0 ? (
              <p className="mb-2 text-center text-xs text-neutral-500">この組み合わせの登録棚はありません</p>
            ) : (
              <div className={mpKioskTheme.shelfChipGrid}>
                {filteredStructured.map((s) => {
                  const { prefix, num } = splitShelfCodeForDisplay(s.shelfCodeRaw);
                  return (
                    <button
                      key={s.shelfCodeRaw}
                      type="button"
                      className={clsx(
                        mpKioskTheme.shelfChipButton,
                        props.shelfCode === s.shelfCodeRaw ? mpKioskTheme.shelfChipButtonOn : ''
                      )}
                      onClick={() => props.onSelectShelf(s.shelfCodeRaw)}
                    >
                      {num ? (
                        <>
                          <span className={mpKioskTheme.shelfChipPrefix}>{prefix}</span>
                          <span className={mpKioskTheme.shelfChipNum}>{num}</span>
                        </>
                      ) : (
                        <span className={mpKioskTheme.shelfChipNum}>{prefix}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {unstructured.length > 0 ? (
              <div className="mt-2 border-t border-dashed border-white/20 pt-2">
                <p className={mpKioskTheme.shelfUnstructuredLabel}>その他の登録棚</p>
                <div className="flex flex-wrap gap-1.5">
                  {unstructured.map((s) => (
                    <button
                      key={s.shelfCodeRaw}
                      type="button"
                      className={clsx(
                        mpKioskTheme.shelfUnstructuredChip,
                        props.shelfCode === s.shelfCodeRaw ? mpKioskTheme.shelfUnstructuredChipOn : 'text-neutral-200'
                      )}
                      onClick={() => props.onSelectShelf(s.shelfCodeRaw)}
                    >
                      {s.shelfCodeRaw}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
