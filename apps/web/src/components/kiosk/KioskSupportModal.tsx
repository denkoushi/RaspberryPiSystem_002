import { FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { DEFAULT_CLIENT_KEY, postKioskSupport } from '../../api/client';
import { useKioskEmployees } from '../../api/hooks';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

interface KioskSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const requestTypes = [
  { value: 'visit', label: '現場まで来てください。' }
];

export function KioskSupportModal({ isOpen, onClose }: KioskSupportModalProps) {
  const location = useLocation();
  const { data: employees, isLoading: isLoadingEmployees } = useKioskEmployees(DEFAULT_CLIENT_KEY);
  const senderSelectRef = useRef<HTMLSelectElement | null>(null);
  
  // デフォルト日時を現在の日時に設定
  const getDefaultDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDefaultTime = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const [selectedSender, setSelectedSender] = useState<string>('');
  const [requestType, setRequestType] = useState<string>('');
  const [meetingDate, setMeetingDate] = useState<string>('');
  const [meetingTime, setMeetingTime] = useState<string>('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // モーダルが開かれたときに日時をデフォルト値に設定
  useEffect(() => {
    if (isOpen) {
      setMeetingDate(getDefaultDate());
      setMeetingTime(getDefaultTime());
    }
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    // 送信者と依頼タイプは必須
    if (!selectedSender || !requestType) {
      return;
    }

    setIsSubmitting(true);
    try {
      // メッセージを組み立て
      const selectedEmployee = employees?.find((emp: { id: string; displayName: string; department: string | null }) => emp.id === selectedSender);
      const senderName = selectedEmployee?.displayName || '不明';
      const requestTypeLabel = requestTypes.find((rt) => rt.value === requestType)?.label || '';
      
      let userMessage = `送信者: ${senderName}\n依頼内容: ${requestTypeLabel}`;
      
      if (meetingDate && meetingTime) {
        userMessage += `\n打合せ日時: ${meetingDate} ${meetingTime}`;
      }
      
      if (message.trim()) {
        userMessage += `\n詳細: ${message.trim()}`;
      }

      await postKioskSupport(
        {
          message: userMessage,
          page: location.pathname
        },
        DEFAULT_CLIENT_KEY
      );

      // 成功後、フォームをリセットして閉じる
      setSelectedSender('');
      setRequestType('');
      setMeetingDate('');
      setMeetingTime('');
      setMessage('');
      onClose();
    } catch (error) {
      console.error('Failed to send support message:', error);
      // エラー時もモーダルを閉じる（ユーザー体験優先）
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="お問い合わせ"
      size="md"
      closeOnEsc={!isSubmitting}
      closeOnBackdrop={!isSubmitting}
      initialFocusRef={senderSelectRef}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">お問い合わせ</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="text-slate-500 hover:text-slate-700"
          disabled={isSubmitting}
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
          {/* 送信者選択 */}
          <div>
            <label htmlFor="sender" className="mb-2 block text-sm font-semibold text-slate-700">
              送信者 <span className="text-red-500">*</span>
            </label>
            <select
              id="sender"
              ref={senderSelectRef}
              value={selectedSender}
              onChange={(e) => setSelectedSender(e.target.value)}
              className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              disabled={isSubmitting || isLoadingEmployees}
              required
            >
              <option value="">選択してください</option>
              {employees?.map((employee: { id: string; displayName: string; department: string | null }) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName} {employee.department ? `(${employee.department})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 依頼内容選択 */}
          <div>
            <label htmlFor="request-type" className="mb-2 block text-sm font-semibold text-slate-700">
              依頼内容 <span className="text-red-500">*</span>
            </label>
            <select
              id="request-type"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              disabled={isSubmitting}
              required
            >
              <option value="">選択してください</option>
              {requestTypes.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 打合せ日時 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="meeting-date" className="mb-2 block text-sm font-semibold text-slate-700">
                打合せ日
              </label>
              <input
                id="meeting-date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="meeting-time" className="mb-2 block text-sm font-semibold text-slate-700">
                打合せ時刻
              </label>
              <input
                id="meeting-time"
                type="time"
                value={meetingTime}
                onChange={(e) => setMeetingTime(e.target.value)}
                className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* 詳細（任意） */}
          <div>
            <label htmlFor="support-message" className="mb-2 block text-sm font-semibold text-slate-700">
              詳細（任意）
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="詳細を入力してください"
              className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              rows={4}
              disabled={isSubmitting}
              maxLength={500}
            />
            <p className="mt-1 text-xs text-slate-500">{message.length}/500</p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !selectedSender || !requestType}
              className="flex-1"
            >
              {isSubmitting ? '送信中...' : '送信'}
            </Button>
          </div>
        </form>
    </Dialog>
  );
}

