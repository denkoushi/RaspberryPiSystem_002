import { parseMeasurementNumber, statusForPoint } from './evaluateMeasurement';
import { toleranceBoundsFromPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

/** 測定点入力の正本状態（保存・ガイド・一覧表示で共有） */
export type MeasurementPointInputStatus =
  | 'empty'
  | 'ok'
  | 'ng'
  | 'tolerance_error'
  | 'invalid';

export const MEASUREMENT_POINT_INPUT_STATUS_LABEL: Record<MeasurementPointInputStatus, string> = {
  empty: '未入力',
  ok: 'OK',
  ng: 'NG',
  tolerance_error: '公差不備',
  invalid: '不正'
};

export function resolveMeasurementPointInputStatus(
  point: InspectionDrawingPoint
): MeasurementPointInputStatus {
  if (point.valueKind === 'judgement') {
    if (point.testValue.trim() === '') return 'empty';
    if (point.testValue === 'PASS') return 'ok';
    if (point.testValue === 'FAIL') return 'ng';
    return 'invalid';
  }
  const bounds = toleranceBoundsFromPoint(point);
  if ('error' in bounds) return 'tolerance_error';
  const parsed = parseMeasurementNumber(point.testValue);
  if (parsed === null) {
    return point.testValue.trim() === '' ? 'empty' : 'invalid';
  }
  const evaluated = statusForPoint(point.testValue, bounds.lowerLimit, bounds.upperLimit);
  if (evaluated === 'ok') return 'ok';
  if (evaluated === 'ng') return 'ng';
  return 'empty';
}
