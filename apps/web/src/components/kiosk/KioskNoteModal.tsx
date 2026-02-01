import { useEffect, useMemo, useState } from 'react';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

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

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizedValue);
  }, [isOpen, normalizedValue]);

  if (!isOpen) return null;

  const handleCommit = () => {
    onCommit(draft.slice(0, maxLength));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">備考</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="mb-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={maxLength}
            rows={6}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
            aria-label="備考を入力"
          />
          <div className="mt-2 text-right text-xs text-slate-500">
            {draft.length} / {maxLength}
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
      </Card>
    </div>
  );
}
