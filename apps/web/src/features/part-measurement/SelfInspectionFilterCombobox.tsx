import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { kioskInputClassName } from '../kiosk/kioskTheme';

import type { SelfInspectionFilterOption } from './selfInspectionTableModel';

type Props = {
  ariaLabel: string;
  value: string;
  placeholder: string;
  options: readonly SelfInspectionFilterOption[];
  className?: string;
  dropdownClassName?: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
};

export function SelfInspectionFilterCombobox({
  ariaLabel,
  value,
  placeholder,
  options,
  className,
  dropdownClassName,
  onChange,
  onSelect
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SelfInspectionFilterOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    if (!query) return snapshot;
    return snapshot.filter(
      (option) => option.value.toLocaleLowerCase().includes(query) || option.searchText.includes(query)
    );
  }, [snapshot, value]);

  const openWithSnapshot = (initialActiveIndex = -1) => {
    setSnapshot([...options]);
    setActiveIndex(options.length === 0 ? -1 : Math.min(initialActiveIndex, options.length - 1));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(filteredOptions.length - 1);
    }
  }, [activeIndex, filteredOptions.length]);

  const selectOption = (option: SelfInspectionFilterOption) => {
    onSelect(option.value);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div ref={rootRef} className={clsx('relative min-w-0', className)}>
      <div className="flex min-w-0">
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          className={clsx(kioskInputClassName, 'min-w-0 flex-1 rounded-r-none pr-2')}
          value={value}
          placeholder={placeholder}
          onFocus={() => {
            if (!open) openWithSnapshot();
          }}
          onChange={(event) => {
            if (!open) openWithSnapshot();
            onChange(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) {
                openWithSnapshot(0);
                return;
              }
              setActiveIndex((current) => Math.min(filteredOptions.length - 1, current + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) {
                openWithSnapshot(options.length - 1);
                return;
              }
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) selectOption(option);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        <button
          type="button"
          aria-label={`${ariaLabel}の候補を表示`}
          aria-expanded={open}
          className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-r border border-l-0 border-white/25 bg-slate-900 text-lg text-white hover:bg-slate-700"
          onClick={() => {
            if (open) {
              setOpen(false);
              setActiveIndex(-1);
            } else {
              openWithSnapshot();
            }
          }}
        >
          ▾
        </button>
      </div>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel}の候補`}
          className={clsx(
            'absolute left-0 top-full z-50 mt-1 max-h-72 min-w-full overflow-auto rounded border border-white/25 bg-slate-950 p-1 shadow-2xl',
            dropdownClassName
          )}
        >
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/55">表示中アイテムに候補がありません</p>
          ) : (
            filteredOptions.map((option, index) => (
              <button
                key={option.value}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={clsx(
                  'flex min-h-11 w-full items-center rounded px-3 py-2 text-left text-sm text-white',
                  index === activeIndex ? 'bg-cyan-600' : 'hover:bg-slate-700'
                )}
                title={option.label}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span className="line-clamp-2">{option.label}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
