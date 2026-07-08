import { Button } from '../../../components/ui/Button';

import {
  inspectionDrawingCanvasZoomButtonClassName,
  inspectionDrawingCanvasZoomControlsClassName
} from './inspectionDrawingKioskUi';

type Props = {
  enabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  onResetZoom?: () => void;
  /** 指定時: ネイティブ button + 親渡しクラス（Button/ghostOnDark を通さない） */
  getButtonClassName?: (disabled: boolean) => string;
};

type ZoomAction = {
  label: string;
  symbol: string;
  onClick: () => void;
};

function CustomClassZoomButton({
  action,
  enabled,
  getButtonClassName
}: {
  action: ZoomAction;
  enabled: boolean;
  getButtonClassName: (disabled: boolean) => string;
}) {
  const disabled = !enabled;
  return (
    <button
      type="button"
      aria-label={action.label}
      title={action.label}
      disabled={disabled}
      className={getButtonClassName(disabled)}
      onClick={action.onClick}
    >
      {action.symbol}
    </button>
  );
}

function LegacyZoomButton({
  action,
  enabled
}: {
  action: ZoomAction;
  enabled: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghostOnDark"
      className={inspectionDrawingCanvasZoomButtonClassName}
      aria-label={action.label}
      title={action.label}
      disabled={!enabled}
      onClick={action.onClick}
    >
      {action.symbol}
    </Button>
  );
}

/**
 * ヘッダーバンド中央余白用の図面ズーム操作（記号のみ・倍率表示なし）。
 */
export function InspectionDrawingCanvasZoomControls({
  enabled,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResetZoom,
  getButtonClassName
}: Props) {
  const actions: ZoomAction[] = [
    { label: '縮小', symbol: '−', onClick: onZoomOut },
    ...(onResetZoom ? [{ label: '元サイズ', symbol: '100%', onClick: onResetZoom }] : []),
    { label: '拡大', symbol: '＋', onClick: onZoomIn },
    { label: '全面表示', symbol: '□', onClick: onFitToView }
  ];

  return (
    <div className={inspectionDrawingCanvasZoomControlsClassName}>
      {actions.map((action) =>
        getButtonClassName ? (
          <CustomClassZoomButton
            key={action.label}
            action={action}
            enabled={enabled}
            getButtonClassName={getButtonClassName}
          />
        ) : (
          <LegacyZoomButton key={action.label} action={action} enabled={enabled} />
        )
      )}
    </div>
  );
}
