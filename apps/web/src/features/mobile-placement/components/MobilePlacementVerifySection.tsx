import { Button } from '../../../components/ui/Button';

import { SlipBlockColumn } from './SlipBlockColumn';

export type MobilePlacementVerifySectionProps = {
  transferOrder: string;
  transferFhinmei: string;
  actualOrder: string;
  actualFhinmei: string;
  onChangeTransferOrder: (v: string) => void;
  onChangeTransferFhinmei: (v: string) => void;
  onChangeActualOrder: (v: string) => void;
  onChangeActualFhinmei: (v: string) => void;
  onScanTransferOrder: () => void;
  onScanTransferFhinmei: () => void;
  onScanActualOrder: () => void;
  onScanActualFhinmei: () => void;
  slipVerifying: boolean;
  slipResult: 'idle' | 'ok' | 'ng';
  onVerify: () => void;
};

/**
 * 上半: 移動票・現品票の照合（2列グリッド + 照合ボタン + OK/NG）
 */
export function MobilePlacementVerifySection(props: MobilePlacementVerifySectionProps) {
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
            id: 'mp-slip-transfer-fhinmei',
            value: props.transferFhinmei,
            onChange: props.onChangeTransferFhinmei,
            onScan: props.onScanTransferFhinmei
          }}
        />
        <SlipBlockColumn
          variant="actual"
          manufacturingOrderField={{
            id: 'mp-slip-actual-order',
            value: props.actualOrder,
            onChange: props.onChangeActualOrder,
            onScan: props.onScanActualOrder
          }}
          partNumberField={{
            id: 'mp-slip-actual-fhinmei',
            value: props.actualFhinmei,
            onChange: props.onChangeActualFhinmei,
            onScan: props.onScanActualFhinmei
          }}
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
      </div>
    </div>
  );
}
