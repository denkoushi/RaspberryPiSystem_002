import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

type KioskNoteModalProps = {
  isOpen: boolean;
  value: string;
  maxLength?: number;
  onCancel: () => void;
  onCommit: (next: string) => void;
};

const DEFAULT_MAX_LENGTH = 100;

export function KioskNoteModal({
  isOpen,
  value,
  maxLength = DEFAULT_MAX_LENGTH,
  onCancel,
  onCommit
}: KioskNoteModalProps) {
  const [draft, setDraft] = useState(value);
  const [isComposing, setIsComposing] = useState(false);
  const normalizedValue = useMemo(() => value ?? '', [value]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizedValue);
    setIsComposing(false);
  }, [isOpen, normalizedValue]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isOpen) return;

    const handleCompositionStart = () => {
      setIsComposing(true);
    };

    const handleCompositionEnd = () => {
      setIsComposing(false);
    };

    textarea.addEventListener('compositionstart', handleCompositionStart);
    textarea.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      textarea.removeEventListener('compositionstart', handleCompositionStart);
      textarea.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [isOpen]);

  const handleCommit = () => {
    onCommit(draft.slice(0, maxLength));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabel="備考"
      size="lg"
      initialFocusRef={textareaRef}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">備考</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="閉じる"
          title="閉じる"
          className="text-slate-500 hover:text-slate-700"
        >
          ✕
        </button>
      </div>
      <div className="mb-4">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={maxLength}
            rows={6}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
            aria-label="備考を入力"
          />
          {/* 日本語入力状態インジケーター */}
          <div className="absolute right-2 top-2 flex items-center gap-2 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
            <span className="font-semibold">
              {isComposing ? 'あ' : 'A'}
            </span>
            <span className="text-slate-500">
              {isComposing ? '日本語' : '英字'}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <div>
            <span className="font-semibold">切り替え:</span> Ctrl+Space または Alt+`（半角/全角）
          </div>
          <div>
            {draft.length} / {maxLength}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="primary" onClick={handleCommit}>
          保存
        </Button>
      </div>
    </Dialog>
  );
}
