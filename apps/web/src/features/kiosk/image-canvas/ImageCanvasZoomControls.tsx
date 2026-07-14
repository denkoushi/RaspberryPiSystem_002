import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

export type ImageCanvasZoomControlsProps = {
  enabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  onResetZoom?: () => void;
  controlsClassName?: string;
  buttonClassName?: string;
  getButtonClassName?: (disabled: boolean) => string;
};

export function ImageCanvasZoomControls({
  enabled,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResetZoom,
  controlsClassName,
  buttonClassName,
  getButtonClassName
}: ImageCanvasZoomControlsProps) {
  const actions = [
    { label: '縮小', symbol: '−', onClick: onZoomOut },
    ...(onResetZoom ? [{ label: '元サイズ', symbol: '100%', onClick: onResetZoom }] : []),
    { label: '拡大', symbol: '＋', onClick: onZoomIn },
    { label: '全面表示', symbol: '□', onClick: onFitToView }
  ];
  return (
    <div className={clsx('flex items-center gap-0.5', controlsClassName)}>
      {actions.map((action) => {
        const disabled = !enabled;
        if (getButtonClassName) {
          return (
            <button key={action.label} type="button" aria-label={action.label} title={action.label} disabled={disabled} className={getButtonClassName(disabled)} onClick={action.onClick}>
              {action.symbol}
            </button>
          );
        }
        return (
          <Button key={action.label} type="button" variant="ghostOnDark" className={clsx('min-h-9 min-w-9 !px-2 !py-1 text-sm', buttonClassName)} aria-label={action.label} title={action.label} disabled={disabled} onClick={action.onClick}>
            {action.symbol}
          </Button>
        );
      })}
    </div>
  );
}
