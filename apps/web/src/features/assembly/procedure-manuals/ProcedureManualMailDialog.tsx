import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { resolveAssemblyOperatorNfc } from '../../../api/client';
import { sendProcedureManualMail } from '../../../api/domains/assembly/procedure-manuals';
import { Dialog } from '../../../components/ui/Dialog';
import { useArmedNfcRead } from '../../kiosk/inventory/setup/useArmedNfcRead';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import './procedure-manual-mail.css';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureSequenceDocumentDto, AssemblyProcedureSequencePageDto } from '../types';

type Props = {
  documentId: string;
  revision: AssemblyProcedureDocumentDto;
  firstPage: AssemblyProcedureSequencePageDto;
  pageCount: number;
  assets: AssemblyProcedureSequenceDocumentDto['assets'];
  domain: string;
  onClose: () => void;
};

type Sender = { uid: string; displayName: string; employeeCode: string };
type Step = 'tag' | 'address' | 'confirm' | 'preview' | 'sending' | 'done' | 'error';

const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789.-_'];
const validLocalPart = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const tokyoTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

const resultUnknown = '送信結果を確認できませんでした。メールが届いたか確認してください';

const errorMessages: Readonly<Partial<Record<string, string>>> = {
  PROCEDURE_MAIL_INVALID_LOCAL_PART: 'メールアドレスを確認してください',
  PROCEDURE_MAIL_NFC_INACTIVE: '有効な社員タグをかざしてください',
  PROCEDURE_MAIL_NFC_NOT_FOUND: '社員タグが見つかりません',
  PROCEDURE_MAIL_REVISION_NOT_CURRENT: '要領書を開き直してください',
  PROCEDURE_MAIL_BUSY: '別の要領書を送信中です',
  PROCEDURE_MAIL_TOO_MANY_PAGES: '要領書のページ数が送信上限を超えています',
  PROCEDURE_MAIL_RENDER_TIMEOUT: 'PDF の作成が時間切れになりました',
  PROCEDURE_MAIL_RESULT_UNKNOWN: resultUnknown,
  PROCEDURE_MAIL_GMAIL_DEFERRED: 'Gmail は送信待機中です',
  PROCEDURE_MAIL_PDF_TOO_LARGE: 'PDF が添付上限を超えています',
  PROCEDURE_MAIL_NO_PAGES: '送信できるページがありません',
  PROCEDURE_MAIL_DISABLED: 'メール送信は設定されていません',
  PROCEDURE_MAIL_RENDER_FAILED: 'PDF を作成できませんでした',
  GMAIL_NOT_CONFIGURED: 'Gmail は設定されていません',
  GMAIL_SCOPE_INSUFFICIENT: 'Gmail の送信権限がありません',
  GMAIL_CLIENT_INIT: 'Gmail に接続できませんでした',
  GMAIL_SEND_FAILED: 'メールを送信できませんでした',
  PROCEDURE_MAIL_RECORD_FAILED: 'メールは送信済みですが記録できませんでした'
};

const titles = {
  tag: 'メールで送る', address: '宛先', confirm: 'この宛先に送ります',
  preview: undefined, sending: undefined, done: undefined, error: undefined
};

