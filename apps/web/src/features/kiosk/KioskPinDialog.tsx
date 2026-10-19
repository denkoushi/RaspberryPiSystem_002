import { isAxiosError } from 'axios';
import { useRef, useState } from 'react';

import { Dialog } from '../../components/ui/Dialog';

import { KioskDigitTenkey } from './KioskDigitTenkey';

export type KioskPinSubmitResult = boolean | 'mismatch' | 'network' | 'rate-limited';

export function kioskPinErrorResult(error: unknown): KioskPinSubmitResult {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  return status === 429 ? 'rate-limited' : status === 401 || status === 403 ? 'mismatch' : 'network';
}

export function KioskPinDialog({ title = '暗証番号', backLabel = '戻る', validHours, maxLength = 8, notice, pinTargetId, submitTargetId, onSubmit, onBack }: {
  title?: string;
  backLabel?: string;
  validHours?: number;
  maxLength?: number;
  notice?: string;
  pinTargetId?: string;
  submitTargetId?: string;
  onSubmit: (pin: string) => Promise<KioskPinSubmitResult>;
  onBack: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'mismatch' | 'network' | 'rate-limited' | null>(null);
  const submitting = useRef(false);
  const dotsRef = useRef<HTMLDivElement>(null);
  const submit = async (value: string) => {
    if (submitting.current || !value) return;
    submitting.current = true;
    setBusy(true);
    let result: KioskPinSubmitResult;
    try { result = await onSubmit(value); }
    catch (error) { result = kioskPinErrorResult(error); }
    finally { submitting.current = false; setBusy(false); }
    if (result === true) return;
    setFailure(result === false ? 'mismatch' : result);
    dotsRef.current?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 240 });
    // Keep four digits after failure so longer PINs can continue to explicit OK.
  };
  const change = (next: string) => {
    if (submitting.current) return;
    setFailure(null);
    setPin(next);
    if (next.length === 4) void submit(next);
  };
  const tenkey = <KioskDigitTenkey value={pin} onChange={change} disabled={busy} maxLength={maxLength} showReset={false} showBackspace keyClassName="h-[60px] rounded-[10px] border border-[#344252] bg-[#1b222a] text-[26px] font-bold disabled:opacity-40" resetClassName="h-[60px] rounded-[10px] border border-[#344252] bg-[#1b222a] text-[26px] font-bold disabled:opacity-40" />;
  return <Dialog isOpen onClose={() => {}} closeOnEsc={false} closeOnBackdrop={false} ariaLabel={title} size="full" className="!my-auto !w-[560px] !max-w-full !rounded-[18px] !border !border-[#344252] !bg-[#161c22] !px-7 !py-[26px] !text-[#eef3f6]">
    <div className="grid gap-[18px]">
      <h2 className="flex items-center gap-3 text-2xl font-black"><svg aria-hidden="true" className="h-7 w-7 text-[#f6b93b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>{title}</h2>
      {notice ? <p role="alert" className="text-center text-sm text-amber-200">{notice}</p> : null}
      <div ref={dotsRef} role="status" aria-label={`${pin.length}桁入力済み`} className="flex justify-center gap-4 py-1.5">
        {Array.from({ length: Math.max(4, pin.length) }, (_, index) => index).map(index => <span key={index} className={`h-[22px] w-[22px] rounded-full border-2 ${failure ? 'border-[#e5484d]' : index < pin.length ? 'border-[#eef3f6] bg-[#eef3f6]' : 'border-[#344252]'}`} />)}
      </div>
      {failure ? <p role="alert" className="text-center text-[#e5484d]">{failure === 'network' ? '通信できません' : failure === 'rate-limited' ? '少し待ってください' : '違います'}</p> : null}
      {pinTargetId ? <div data-testid={pinTargetId} data-kiosk-sop-target={pinTargetId}>{tenkey}</div> : tenkey}
      <div className="flex items-center justify-between text-[17px] text-[#9fadb9]">
        <span>{validHours != null ? `この端末で ${validHours} 時間有効` : ''}</span>
        <button type="button" data-kiosk-sop-target={submitTargetId} disabled={busy || !pin} onClick={() => void submit(pin)} className="min-h-11 rounded-lg border border-[#344252] px-4 text-[19px] font-bold text-[#eef3f6] disabled:opacity-40">OK</button>
        <button type="button" disabled={busy} onClick={onBack} className="min-h-11 rounded-lg border border-[#344252] px-4 text-[19px] font-bold text-[#eef3f6] disabled:opacity-40">{backLabel}</button>
      </div>
    </div>
  </Dialog>;
}
