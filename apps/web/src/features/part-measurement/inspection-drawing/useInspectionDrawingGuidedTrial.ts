import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyGuidedTrialValue,
  fingerprintGuidedTrialPoints,
  resolveGuidedTrialInitialTarget,
  resolveGuidedTrialResumeTarget,
  type GuidedTrialFocusRequest,
  type GuidedTrialValueCommitPayload
} from './inspectionDrawingGuidedTrial';

import type { InspectionDrawingPoint } from './types';

type Args = {
  enabled: boolean;
  points: InspectionDrawingPoint[];
  onPointsChange: (points: InspectionDrawingPoint[]) => void;
  selectedPointId: string | null;
  onSelectPointId: (pointId: string | null) => void;
  hasDrawingReady: boolean;
  onZoomLevel: (zoom: number) => void;
  canvasZoom: number;
};

export function useInspectionDrawingGuidedTrial({
  enabled,
  points,
  onPointsChange,
  onSelectPointId,
  hasDrawingReady,
  onZoomLevel
}: Args) {
  const [focusRequest, setFocusRequest] = useState<GuidedTrialFocusRequest | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const requestIdRef = useRef(1);
  const primedRef = useRef(false);
  const pointsFingerprint = fingerprintGuidedTrialPoints(points);

  const trialReady = enabled && hasDrawingReady && points.length > 0;

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const resetTrialState = useCallback(() => {
    primedRef.current = false;
    setFocusRequest(null);
    setHint(null);
  }, []);

  useEffect(() => {
    resetTrialState();
  }, [pointsFingerprint, resetTrialState]);

  useEffect(() => {
    if (!enabled) {
      resetTrialState();
    }
  }, [enabled, resetTrialState]);

  const applyFocusTarget = useCallback(
    (target: { pointId: string; zoom: number; focusRequest: GuidedTrialFocusRequest }) => {
      onZoomLevel(target.zoom);
      setFocusRequest(target.focusRequest);
      onSelectPointId(target.pointId);
      setHint(null);
    },
    [onSelectPointId, onZoomLevel]
  );

  useEffect(() => {
    if (!trialReady || primedRef.current) return;
    const target = resolveGuidedTrialInitialTarget(points, nextRequestId());
    primedRef.current = true;
    if (target) {
      applyFocusTarget(target);
    } else {
      setHint('すべての測定点が OK です。');
    }
  }, [applyFocusTarget, nextRequestId, points, trialReady]);

  const handleManualSelect = useCallback(
    (pointId: string) => {
      onSelectPointId(pointId);
      setHint('手動選択中です。「再開」で未完了の最小 No. へ戻れます。');
    },
    [onSelectPointId]
  );

  const resumeTrial = useCallback(() => {
    if (!trialReady) return;
    const target = resolveGuidedTrialResumeTarget(points, nextRequestId());
    if (!target) {
      setHint('再開できる未完了の測定点がありません。');
      setFocusRequest(null);
      return;
    }
    applyFocusTarget(target);
  }, [applyFocusTarget, nextRequestId, points, trialReady]);

  const handleCommitValue = useCallback(
    (commit: GuidedTrialValueCommitPayload) => {
      if (!trialReady) return;
      const result = applyGuidedTrialValue({
        points,
        commit,
        nextFocusRequestId: nextRequestId()
      });
      onPointsChange(result.points);
      if (result.kind === 'stay') {
        if (result.inputStatus === 'ng' || result.inputStatus === 'tolerance_error') {
          setHint('公差外のため次の測定点へは進みません。');
        } else if (result.inputStatus === 'invalid') {
          setHint('入力値を確認してください。');
        }
        return;
      }
      if (!result.next) {
        setHint('ガイド試行: すべての測定点が OK になりました（保存はされません）。');
        setFocusRequest(null);
        return;
      }
      applyFocusTarget(result.next);
    },
    [applyFocusTarget, nextRequestId, onPointsChange, points, trialReady]
  );

  const focusRequestForCanvas = useMemo(
    () => (enabled ? focusRequest : null),
    [enabled, focusRequest]
  );

  return {
    trialReady,
    focusRequest: focusRequestForCanvas,
    hint,
    handleManualSelect,
    resumeTrial,
    handleCommitValue,
    resetTrialState
  };
}