export function ProcedureManualMailDialog({ documentId, revision, firstPage, pageCount, assets, domain, onClose }: Props) {
  const [step, setStep] = useState<Step>('tag');
  const [sender, setSender] = useState<Sender>();
  const [verifying, setVerifying] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [outputTime, setOutputTime] = useState('');
  const [error, setError] = useState('');
  const verification = useRef(0);
  const submitted = useRef(false);
  const read = useArmedNfcRead(step === 'tag' && !verifying);
  const address = `${localPart}@${domain}`;
  const revisionLabel = `第${revision.revisionNumber ?? 1}版(改版 ${tokyoTime.format(new Date(revision.publishedAt ?? revision.createdAt)).slice(0, 10)})`;

  useEffect(() => () => { verification.current += 1; }, []);
  useEffect(() => {
    if (!read?.uid) return;
    const attempt = ++verification.current;
    setVerifying(true);
    setError('');
    void resolveAssemblyOperatorNfc(read.uid).then(employee => {
      if (attempt !== verification.current) return;
      setSender({ uid: read.uid, displayName: employee.displayName, employeeCode: employee.employeeCode });
      setStep('address');
    }).catch((failure: unknown) => {
      if (attempt !== verification.current) return;
      const status = isAxiosError(failure) ? failure.response?.status : undefined;
      setError(status === 404 ? errorMessages.PROCEDURE_MAIL_NFC_NOT_FOUND!
        : status === 403 ? errorMessages.PROCEDURE_MAIL_NFC_INACTIVE! : '社員タグを確認できませんでした');
    }).finally(() => {
      if (attempt === verification.current) setVerifying(false);
    });
  }, [read]);

  const submit = async () => {
    if (!sender || submitted.current) return;
    submitted.current = true;
    setStep('sending');
    try {
      await sendProcedureManualMail({ documentId, revisionId: revision.id, nfcUid: sender.uid, localPart });
      setStep('done');
    } catch (failure) {
      const data = isAxiosError<{ errorCode?: string; code?: string }>(failure) ? failure.response?.data : undefined;
      const code = data?.errorCode ?? data?.code ?? '';
      setError(Object.hasOwn(errorMessages, code) ? errorMessages[code]! : resultUnknown);
      setStep('error');
    }
  };

  const preview = sender && (step === 'confirm' || step === 'preview') ? (
    <div className="procedure-mail-paper" role="img" aria-label="PDF のページ">
      <div className="procedure-mail-band">
        <strong>{revision.name}</strong><span>{revisionLabel} 1 / {pageCount}</span>
      </div>
      <div className="procedure-mail-paper-body">
        <AssemblyProcedureCropView pageUrl={firstPage.pageUrl} crop={null} overlay={
          <AssemblyProcedureOverlayLayer elements={firstPage.overlays ?? []} assets={assets} />
        } />
        <span className="procedure-mail-watermark">控え {outputTime.slice(0, 10)} 社員番号 {sender.employeeCode}</span>
      </div>
      <div className="procedure-mail-band procedure-mail-band-footer">
        <strong>{outputTime} 時点の情報です。最新版はキオスクで確認してください。</strong>
        <span>出力 {outputTime} 社員番号 {sender.employeeCode} {sender.displayName}</span>
      </div>
    </div>
  ) : null;

  return (
    <Dialog
      key={step}
      isOpen
      title={titles[step]}
      ariaLabel={step === 'preview' ? 'PDF の見本を大きく見る' : titles[step] ?? 'メールで送る'}
      onClose={step === 'preview' ? () => setStep('confirm') : onClose}
      closeOnEsc={step !== 'sending'}
      closeOnBackdrop={false}
      returnFocus={false}
      overlayZIndex={90}
      overlayClassName="procedure-mail-overlay"
      className={`procedure-mail-dialog${step === 'preview' ? ' procedure-mail-expanded' : ''}`}
      titleClassName="procedure-mail-title"
    >
      {step === 'tag' ? <>
        <div className="procedure-mail-tap">
          <div className="procedure-mail-reader" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h4M7 14h7M15.5 9.5a3 3 0 0 1 0 5M18 8a5.5 5.5 0 0 1 0 8" />
            </svg>
          </div>
          <p role="status">社員タグをかざしてください</p>
          {error ? <p role="alert" className="procedure-mail-error">{error}</p> : null}
        </div>
        <div className="procedure-mail-row"><button type="button" onClick={onClose}>やめる</button></div>
      </> : null}

      {step === 'address' ? <>
        <div className="procedure-mail-address" aria-live="polite">
          <span className="procedure-mail-local">{localPart}</span><span>@{domain}</span>
        </div>
        <div className="procedure-mail-keys">
          {keys.map(key => (
            <button key={key} type="button" onClick={() => setLocalPart(value => value.length < 40 ? value + key : value)}>{key}</button>
          ))}
          <button type="button" className="procedure-mail-wide" aria-label="1文字消す" onClick={() => setLocalPart(value => value.slice(0, -1))}>⌫</button>
          <button type="button" className="procedure-mail-wide" onClick={() => setLocalPart('')}>全部消す</button>
        </div>
        <div className="procedure-mail-row">
          <button type="button" onClick={onClose}>やめる</button>
          <button type="button" className="procedure-mail-primary" disabled={!validLocalPart.test(localPart) || localPart.includes('..')}
            onClick={() => { setOutputTime(tokyoTime.format(new Date())); setStep('confirm'); }}>次へ</button>
        </div>
      </> : null}

      {step === 'confirm' ? <>
        <div className="procedure-mail-confirm">
          <div>
            <div className="procedure-mail-recipient">{address}</div>
            <dl className="procedure-mail-facts">
              <dt>要領書</dt><dd>{revision.name}</dd>
              <dt>版</dt><dd>{revisionLabel}</dd>
              <dt>ページ</dt><dd>{pageCount} ページ</dd>
              <dt>送る人</dt><dd>社員番号 {sender?.employeeCode} {sender?.displayName}</dd>
            </dl>
          </div>
          <button type="button" className="procedure-mail-thumb" aria-label="PDF の見本を大きく見る" onClick={() => setStep('preview')}>{preview}</button>
        </div>
        <div className="procedure-mail-row">
          <button type="button" onClick={() => setStep('address')}>宛先を直す</button>
          <button type="button" className="procedure-mail-primary" onClick={() => void submit()}>送る</button>
        </div>
      </> : null}

      {step === 'preview' ? <>
        <div className="procedure-mail-row"><button type="button" onClick={() => setStep('confirm')}>閉じる</button></div>
        {preview}
      </> : null}

      {step === 'sending' ? <div className="procedure-mail-result" role="status">
        <div className="procedure-mail-spin" aria-hidden="true" /><p>送っています</p>
      </div> : null}

      {step === 'done' || step === 'error' ? <>
        <div className="procedure-mail-result">
          {step === 'done' ? <>
            <div className="procedure-mail-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </div>
            <p role="status">送りました</p><div className="procedure-mail-sent-address">{address}</div>
          </> : <p role="alert" className="procedure-mail-error">{error}</p>}
        </div>
        <div className="procedure-mail-row"><button type="button" className="procedure-mail-primary" onClick={onClose}>閉じる</button></div>
      </> : null}
    </Dialog>
  );
}
