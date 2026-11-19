import type { PartMeasurementDrawingOcrCandidateDto, PartMeasurementDrawingOcrStatus } from '../types';

export type DrawingOcrCandidateState = {
  requestId: number;
  loading: boolean;
  status: PartMeasurementDrawingOcrStatus | null;
  candidates: PartMeasurementDrawingOcrCandidateDto[];
  error: string | null;
};

/**
 * 選んだ点の候補をまだ取りに行くべきか。一度でも応答（失敗・処理中・候補0件を含む）が返った点は送り直さない。
 * 位置や名前を変えたときは呼び出し側が状態を消してから取り直す。
 */
export function shouldRequestDrawingOcrCandidates(current: DrawingOcrCandidateState | undefined): boolean {
  return current === undefined;
}
