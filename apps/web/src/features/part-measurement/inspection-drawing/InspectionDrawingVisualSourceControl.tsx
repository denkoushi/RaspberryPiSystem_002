import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { kioskInputClassName, kioskPanelClassName } from '../../../features/kiosk/kioskTheme';
import {
  PART_MEASUREMENT_DRAWING_FILE_ACCEPT,
  PART_MEASUREMENT_DRAWING_FILE_LABEL
} from '../partMeasurementDrawingFileInput';

import {
  inspectionDrawingCreateFlatBandItemClassName,
  inspectionDrawingKioskDialogClassName,
  inspectionDrawingKioskDialogTitleClassName,
  inspectionDrawingKioskDisabledButtonClass
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingVisualSource } from './inspectionDrawingCreateDraft';
import type { PartMeasurementVisualTemplateDto } from '../types';

type Props = {
  contentReadOnly: boolean;
  visualSource: InspectionDrawingVisualSource;
  selectedVisualTemplateId: string | null;
  selectedVisualLabel: string | null;
  visuals: PartMeasurementVisualTemplateDto[];
  visualsLoading?: boolean;
  onPickExisting: (visual: PartMeasurementVisualTemplateDto) => boolean;
  onUploadFile: (file: File) => boolean;
  /** ピッカーを開いた直後（検索 debounce 前）に親が初期一覧を読む */
  onOpenPicker?: () => void;
  onSearchChange: (query: string) => void;
};

function sourceSummary(
  visualSource: InspectionDrawingVisualSource,
  selectedVisualLabel: string | null
): string {
  if (visualSource === 'upload') return '新規アップロード';
  if (visualSource === 'pickExisting') {
    return selectedVisualLabel ? `既存: ${selectedVisualLabel}` : '既存図面';
  }
  return '未選択';
}

export function InspectionDrawingVisualSourceControl({
  contentReadOnly,
  visualSource,
  selectedVisualTemplateId,
  selectedVisualLabel,
  visuals,
  visualsLoading = false,
  onPickExisting,
  onUploadFile,
  onOpenPicker,
  onSearchChange
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterQ, setFilterQ] = useState('');

  useEffect(() => {
    if (!dialogOpen) return;
    const timer = window.setTimeout(() => {
      onSearchChange(filterQ.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dialogOpen, filterQ, onSearchChange]);

  const handleOpen = () => {
    if (contentReadOnly) return;
    setFilterQ('');
    setDialogOpen(true);
    onOpenPicker?.();
  };

  return (
    <>
      <div
        data-testid="inspection-drawing-create-visual-source"
        className={`flex min-w-0 items-center gap-1.5 ${inspectionDrawingCreateFlatBandItemClassName}`}
      >
        <span className="whitespace-nowrap text-[0.9rem] font-semibold text-slate-400">図面</span>
        <Button
          type="button"
          variant="ghostOnDark"
          className={`min-h-11 max-w-[12rem] truncate px-2 text-sm ${inspectionDrawingKioskDisabledButtonClass}`}
          disabled={contentReadOnly}
          onClick={handleOpen}
          aria-label="図面ソースを選択"
        >
          {sourceSummary(visualSource, selectedVisualLabel)}
        </Button>
      </div>

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="図面ソース"
        description="新規アップロードするか、既存の図面テンプレートを選びます。"
        ariaLabel="図面ソース選択"
        size="lg"
        overlayZIndex={80}
        className={inspectionDrawingKioskDialogClassName}
        titleClassName={inspectionDrawingKioskDialogTitleClassName}
      >
        <div className="grid gap-4 text-white">
          <section className={`grid gap-2 p-3 ${kioskPanelClassName}`}>
            <h3 className="text-sm font-bold text-white">新規アップロード</h3>
            <label className="grid gap-1 text-sm font-semibold text-white/80">
              {PART_MEASUREMENT_DRAWING_FILE_LABEL}
              <input
                type="file"
                accept={PART_MEASUREMENT_DRAWING_FILE_ACCEPT}
                className="text-sm text-white/80 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const accepted = onUploadFile(file);
                  if (accepted) {
                    setDialogOpen(false);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </section>

          <section className={`grid gap-2 p-3 ${kioskPanelClassName}`}>
            <h3 className="text-sm font-bold text-white">既存から選択</h3>
            <label className="grid gap-1 text-sm font-semibold text-white/80">
              検索
              <input
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
                className={kioskInputClassName}
                placeholder="図面名で絞り込み"
              />
            </label>
            <div className="max-h-56 overflow-y-auto rounded-md border border-white/15">
              {visualsLoading ? (
                <p className="p-3 text-sm text-white/60">図面一覧を読み込み中…</p>
              ) : visuals.length === 0 ? (
                <p className="p-3 text-sm text-white/60">該当する図面がありません。</p>
              ) : (
                <ul className="divide-y divide-white/10">
                  {visuals.map((visual) => (
                    <li key={visual.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
                        aria-pressed={selectedVisualTemplateId === visual.id}
                        onClick={() => {
                          const accepted = onPickExisting(visual);
                          if (accepted) {
                            setDialogOpen(false);
                          }
                        }}
                      >
                        <span className="truncate font-semibold">{visual.name}</span>
                        {selectedVisualTemplateId === visual.id ? (
                          <span className="shrink-0 text-xs text-emerald-300">選択中</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </Dialog>
    </>
  );
}
