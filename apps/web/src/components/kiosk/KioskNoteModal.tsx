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
  const normalizedValue = useMemo(() => value ?? '', [value]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastImeLogAtRef = useRef<number>(0);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizedValue);
  }, [isOpen, normalizedValue]);

  const logIme = (message: string, data: Record<string, unknown>) => {
    // Avoid noisy logs: rate-limit to ~10 logs/sec.
    const now = Date.now();
    if (now - lastImeLogAtRef.current < 100) return;
    lastImeLogAtRef.current = now;
    // NOTE: Do not log user text contents (draft). Only log metadata.
    // eslint-disable-next-line no-console
    console.error('[IME_DEBUG]', message, { ...data, at: new Date(now).toISOString() });
  };

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
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            logIme('textarea focus', { activeTag: document.activeElement?.tagName ?? null });
          }}
          onKeyDown={(event) => {
            const key = event.key;
            const code = (event as unknown as { code?: string }).code ?? '';
            const isCtrlSpace = event.ctrlKey && (key === ' ' || code === 'Space');
            const isZenkakuLike =
              String(key).toLowerCase().includes('zenkaku') ||
              String(key).toLowerCase().includes('hankaku') ||
              String(code).toLowerCase().includes('zenkaku') ||
              String(code).toLowerCase().includes('hankaku');
            // React KeyboardEvent doesn't expose isComposing; use nativeEvent (DOM KeyboardEvent).
            const isComposing =
              (event.nativeEvent as unknown as { isComposing?: boolean } | undefined)?.isComposing ?? false;
            if (isCtrlSpace || isZenkakuLike || isComposing) {
              logIme('keydown', {
                key,
                code,
                ctrl: event.ctrlKey,
                alt: event.altKey,
                meta: event.metaKey,
                shift: event.shiftKey,
                isComposing,
                keyCode: (event as unknown as { keyCode?: number }).keyCode ?? null
              });
            }
          }}
          onCompositionStart={() => {
            logIme('compositionstart', { draftLen: draft.length });
          }}
          onCompositionUpdate={() => {
            logIme('compositionupdate', { draftLen: draft.length });
          }}
          onCompositionEnd={() => {
            logIme('compositionend', { draftLen: draft.length });
          }}
          maxLength={maxLength}
          rows={6}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
          aria-label="備考を入力"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <div>
            <span className="font-semibold">切り替え:</span> Ctrl+Space（必要に応じて全角半角キー）
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
