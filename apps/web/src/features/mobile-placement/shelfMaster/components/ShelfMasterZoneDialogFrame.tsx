import clsx from 'clsx';

import { Dialog } from '../../../../components/ui/Dialog';
import { DIALOG_MAX_HEIGHT } from '../../../../constants/viewportLayout';
import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { ReactNode } from 'react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  overlayZIndex?: number;
  loading?: boolean;
  map: ReactNode;
  dock: ReactNode;
};

/**
 * 棚マスタ区画 Dialog のレイアウト専用シェル（寸法・地図/ドック分割・スクロール境界）。
 * 業務ロジック・手順ゲートは呼び出し側に残す。
 */
export function ShelfMasterZoneDialogFrame({
  isOpen,
  onClose,
  title,
  overlayZIndex = 80,
  loading = false,
  map,
  dock
}: Props) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      titleClassName={shelfMasterTheme.dialogTitle}
      size="lg"
      overlayZIndex={overlayZIndex}
      className={clsx(DIALOG_MAX_HEIGHT, shelfMasterTheme.dialogPanel)}
    >
      <div className={shelfMasterTheme.dialogBody}>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">読み込み中…</p>
        ) : (
          <>
            <div className={shelfMasterTheme.dialogMapPane}>{map}</div>
            <div className={shelfMasterTheme.dialogDockPane}>{dock}</div>
          </>
        )}
      </div>
    </Dialog>
  );
}
