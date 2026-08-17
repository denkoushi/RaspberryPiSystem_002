import { useRef } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import { TorqueTrainingAdminProgramPanel } from './TorqueTrainingAdminProgramPanel';
import { TorqueTrainingAdminResultsPanel } from './TorqueTrainingAdminResultsPanel';

import type { TorqueTrainingAdminController } from './useTorqueTrainingAdminController';

export type TorqueTrainingAdminDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  controller: TorqueTrainingAdminController;
};

export function TorqueTrainingAdminDialog({
  isOpen,
  onClose,
  controller
}: TorqueTrainingAdminDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="訓練設定（ADMIN）"
      titleClassName="sr-only"
      closeOnEsc
      closeOnBackdrop={false}
      initialFocusRef={closeButtonRef}
      size="lg"
      overlayZIndex={80}
      className="!my-0 flex h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] flex-col overflow-hidden !rounded-lg !border !border-white/20 !bg-slate-950 !p-0 !text-white !shadow-none"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/15 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">訓練設定（ADMIN）</h2>
          <p className="text-xs text-white/60">訓練メニューと完了実績を管理します。</p>
        </div>
        <Button
          ref={closeButtonRef}
          type="button"
          variant="ghostOnDark"
          className="ml-auto min-h-11 shrink-0 px-3"
          onClick={onClose}
        >
          閉じる
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {controller.error ? (
          <p className="mb-3 rounded border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm text-red-100" role="alert">
            {controller.error}
          </p>
        ) : null}
        {controller.message ? (
          <p className="mb-3 rounded border border-emerald-300/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100" role="status">
            {controller.message}
          </p>
        ) : null}

        <div className="mb-3 flex shrink-0 flex-wrap gap-2" role="tablist" aria-label="訓練管理">
          <Button
            type="button"
            role="tab"
            aria-selected={controller.adminTab === 'programs'}
            variant={controller.adminTab === 'programs' ? 'primary' : 'ghostOnDark'}
            onClick={() => controller.setAdminTab('programs')}
          >
            訓練メニュー
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={controller.adminTab === 'results'}
            variant={controller.adminTab === 'results' ? 'primary' : 'ghostOnDark'}
            onClick={() => controller.setAdminTab('results')}
          >
            訓練実績
          </Button>
        </div>

        <div
          role="tabpanel"
          aria-label={controller.adminTab === 'programs' ? '訓練メニュー設定' : '訓練実績一覧'}
          className="min-h-0 flex-1"
        >
          {controller.adminTab === 'programs' ? (
            <TorqueTrainingAdminProgramPanel controller={controller} />
          ) : (
            <TorqueTrainingAdminResultsPanel controller={controller} />
          )}
        </div>
      </div>
    </Dialog>
  );
}
