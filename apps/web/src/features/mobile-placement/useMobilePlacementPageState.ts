import { isAxiosError } from 'axios';
import { useCallback, useMemo, useState } from 'react';

import { parseActualSlipImage, registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../api/client';
import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL
} from '../barcode-scan/formatPresets';

import {
  buildOcrPreview,
  initialActualSlipOcrFeedback,
  type ActualSlipOcrFeedback
} from './actual-slip-ocr-feedback';

import type { MobilePlacementShelfRegisterRouteState } from './shelfSelection';
import type { MobilePlacementScanField, MobilePlacementSlipResult } from './types';

/**
 * 配膳ページの状態と API 呼び出し（UI から分離してテスト・再利用しやすくする）
 */
export function useMobilePlacementPageState() {
  const [transferOrder, setTransferOrder] = useState('');
  const [transferPart, setTransferPart] = useState('');
  const [actualOrder, setActualOrder] = useState('');
  const [actualFseiban, setActualFseiban] = useState('');
  const [actualPart, setActualPart] = useState('');
  const [slipResult, setSlipResult] = useState<MobilePlacementSlipResult>('idle');
  const [slipVerifying, setSlipVerifying] = useState(false);
  const [actualSlipImageOcrBusy, setActualSlipImageOcrBusy] = useState(false);
  const [actualSlipOcrFeedback, setActualSlipOcrFeedback] = useState<ActualSlipOcrFeedback>(initialActualSlipOcrFeedback);

  const [shelfCode, setShelfCode] = useState('');
  const [orderBarcode, setOrderBarcode] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [scanField, setScanField] = useState<MobilePlacementScanField>(null);

  const scanFormats = useMemo(() => {
    if (scanField === 'shelf') {
      return BARCODE_FORMAT_PRESET_ALL_COMMON;
    }
    return BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL;
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
          setTransferOrder(v);
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
    [scanField]
  );

  const parseActualSlipImageFile = useCallback(async (file: File) => {
    setActualSlipImageOcrBusy(true);
    setSlipResult('idle');
    setActualSlipOcrFeedback(initialActualSlipOcrFeedback);
    try {
      const res = await parseActualSlipImage(file);
      const preview = buildOcrPreview(res.ocrPreviewSafe ?? res.ocrText);
      const mo = res.manufacturingOrder10 ?? null;
      const fs = res.fseiban ?? null;
      if (mo) {
        setActualOrder(mo);
      }
      if (fs) {
        setActualFseiban(fs);
      }
      if (mo || fs) {
        setActualSlipOcrFeedback({
          status: 'success',
          manufacturingOrder10: mo,
          fseiban: fs,
          ocrPreview: preview,
          message: '読取結果を欄に反映しました。必要に応じて修正してください。',
          errorDetail: null
        });
      } else {
        setActualSlipOcrFeedback({
          status: 'no_candidate',
          manufacturingOrder10: null,
          fseiban: null,
          ocrPreview: preview,
          message: '読取候補がありません。再撮影するか、手入力してください。',
          errorDetail: null
        });
      }
    } catch (e: unknown) {
      const msg = isAxiosError(e)
        ? typeof e.response?.data?.message === 'string'
          ? e.response.data.message
          : e.message
        : e instanceof Error
          ? e.message
          : '読取に失敗しました';
      setActualSlipOcrFeedback({
        status: 'error',
        manufacturingOrder10: null,
        fseiban: null,
        ocrPreview: null,
        message: '読取に失敗しました。通信または権限を確認してください。',
        errorDetail: msg
      });
      setSlipResult('idle');
    } finally {
      setActualSlipImageOcrBusy(false);
    }
  }, []);

  const runSlipVerify = useCallback(async () => {
    setSlipVerifying(true);
    setSlipResult('idle');
    try {
      const res = await verifyMobilePlacementSlipMatch({
        transferOrderBarcodeRaw: transferOrder,
        transferPartBarcodeRaw: transferPart,
        actualOrderBarcodeRaw: actualOrder,
        actualFseibanRaw: actualFseiban,
        actualPartBarcodeRaw: actualPart
      });
      setSlipResult(res.ok ? 'ok' : 'ng');
    } catch {
      setSlipResult('ng');
    } finally {
      setSlipVerifying(false);
    }
  }, [transferOrder, transferPart, actualOrder, actualFseiban, actualPart]);

  const runRegister = useCallback(async () => {
    setRegisterError(null);
    setRegisterMessage(null);
    setRegisterSubmitting(true);
    try {
      const res = await registerOrderPlacement({
        shelfCodeRaw: shelfCode,
        manufacturingOrderBarcodeRaw: orderBarcode
      });
      setRegisterMessage(`登録済み ${res.event.id.slice(0, 8)}…`);
      setOrderBarcode('');
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
  }, [shelfCode, orderBarcode]);

  const registerDisabled =
    registerSubmitting || shelfCode.trim().length === 0 || orderBarcode.trim().length === 0;

  const selectShelf = useCallback((code: string) => {
    setShelfCode(code);
    setRegisterMessage(null);
  }, []);

  const resetSlipResult = useCallback(() => setSlipResult('idle'), []);

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
      orderBarcode
    }),
    [transferOrder, transferPart, actualOrder, actualFseiban, actualPart, slipResult, shelfCode, orderBarcode]
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
    resetSlipResult,
    buildShelfRegisterRouteState,
    restoreShelfRegisterRouteState,
    slipVerifying,
    runSlipVerify,
    shelfCode,
    selectShelf,
    orderBarcode,
    setOrderBarcode,
    registerSubmitting,
    registerMessage,
    registerError,
    registerDisabled,
    runRegister,
    scanField,
    setScanField,
    scanFormats,
    onScanSuccess,
    parseActualSlipImageFile,
    actualSlipImageOcrBusy,
    actualSlipOcrFeedback,
    resetActualSlipOcrFeedback
  };
}
