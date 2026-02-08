import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import type { MouseEvent } from 'react';

type PowerAction = 'reboot' | 'poweroff';

type KioskPowerMenuModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (action: PowerAction) => void;
};

export function KioskPowerMenuModal({ isOpen, onClose, onSelect }: KioskPowerMenuModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="電源操作"
      onMouseDown={handleBackdropMouseDown}
    >
      <Card className="w-full max-w-md max-h-[calc(100vh-2rem)] my-4">
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">電源操作</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              title="閉じる"
              className="text-slate-500 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => onSelect('reboot')}
              className="flex-1 bg-slate-700 text-white hover:bg-slate-600"
            >
              再起動
            </Button>
            <Button
              type="button"
              onClick={() => onSelect('poweroff')}
              className="flex-1 bg-red-600 text-white hover:bg-red-700"
            >
              シャットダウン
            </Button>
          </div>
        </div>
      </Card>
    </div>,
    document.body
  );
}
