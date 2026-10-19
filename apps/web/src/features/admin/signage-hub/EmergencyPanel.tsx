import { useEffect, useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { useSignageEmergency, useSignageEmergencyMutation, useSignagePdfs } from '../../../api/hooks';

import { PanelFrame } from './PanelFrame';

type EmergencyContent = '' | 'TOOLS' | 'PDF';

const TEMPLATES = ['避難してください', '立入禁止', '設備停止中'];
const EXPIRY_OPTIONS: Array<{ minutes: number | null; label: string }> = [
  { minutes: 15, label: '15分後' },
  { minutes: 30, label: '30分後' },
  { minutes: 60, label: '60分後' },
  { minutes: null, label: '手動' },
];

function formatClock(date: Date): string {
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 緊急表示。有効な間は全端末で予定より優先して表示される。 */
export function EmergencyPanel({ onBack }: { onBack: () => void }) {
  const emergencyQuery = useSignageEmergency();
  const pdfsQuery = useSignagePdfs();
  const mutation = useSignageEmergencyMutation();
  const active = emergencyQuery.data?.enabled ?? false;
  const [message, setMessage] = useState('');
  const [content, setContent] = useState<EmergencyContent>('');
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [expiryMinutes, setExpiryMinutes] = useState<number | null>(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const data = emergencyQuery.data;
    if (!data) return;
    setMessage(data.message ?? '');
    setContent(data.contentType === 'PDF' ? 'PDF' : data.contentType === 'TOOLS' && data.enabled ? 'TOOLS' : '');
    setPdfId(data.pdfId ?? null);
  }, [emergencyQuery.data]);

  const currentExpiry = emergencyQuery.data?.expiresAt ? new Date(emergencyQuery.data.expiresAt) : null;

  const submit = async (enabled: boolean) => {
    setError(null);
    if (enabled && message.trim() === '' && content === '') {
      setError('メッセージを入力してください');
      return;
    }
    if (enabled && content === 'PDF' && !pdfId) {
      setError('PDF を選んでください');
      return;
    }
    try {
      await mutation.mutateAsync(
        enabled
          ? {
              enabled: true,
              message: message.trim() || null,
              contentType: content === '' ? null : content,
              pdfId: content === 'PDF' ? pdfId : null,
              expiresAt: expiryMinutes === null ? null : new Date(Date.now() + expiryMinutes * 60_000),
            }
          : { enabled: false, message: null, contentType: null, pdfId: null, expiresAt: null },
      );
      if (!enabled) onBack();
    } catch (err) {
      setError(getApiErrorMessage(err, '緊急表示を更新できませんでした'));
    }
  };

  return (
    <PanelFrame
      title="緊急表示"
      accent="var(--sh-danger)"
      onBack={onBack}
      footer={
        <div className="sh-col" style={{ gap: 10, width: '100%' }}>
          <button type="button" className={active ? 'sh-btn' : 'sh-btn sh-btn-danger'} onClick={() => void submit(true)} disabled={mutation.isPending}>
            {active ? '内容を更新' : '全端末に緊急表示を出す'}
          </button>
        </div>
      }
    >
      {active && (
        <button type="button" className="sh-btn sh-btn-danger" style={{ minHeight: 52, fontSize: 15, flexShrink: 0 }} onClick={() => void submit(false)} disabled={mutation.isPending}>
          緊急表示を解除して通常に戻す
        </button>
      )}
      {active && (
        <p className="sh-hint" style={{ margin: 0, color: '#ff9a9a' }} role="status">
          表示中{currentExpiry ? ` · ${formatClock(currentExpiry)} に自動解除` : ' · 手動で解除するまで続きます'}
        </p>
      )}
      <div className="sh-fld">
        <label className="sh-flbl" htmlFor="sh-em-message">
          メッセージ
        </label>
        <textarea id="sh-em-message" className="sh-textarea" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="sh-filter">
          {TEMPLATES.map((template) => (
            <button key={template} type="button" className="sh-pill" onClick={() => setMessage(template)}>
              {template}
            </button>
          ))}
        </div>
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">一緒に出すもの</span>
        <div className="sh-seg">
          <button type="button" aria-pressed={content === ''} onClick={() => setContent('')}>
            なし
          </button>
          <button type="button" aria-pressed={content === 'PDF'} onClick={() => setContent('PDF')}>
            PDF
          </button>
          <button type="button" aria-pressed={content === 'TOOLS'} onClick={() => setContent('TOOLS')}>
            持出一覧
          </button>
        </div>
        {content === 'PDF' && (
          <select className="sh-input" aria-label="緊急表示に使う PDF" value={pdfId ?? ''} onChange={(e) => setPdfId(e.target.value || null)}>
            <option value="">選択してください</option>
            {pdfsQuery.data?.map((pdf) => (
              <option key={pdf.id} value={pdf.id}>
                {pdf.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">自動で解除</span>
        <div className="sh-seg">
          {EXPIRY_OPTIONS.map((option) => (
            <button key={option.label} type="button" aria-pressed={expiryMinutes === option.minutes} onClick={() => setExpiryMinutes(option.minutes)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="sh-hint" style={{ margin: 0 }}>
        対象は全端末です。端末には次の更新（約30秒以内）で表示されます。
      </p>
      {error && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </PanelFrame>
  );
}
