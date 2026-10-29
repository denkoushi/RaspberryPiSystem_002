import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  moveOrderPlacementBranch,
  parseActualSlipImage,
  registerOrderPlacement,
  snapFseibanTokens,
  verifyMobilePlacementSlipMatch
} from '../../api/client';
import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE
} from '../barcode-scan/formatPresets';

import {
  buildOcrPreview,
  initialActualSlipOcrFeedback,
  type ActualSlipOcrFeedback
} from './actual-slip-ocr-feedback';
import { scanFseibanNative } from './haizenNative';
import { verifyLocalFirst } from './local-data/localFirstLookup';
import { mobileLocalDataStore } from './local-data/mobileLocalDataStore';
import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';
import { createSlipVerifyRecorder } from './verify-records/recordSlipVerify';

import type { MobilePlacementShelfRegisterRouteState, OrderPlacementPageIntent } from './shelfSelection';
import type { MobilePlacementScanField, MobilePlacementSlipResult } from './types';
import type { ActualSlipOcrResponse, MobilePlacementSlipMatchResponse } from '../../api/domains/mobile-placement';

/**
 * 配膳ページの状態と API 呼び出し（UI から分離してテスト・再利用しやすくする）
 */
export function useMobilePlacementPageState() {
  const queryClient = useQueryClient();
  const [verifyRecorder] = useState(createSlipVerifyRecorder);
  const [transferOrder, setTransferOrder] = useState('');
  const [transferPart, setTransferPart] = useState('');
  const [actualOrder, setActualOrder] = useState('');
  const [actualFseiban, setActualFseiban] = useState('');
  const [actualPart, setActualPart] = useState('');
  const [slipResult, setSlipResult] = useState<MobilePlacementSlipResult>('idle');
  const [slipDetails, setSlipDetails] = useState<MobilePlacementSlipMatchResponse | null>(null);
  const [slipVerifying, setSlipVerifying] = useState(false);
  const actualSlipOcrInFlight = useRef(false);
  const [actualSlipImageOcrBusy, setActualSlipImageOcrBusy] = useState(false);
  const [actualSlipOcrFeedback, setActualSlipOcrFeedback] = useState<ActualSlipOcrFeedback>(initialActualSlipOcrFeedback);

  const [shelfCode, setShelfCode] = useState('');
  const [orderBarcode, setOrderBarcode] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [orderPlacementIntent, setOrderPlacementIntent] = useState<OrderPlacementPageIntent>('create_new_branch');
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const [scanField, setScanField] = useState<MobilePlacementScanField>(null);

  useEffect(() => {
    setSelectedBranchId(null);
  }, [orderBarcode]);

  const scanFormats = useMemo(() => {
    if (scanField === 'shelf') {
      return BARCODE_FORMAT_PRESET_ALL_COMMON;
    }
    return BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE;
  }, [scanField]);

  const onScanSuccess = useCallback(
    (text: string) => {
      const v = text.trim();
      switch (scanField) {
        case 'shelf':
          setShelfCode(v);
          break;
        case 'order':
          setOrderBarcode(v);
          break;
        case 'transferOrder':
          if (/^[a-z]/i.test(v)) {
            setTransferPart(v);
          } else {
            if (transferOrder && transferOrder !== v) setTransferPart('');
            setTransferOrder(v);
          }
          break;
        case 'transferPart':
          setTransferPart(v);
          break;
        case 'actualOrder':
          setActualOrder(v);
          setActualSlipOcrFeedback(initialActualSlipOcrFeedback);
          break;
        case 'actualPart':
          setActualPart(v);
          setActualSlipOcrFeedback(initialActualSlipOcrFeedback);
          break;
        default:
          break;
      }
      setSlipResult('idle');
      setScanField(null);
    },
    [scanField, transferOrder]
  );

  const applyActualSlipOcrResponse = useCallback((res: ActualSlipOcrResponse) => {
    setSlipResult('idle');
    const preview = buildOcrPreview(res.ocrPreviewSafe ?? res.ocrText);
    const mo = res.manufacturingOrder10 ?? null;
    const fs = res.fseiban ?? null;
    if (mo) {
      setActualOrder(mo);
    } else if (fs) {
      setActualOrder('');
    }
    if (fs) {
      setActualFseiban(fs);
    }
    const snapFeedback = {
      fseibanRaw: res.fseibanRaw,
      fseibanMatch: res.fseibanMatch,
      fseibanCandidates: res.fseibanCandidates
    };
    if (mo || fs || res.fseibanCandidates.length > 0) {
      setActualSlipOcrFeedback({
        ...snapFeedback,
        status: 'success',
        manufacturingOrder10: mo,
        fseiban: fs,
        ocrPreview: preview,
        message: '読取結果を欄に反映しました。必要に応じて修正してください。',
        errorDetail: null
      });
    } else {
      setActualSlipOcrFeedback({
        ...snapFeedback,
        status: 'no_candidate',
        manufacturingOrder10: null,
        fseiban: null,
        ocrPreview: preview,
        message: '読取候補がありません。再撮影するか、手入力してください。',
        errorDetail: null
      });
    }
  }, []);

  const runActualSlipOcr = useCallback(async (
    read: () => Promise<ActualSlipOcrResponse | null>,
    resetBeforeReading: boolean
  ) => {
    if (actualSlipOcrInFlight.current) return;
    actualSlipOcrInFlight.current = true;
    setActualSlipImageOcrBusy(true);
    if (resetBeforeReading) {
      setSlipResult('idle');
      setActualSlipOcrFeedback(initialActualSlipOcrFeedback);
    }
    try {
      const res = await read();
      if (res) applyActualSlipOcrResponse(res);
    } catch (e: unknown) {
      const msg = isAxiosError(e)
        ? typeof e.response?.data?.message === 'string'
          ? e.response.data.message
          : e.message
        : e instanceof Error
          ? e.message
          : '読取に失敗しました';
      setActualSlipOcrFeedback({
        ...initialActualSlipOcrFeedback,
        status: 'error',
        manufacturingOrder10: null,
        fseiban: null,
        ocrPreview: null,
        message: '読取に失敗しました。通信または権限を確認してください。',
        errorDetail: msg
      });
      setSlipResult('idle');
    } finally {
      actualSlipOcrInFlight.current = false;
      setActualSlipImageOcrBusy(false);
    }
  }, [applyActualSlipOcrResponse]);

  const parseActualSlipImageFile = useCallback(
    (file: File) => runActualSlipOcr(() => parseActualSlipImage(file), true),
    [runActualSlipOcr]
  );

  const scanActualSlipNative = useCallback(() => runActualSlipOcr(async () => {
    const result = await scanFseibanNative();
    if (result.status === 'cancelled') return null;
    return await mobileLocalDataStore.snapNative(result.tokens, result.text) ?? snapFseibanTokens({ tokens: result.tokens, text: result.text });
  }, false), [runActualSlipOcr]);

  const linkLastVerifyRecord = useCallback((clientRecordId: string) => verifyRecorder.link({
    transferOrderBarcodeRaw: transferOrder, transferPartBarcodeRaw: transferPart,
    actualOrderBarcodeRaw: actualOrder, actualFseibanRaw: actualFseiban, actualPartBarcodeRaw: actualPart
  }, clientRecordId), [verifyRecorder, transferOrder, transferPart, actualOrder, actualFseiban, actualPart]);

  const runSlipVerify = useCallback(async () => {
    setSlipVerifying(true);
    setSlipResult('idle');
    setSlipDetails(null);
    const input = {
      transferOrderBarcodeRaw: transferOrder,
      transferPartBarcodeRaw: transferPart,
      actualOrderBarcodeRaw: actualOrder,
      actualFseibanRaw: actualFseiban,
      actualPartBarcodeRaw: actualPart
    };
    try {
      const res = await verifyLocalFirst(input, () => verifyMobilePlacementSlipMatch(input));
      setSlipDetails(res);
      setSlipResult(res.ok ? 'ok' : res.reason === 'order_not_found' || res.reason === 'transfer_not_found' || res.reason === 'part_required' ? 'not-found' : 'ng');
      await verifyRecorder.record(input, res).catch(() => console.warn('Verify record could not be saved'));
    } catch {
      setSlipResult('error');
      await verifyRecorder.record(input, 'error').catch(() => console.warn('Verify record could not be saved'));
    } finally {
      setSlipVerifying(false);
    }
  }, [verifyRecorder, transferOrder, transferPart, actualOrder, actualFseiban, actualPart]);

  const runRegister = useCallback(async () => {
    setRegisterError(null);
    setRegisterMessage(null);
    setRegisterSubmitting(true);
    try {
      if (orderPlacementIntent === 'move_existing') {
        if (selectedBranchId == null || selectedBranchId.length === 0) {
          setRegisterError('移動する分配枝を一覧から選んでください');
          return;
        }
        const res = await moveOrderPlacementBranch({
          branchStateId: selectedBranchId,
          shelfCodeRaw: shelfCode
        });
        setRegisterMessage(
          `分配${res.branchState.branchNo === 0 ? 'なし' : res.branchState.branchNo}を ${res.branchState.shelfCodeRaw} へ移動しました`
        );
        setSelectedBranchId(null);
      } else {
        const res = await registerOrderPlacement({
          shelfCodeRaw: shelfCode,
          manufacturingOrderBarcodeRaw: orderBarcode
        });
        setRegisterMessage(
          `分配${res.branchState.branchNo === 0 ? 'なし' : res.branchState.branchNo}を登録 ${res.event.id.slice(0, 8)}…`
        );
        setOrderBarcode('');
      }
      void queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
      void queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
    } catch (e: unknown) {
      const msg = isAxiosError(e)
        ? typeof e.response?.data?.message === 'string'
          ? e.response.data.message
          : e.message
        : e instanceof Error
          ? e.message
          : '登録に失敗しました';
      setRegisterError(msg);
    } finally {
      setRegisterSubmitting(false);
    }
  }, [orderPlacementIntent, orderBarcode, queryClient, selectedBranchId, shelfCode]);

  const registerDisabled =
    registerSubmitting ||
    shelfCode.trim().length === 0 ||
    orderBarcode.trim().length === 0 ||
    (orderPlacementIntent === 'move_existing' &&
      (selectedBranchId == null || selectedBranchId.length === 0));

  const selectShelf = useCallback((code: string) => {
    setShelfCode(code);
    setRegisterMessage(null);
  }, []);

  const resetSlipResult = useCallback(() => { setSlipResult('idle'); setSlipDetails(null); }, []);

  const resetActualSlipOcrFeedback = useCallback(
    () => setActualSlipOcrFeedback(initialActualSlipOcrFeedback),
    []
  );

  const buildShelfRegisterRouteState = useCallback(
    (): MobilePlacementShelfRegisterRouteState => ({
      transferOrder,
      transferPart,
      actualOrder,
      actualFseiban,
      actualPart,
      slipResult,
      shelfCode,
      orderBarcode,
      orderPlacementIntent,
      selectedBranchId
    }),
    [
      transferOrder,
      transferPart,
      actualOrder,
      actualFseiban,
      actualPart,
      slipResult,
      shelfCode,
      orderBarcode,
      orderPlacementIntent,
      selectedBranchId
    ]
  );

  const restoreShelfRegisterRouteState = useCallback((state: MobilePlacementShelfRegisterRouteState) => {
    setTransferOrder(state.transferOrder);
    setTransferPart(state.transferPart);
    setActualOrder(state.actualOrder);
    setActualFseiban(state.actualFseiban);
    setActualPart(state.actualPart);
    setSlipResult(state.slipResult);
    setShelfCode(state.shelfCode);
    setOrderBarcode(state.orderBarcode);
    setOrderPlacementIntent(state.orderPlacementIntent ?? 'create_new_branch');
    setSelectedBranchId(state.selectedBranchId ?? null);
    setRegisterMessage(null);
    setRegisterError(null);
    setScanField(null);
  }, []);

  return {
    transferOrder,
    setTransferOrder,
    transferPart,
    setTransferPart,
    actualOrder,
    setActualOrder,
    actualFseiban,
    setActualFseiban,
    actualPart,
    setActualPart,
    slipResult,
    slipDetails,
    resetSlipResult,
    buildShelfRegisterRouteState,
    restoreShelfRegisterRouteState,
    slipVerifying,
    runSlipVerify,
    linkLastVerifyRecord,
    shelfCode,
    selectShelf,
    orderBarcode,
    setOrderBarcode,
    registerSubmitting,
    registerMessage,
    registerError,
    registerDisabled,
    orderPlacementIntent,
    setOrderPlacementIntent,
    selectedBranchId,
    setSelectedBranchId,
    runRegister,
    scanField,
    setScanField,
    scanFormats,
    onScanSuccess,
    parseActualSlipImageFile,
    scanActualSlipNative,
    actualSlipImageOcrBusy,
    actualSlipOcrFeedback,
    resetActualSlipOcrFeedback
  };
}
