import { useMemo, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { InspectionDrawingCreateMetaChip } from './InspectionDrawingCreateMetaChip';
import {
  inspectionDrawingCreateMetaChipWideControlClassName,
  inspectionDrawingCreateMetaChipWideShellClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingResourceCdSelectOption } from './InspectionDrawingResourceCdSelect';

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  options: ReadonlyArray<InspectionDrawingResourceCdSelectOption>;
  resourceNameMap: Readonly<Record<string, string[]>>;
  disabled?: boolean;
  label?: string;
};

function summarizeResourceCds(values: string[], resourceNameMap: Readonly<Record<string, string[]>>): string {
  if (values.length === 0) return '選択';
  const head = values.slice(0, 2).map((value) => formatResourceCdWithJapaneseNames(value, resourceNameMap));
  const tail = values.length > head.length ? ` +${values.length - head.length}` : '';
  return `${head.join(' / ')}${tail}`;
}

export function InspectionDrawingResourceCdMultiSelect({
  values,
  onChange,
  options,
  resourceNameMap,
  disabled = false,
  label = '資源'
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(values), [values]);
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.value} ${option.label}`.toLowerCase().includes(q)
    );
  }, [options, query]);
  const summary = summarizeResourceCds(values, resourceNameMap);

  const toggle = (value: string) => {
    const next = selectedSet.has(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    onChange(next.sort((a, b) => a.localeCompare(b, 'ja')));
  };

  return (
    <InspectionDrawingCreateMetaChip term={label}>
      <div className={inspectionDrawingCreateMetaChipWideShellClassName}>
        <button
          type="button"
          disabled={disabled}
          title={summary}
          className={inspectionDrawingCreateMetaChipWideControlClassName}
          onClick={() => setIsOpen(true)}
        >
          <span className="block truncate text-left">{summary}</span>
        </button>
      </div>
      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="資源を選択"
        size="lg"
      >
        <div className="grid gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="資源CD・名称で検索"
            className="h-11"
          />
          <div className="max-h-[55dvh] overflow-y-auto rounded border border-slate-200">
            {filteredOptions.map((option) => {
              const checked = selectedSet.has(option.value);
              return (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-slate-900 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.value)}
                    className="h-5 w-5"
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </label>
              );
            })}
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">該当する資源がありません。</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-3"
              onClick={() => onChange([])}
            >
              クリア
            </Button>
            <Button
              type="button"
              variant="primary"
              className="min-h-11 px-4"
              onClick={() => setIsOpen(false)}
            >
              決定
            </Button>
          </div>
        </div>
      </Dialog>
    </InspectionDrawingCreateMetaChip>
  );
}
