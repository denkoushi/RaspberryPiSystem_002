import { isAxiosError } from 'axios';
import { useCallback, useMemo, useState } from 'react';

import { registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../api/client';
import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL
} from '../barcode-scan/formatPresets';

import type { MobilePlacementScanField } from './types';

/**
 * 配膳ページの状態と API 呼び出し（UI から分離してテスト・再利用しやすくする）
 */
export function useMobilePlacementPageState() {
  const [transferOrder, setTransferOrder] = useState('');
  const [transferFhinmei, setTransferFhinmei] = useState('');
  const [actualOrder, setActualOrder] = useState('');
  const [actualFhinmei, setActualFhinmei] = useState('');
  const [slipResult, setSlipResult] = useState<'idle' | 'ok' | 'ng'>('idle');
  const [slipVerifying, setSlipVerifying] = useState(false);

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
        case 'transferFhinmei':
          setTransferFhinmei(v);
          break;
        case 'actualOrder':
          setActualOrder(v);
          break;
        case 'actualFhinmei':
          setActualFhinmei(v);
          break;
        default:
          break;
      }
      setSlipResult('idle');
      setScanField(null);
    },
    [scanField]
  );

  const runSlipVerify = useCallback(async () => {
    setSlipVerifying(true);
    setSlipResult('idle');
    try {
      const res = await verifyMobilePlacementSlipMatch({
        transferOrderBarcodeRaw: transferOrder,
        transferFhinmeiBarcodeRaw: transferFhinmei,
        actualOrderBarcodeRaw: actualOrder,
        actualFhinmeiBarcodeRaw: actualFhinmei
      });
      setSlipResult(res.ok ? 'ok' : 'ng');
    } catch {
      setSlipResult('ng');
    } finally {
      setSlipVerifying(false);
    }
  }, [transferOrder, transferFhinmei, actualOrder, actualFhinmei]);

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

  return {
    transferOrder,
    setTransferOrder,
    transferFhinmei,
    setTransferFhinmei,
    actualOrder,
    setActualOrder,
    actualFhinmei,
    setActualFhinmei,
    slipResult,
    resetSlipResult,
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
    onScanSuccess
  };
}
