import { isAxiosError } from 'axios';
import { useCallback, useMemo, useState } from 'react';

import {
  registerOrderPlacement,
  verifyMobilePlacementSlipMatch
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL
} from '../../features/barcode-scan/formatPresets';

const TEMP_SHELVES = ['TEMP-A', 'TEMP-B', 'TEMP-C', 'TEMP-D'] as const;

type ScanField =
  | 'shelf'
  | 'order'
  | 'transferOrder'
  | 'transferFhinmei'
  | 'actualOrder'
  | 'actualFhinmei'
  | null;

export function MobilePlacementPage() {
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

  const [scanField, setScanField] = useState<ScanField>(null);

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

  const runSlipVerify = async () => {
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
  };

  const runRegister = async () => {
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
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarcodeScanModal
        open={scanField !== null}
        formats={scanFormats}
        idleTimeoutMs={30_000}
        onSuccess={onScanSuccess}
        onAbort={() => setScanField(null)}
      />

      {/* 上半分: 照合（ラベルなし） */}
      <div className="flex min-h-[40vh] flex-col border-b border-white/10 p-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ScanSlot
            fieldId="mp-slip-transfer-order"
            value={transferOrder}
            onChange={(v) => {
              setTransferOrder(v);
              setSlipResult('idle');
            }}
            onScan={() => setScanField('transferOrder')}
            ariaLabel="移動票 製造order"
          />
          <ScanSlot
            fieldId="mp-slip-transfer-fhinmei"
            value={transferFhinmei}
            onChange={(v) => {
              setTransferFhinmei(v);
              setSlipResult('idle');
            }}
            onScan={() => setScanField('transferFhinmei')}
            ariaLabel="移動票 FHINMEI"
          />
          <ScanSlot
            fieldId="mp-slip-actual-order"
            value={actualOrder}
            onChange={(v) => {
              setActualOrder(v);
              setSlipResult('idle');
            }}
            onScan={() => setScanField('actualOrder')}
            ariaLabel="現品票 製造order"
          />
          <ScanSlot
            fieldId="mp-slip-actual-fhinmei"
            value={actualFhinmei}
            onChange={(v) => {
              setActualFhinmei(v);
              setSlipResult('idle');
            }}
            onScan={() => setScanField('actualFhinmei')}
            ariaLabel="現品票 FHINMEI"
          />
        </div>
        <div className="mt-2 flex flex-1 flex-col items-center justify-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="text-xs"
            disabled={slipVerifying}
            onClick={() => void runSlipVerify()}
          >
            {slipVerifying ? '…' : '照合'}
          </Button>
          {slipResult === 'ok' ? (
            <span className="text-5xl font-bold text-emerald-400" role="status">
              OK
            </span>
          ) : null}
          {slipResult === 'ng' ? (
            <span className="text-5xl font-bold text-red-400" role="alert">
              NG
            </span>
          ) : null}
        </div>
      </div>

      {/* 下半分: 棚 + 製造order + 登録 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {TEMP_SHELVES.map((code) => (
            <Button
              key={code}
              type="button"
              variant={shelfCode === code ? 'primary' : 'ghostOnDark'}
              className="min-h-[3rem] min-w-[4.5rem] flex-col gap-0.5 py-2 text-xs"
              aria-label={`棚 ${code}`}
              onClick={() => {
                setShelfCode(code);
                setRegisterMessage(null);
              }}
            >
              <span className="text-lg" aria-hidden>
                📦
              </span>
              <span>{code}</span>
            </Button>
          ))}
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-[3rem] flex-col gap-0.5 py-2 text-xs"
            aria-label="棚をQRスキャン"
            onClick={() => setScanField('shelf')}
          >
            <span className="text-lg" aria-hidden>
              ▣
            </span>
            <span>QR</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="sr-only" htmlFor="mp-order-scan">
            製造order
          </label>
          <input
            id="mp-order-scan"
            value={orderBarcode}
            onChange={(e) => setOrderBarcode(e.target.value)}
            className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-white"
            placeholder="製造order"
            autoComplete="off"
          />
          <Button type="button" variant="ghostOnDark" onClick={() => setScanField('order')}>
            スキャン
          </Button>
        </div>

        <Button
          type="button"
          variant="ghostOnDark"
          className="w-full justify-center py-3 text-base"
          disabled={
            registerSubmitting || shelfCode.trim().length === 0 || orderBarcode.trim().length === 0
          }
          onClick={() => void runRegister()}
        >
          {registerSubmitting ? '登録中…' : '登録'}
        </Button>

        {registerMessage ? (
          <p className="text-sm text-emerald-300" role="status">
            {registerMessage}
          </p>
        ) : null}
        {registerError ? (
          <p className="text-sm text-red-300" role="alert">
            {registerError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ScanSlot(props: {
  fieldId: string;
  value: string;
  onChange: (v: string) => void;
  onScan: () => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="sr-only" htmlFor={props.fieldId}>
        {props.ariaLabel}
      </label>
      <input
        id={props.fieldId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-2 text-sm text-white"
        autoComplete="off"
        aria-label={props.ariaLabel}
      />
      <Button type="button" variant="ghostOnDark" className="text-xs" onClick={props.onScan}>
        スキャン
      </Button>
    </div>
  );
}
