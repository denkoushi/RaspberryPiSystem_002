import { Button } from '../../../components/ui/Button';

import { ActualSlipVerifyColumn } from './ActualSlipVerifyColumn';
import { SlipBlockColumn } from './SlipBlockColumn';

import type { MobilePlacementVerifySectionProps } from './mobile-placement-verify-section.types';

type PanelProps = MobilePlacementVerifySectionProps & {
  onCollapse: () => void;
};

/**
 * 照合エリア展開時: 移動票・現品票の2列 + 照合 + OK/NG + 閉じる
 * （折りたたみ状態は MobilePlacementVerifySection が担当）
 */
export function MobilePlacementVerifyExpandedPanel(props: PanelProps) {
  return (
    <div className="flex shrink-0 flex-col border-b border-white/25 p-2">
      <div className="grid grid-cols-2 gap-2 gap-x-2.5">
        <SlipBlockColumn
          variant="transfer"
          manufacturingOrderField={{
            id: 'mp-slip-transfer-order',
            value: props.transferOrder,
            onChange: props.onChangeTransferOrder,
            onScan: props.onScanTransferOrder
          }}
          partNumberField={{
            id: 'mp-slip-transfer-part',
            value: props.transferPart,
            onChange: props.onChangeTransferPart,
            onScan: props.onScanTransferPart
          }}
        />
        <ActualSlipVerifyColumn
          manufacturingOrderField={{
            id: 'mp-slip-actual-order',
            value: props.actualOrder,
            onChange: props.onChangeActualOrder,
            onScan: props.onScanActualOrder
          }}
          fseibanField={{
            id: 'mp-slip-actual-fseiban',
            value: props.actualFseiban,
            onChange: props.onChangeActualFseiban
          }}
          partNumberField={{
            id: 'mp-slip-actual-part',
            value: props.actualPart,
            onChange: props.onChangeActualPart,
            onScan: props.onScanActualPart
          }}
          onImageOcr={props.onPickActualSlipImage}
          imageOcrBusy={props.actualSlipImageOcrBusy}
          ocrFeedback={props.actualSlipOcrFeedback}
        />
      </div>
      <div className="mt-2 flex flex-col items-center gap-2">
        <Button
          type="button"
          variant="ghostOnDark"
          className="text-xs !text-white"
          disabled={props.slipVerifying}
          onClick={props.onVerify}
        >
          {props.slipVerifying ? '…' : '照合'}
        </Button>
        {props.slipResult === 'ok' ? (
          <span className="text-5xl font-bold text-emerald-200" role="status">
            OK
          </span>
        ) : null}
        {props.slipResult === 'ng' ? (
          <span className="text-5xl font-bold text-red-300" role="alert">
            NG
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghostOnDark"
          className="text-[10px] !text-slate-400"
          onClick={props.onCollapse}
        >
          閉じる
        </Button>
      </div>
    </div>
  );
}
