import { FormEvent, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { DEFAULT_CLIENT_KEY, postKioskSupport } from '../../api/client';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface KioskSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const commonIssues = [
  { id: 'tag-not-read', label: 'タグが読み取れない' },
  { id: 'error-message', label: 'エラーメッセージが表示される' },
  { id: 'how-to-use', label: '操作方法がわからない' },
  { id: 'other', label: 'その他' }
];

export function KioskSupportModal({ isOpen, onClose }: KioskSupportModalProps) {
  const [clientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const location = useLocation();
  const [selectedIssue, setSelectedIssue] = useState<string>('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedIssue && !message.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const userMessage = selectedIssue && message.trim()
        ? `${commonIssues.find((i) => i.id === selectedIssue)?.label}: ${message}`
        : selectedIssue
        ? commonIssues.find((i) => i.id === selectedIssue)?.label || ''
        : message.trim();

      await postKioskSupport(
        {
          message: userMessage,
          page: location.pathname
        },
        clientKey || DEFAULT_CLIENT_KEY
      );

      // 成功後、フォームをリセットして閉じる
      setSelectedIssue('');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">お問い合わせ</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              よくある困りごと
            </label>
            <div className="space-y-2">
              {commonIssues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedIssue(issue.id)}
                  className={`w-full rounded-md border-2 px-3 py-2 text-left text-sm transition-colors ${
                    selectedIssue === issue.id
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                  disabled={isSubmitting}
                >
                  {issue.label}
                </button>
              ))}
            </div>
          </div>

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
              disabled={isSubmitting || (!selectedIssue && !message.trim())}
              className="flex-1"
            >
              {isSubmitting ? '送信中...' : '送信'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

