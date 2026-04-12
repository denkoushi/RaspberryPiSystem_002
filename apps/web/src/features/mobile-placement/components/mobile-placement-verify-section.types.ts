import type { ActualSlipOcrFeedback } from '../actual-slip-ocr-feedback';

/**
 * 照合セクション（上半）の入力・スキャン・照合実行の契約。
 * UI（折りたたみ／展開）は MobilePlacementVerifySection が保持。
 */
export type MobilePlacementVerifySectionProps = {
  transferOrder: string;
  transferPart: string;
  actualOrder: string;
  actualFseiban: string;
  actualPart: string;
  onChangeTransferOrder: (v: string) => void;
  onChangeTransferPart: (v: string) => void;
  onChangeActualOrder: (v: string) => void;
  onChangeActualFseiban: (v: string) => void;
  onChangeActualPart: (v: string) => void;
  onScanTransferOrder: () => void;
  onScanTransferPart: () => void;
  onScanActualOrder: () => void;
  onScanActualPart: () => void;
  onPickActualSlipImage: () => void;
  actualSlipImageOcrBusy: boolean;
  actualSlipOcrFeedback: ActualSlipOcrFeedback;
  slipVerifying: boolean;
  slipResult: 'idle' | 'ok' | 'ng';
  onVerify: () => void;
  /** 初回マウント時に展開した状態にする（既定 false＝閉じる） */
  defaultExpanded?: boolean;
};
