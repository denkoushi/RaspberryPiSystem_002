import { useEffect, useId, useRef, useState } from 'react';

import { listInspectionDrawingFhincdCandidates } from '../../../api/client';
import { Input } from '../../../components/ui/Input';

import { inspectionDrawingCreateMetaChipInputClassName } from './inspectionDrawingKioskUi';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const DEBOUNCE_MS = 200;

export function InspectionDrawingFhincdSuggestInput({ id, value, onChange, disabled }: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [candidates, setCandidates] = useState<Array<{ fhincd: string; fhinmei: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (disabled) {
      setCandidates([]);
      setOpen(false);
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setCandidates([]);
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      void listInspectionDrawingFhincdCandidates({ prefix: trimmed, limit: 20 })
        .then((rows) => {
          setCandidates(rows);
          setOpen(rows.length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {
          setCandidates([]);
          setOpen(false);
        })
        .finally(() => {
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [disabled, value]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const applyCandidate = (fhincd: string) => {
    onChange(fhincd);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || candidates.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % candidates.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? candidates.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const picked = candidates[activeIndex];
      if (picked) applyCandidate(picked.fhincd);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (candidates.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={inspectionDrawingCreateMetaChipInputClassName}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-0.5 max-h-48 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-white/20 bg-slate-950 py-0.5 text-[0.9rem] text-white shadow-lg"
        >
          {loading ? (
            <li className="px-2 py-1 text-white/60">候補を取得中…</li>
          ) : (
            candidates.map((candidate, index) => {
              const label = candidate.fhinmei
                ? `${candidate.fhincd} — ${candidate.fhinmei}`
                : candidate.fhincd;
              return (
                <li
                  key={`${candidate.fhincd}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? 'cursor-pointer bg-cyan-900/60 px-2 py-1'
                      : 'cursor-pointer px-2 py-1 hover:bg-white/10'
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyCandidate(candidate.fhincd);
                  }}
                >
                  {label}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
