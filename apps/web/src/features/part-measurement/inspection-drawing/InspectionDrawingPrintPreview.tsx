import { useMemo, useState } from 'react';

import {
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM,
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM,
  INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER,
  INSPECTION_DRAWING_PRINT_RECORD_COLUMNS
} from './inspectionDrawingPrintConstants';
import {
  formatInspectionDrawingPrintTolerance,
  type InspectionDrawingPrintMetadata,
  type InspectionDrawingPrintRecordPage,
  type InspectionDrawingPrintViewModel
} from './inspectionDrawingPrintViewModel';
import { computePrintMarkerPosition } from './printMarkerLayout';

import type { InspectionDrawingPoint } from './types';
import type { CSSProperties } from 'react';

type InspectionDrawingPrintPreviewProps = {
  viewModel: InspectionDrawingPrintViewModel;
  imageUrl: string;
  showToolbar?: boolean;
};

function markerStyle(leftPercent: number, topPercent: number): CSSProperties {
  return {
    left: `${leftPercent}%`,
    top: `${topPercent}%`
  };
}

function PreviewDisclaimerBanner() {
  return (
    <p className="rounded border border-amber-700 bg-amber-50 px-[2mm] py-[1mm] text-[7pt] font-bold leading-snug text-amber-950">
      {INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER}
    </p>
  );
}

function SheetHeader({
  title,
  pageLabel,
  metadata
}: {
  title: string;
  pageLabel: string;
  metadata: InspectionDrawingPrintMetadata;
}) {
  return (
    <header className="grid gap-[1.5mm] border-b-2 border-slate-900 pb-[1.5mm] text-[7pt] leading-snug">
      <div className="grid grid-cols-[1fr_auto] items-start gap-[3mm]">
        <span className="text-[13pt] font-black leading-none">{title}</span>
        <div className="text-right font-bold whitespace-nowrap">
          <div>{pageLabel}</div>
          <div>発行: {metadata.issuedAtDisplay}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-[2mm] gap-y-[0.8mm] font-bold">
        <div className="min-w-0 break-all">
          <span className="mr-[1mm]">部品:</span>
          {metadata.fhincd}
        </div>
        <div className="min-w-0 break-all">
          <span className="mr-[1mm]">資源:</span>
          {metadata.resourceName}
        </div>
        <div className="min-w-0 break-all">
          <span className="mr-[1mm]">工程:</span>
          {metadata.processLabel}
        </div>
        <div className="min-w-0 break-all">
          <span className="mr-[1mm]">版:</span>v{metadata.templateVersion}
        </div>
      </div>
      <div className="min-w-0 break-all font-bold">
        <span className="mr-[1mm]">テンプレート:</span>
        {metadata.templateName}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-[2mm]">
        <span className="font-bold whitespace-nowrap">帳票ID:</span>
        <span className="break-all font-mono">{metadata.previewIdentifier}</span>
      </div>
    </header>
  );
}

function RecordSlot({ slot }: { slot: InspectionDrawingPrintRecordPage['slots'][number] }) {
  if (slot.kind === 'empty') {
    return (
      <div
        className="grid grid-cols-[10mm_1fr_42mm] border-2 border-dashed border-slate-300 opacity-40"
        aria-hidden
      >
        <div className="border-r-2 border-dashed border-slate-300 bg-slate-50" />
        <div className="p-[1.8mm]" />
        <div className="border-l-2 border-dashed border-slate-300" />
      </div>
    );
  }

  const { point } = slot;
  return (
    <div className="grid grid-cols-[10mm_1fr_42mm] border-2 border-slate-900">
      <div className="grid place-items-center border-r-2 border-slate-900 bg-slate-100 text-[13pt] font-black">
        {point.markerNo}
      </div>
      <div className="grid grid-rows-[auto_1fr] p-[1.8mm]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[9pt] font-black">{point.name || `測定点 ${point.markerNo}`}</span>
          <span className="break-all font-mono text-[6pt] text-slate-500">{point.id}</span>
        </div>
        <label className="mt-[1.4mm] grid grid-rows-[auto_1fr] gap-[0.8mm]">
          <span className="text-[7pt] font-bold">測定値（手書き）</span>
          <span className="block min-h-[18mm] border border-slate-500 bg-white" />
        </label>
      </div>
      <div className="grid grid-rows-[auto_auto_auto_auto_1fr] border-l-2 border-slate-900 text-[6.5pt]">
        <div className="border-b border-slate-900 p-[1mm] text-center font-bold leading-tight">
          規格
          <div className="mt-[0.5mm] font-normal">{formatInspectionDrawingPrintTolerance(point)}</div>
        </div>
        <div className="grid grid-rows-[auto_1fr] border-b border-slate-400 p-[1mm]">
          <span className="font-bold">判定</span>
          <span className="mt-[0.8mm] block min-h-[6mm] border border-slate-400 bg-white" />
        </div>
        <div className="grid grid-rows-[auto_1fr] border-b border-slate-400 p-[1mm]">
          <span className="font-bold">確認</span>
          <span className="mt-[0.8mm] block min-h-[6mm] border border-slate-400 bg-white" />
        </div>
        <div className="grid grid-rows-[auto_1fr] p-[1mm]">
          <span className="font-bold">備考</span>
          <span className="mt-[0.8mm] block min-h-[6mm] border border-slate-400 bg-white" />
        </div>
      </div>
    </div>
  );
}

function DrawingPage({
  viewModel,
  imageUrl,
  imageNaturalWidth,
  imageNaturalHeight
}: {
  viewModel: InspectionDrawingPrintViewModel;
  imageUrl: string;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
}) {
  const containerWidth = INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM * 10;
  const containerHeight = INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM * 10;

  const markerPositions = useMemo(() => {
    const map = new Map<string, { leftPercent: number; topPercent: number }>();
    for (const point of viewModel.points) {
      const position = computePrintMarkerPosition(
        point,
        containerWidth,
        containerHeight,
        imageNaturalWidth,
        imageNaturalHeight
      );
      if (position) map.set(point.id, position);
    }
    return map;
  }, [containerHeight, containerWidth, imageNaturalHeight, imageNaturalWidth, viewModel.points]);

  return (
    <article className="inspection-print-sheet mx-auto grid h-[210mm] w-[297mm] grid-rows-[auto_auto_1fr] gap-[2.5mm] bg-white p-[5mm] shadow-2xl">
      <PreviewDisclaimerBanner />
      <SheetHeader
        title="検査図面 位置確認"
        pageLabel={`1/${viewModel.totalPages}`}
        metadata={viewModel.metadata}
      />
      <main
        className="relative overflow-hidden border-2 border-slate-900 bg-slate-50"
        style={{ height: `${INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM}mm` }}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        {viewModel.points.map((point: InspectionDrawingPoint) => {
          const position = markerPositions.get(point.id);
          if (!position) return null;
          return (
            <span
              key={point.id}
              className="absolute flex h-[9mm] min-w-[9mm] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-slate-950 bg-white px-[1mm] text-[11pt] font-black leading-none shadow"
              style={markerStyle(position.leftPercent, position.topPercent)}
            >
              {point.markerNo}
            </span>
          );
        })}
      </main>
    </article>
  );
}

function RecordPage({
  page,
  metadata
}: {
  page: InspectionDrawingPrintRecordPage;
  metadata: InspectionDrawingPrintMetadata;
}) {
  return (
    <article className="inspection-print-sheet mx-auto grid h-[210mm] w-[297mm] grid-rows-[auto_auto_auto_1fr] gap-[2.5mm] bg-white p-[5mm] shadow-2xl">
      <PreviewDisclaimerBanner />
      <SheetHeader
        title="検査値 記録欄"
        pageLabel={page.pageLabel}
        metadata={metadata}
      />
      <section className="grid shrink-0 grid-cols-[repeat(4,1fr)] gap-[2mm] text-[8pt] font-bold">
        {['検査日', '作業者', 'ロット', '数量'].map((label) => (
          <label key={label} className="grid grid-cols-[auto_1fr] items-center gap-[1.5mm]">
            <span>{label}</span>
            <span className="block h-[8mm] border border-slate-500 bg-white" />
          </label>
        ))}
      </section>
      <section
        className="grid min-h-0 auto-rows-fr gap-[2.2mm]"
        style={{ gridTemplateColumns: `repeat(${INSPECTION_DRAWING_PRINT_RECORD_COLUMNS}, minmax(0, 1fr))` }}
      >
        {page.slots.map((slot, index) => (
          <RecordSlot key={slot.kind === 'point' ? slot.point.id : `empty-${index}`} slot={slot} />
        ))}
      </section>
    </article>
  );
}

export function InspectionDrawingPrintPreview({
  viewModel,
  imageUrl,
  showToolbar = true
}: InspectionDrawingPrintPreviewProps) {
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const hasNaturalSize = naturalSize.w > 0 && naturalSize.h > 0;
  const printReady = hasNaturalSize;

  return (
    <div className="min-h-dvh bg-slate-200 px-4 py-6 text-slate-950 print:bg-white print:p-0">
      <style>
        {`
          @page { size: A4 landscape; margin: 0; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .inspection-print-toolbar { display: none !important; }
            .inspection-print-loading { display: none !important; }
            .inspection-print-sheet {
              box-shadow: none !important;
              margin: 0 !important;
              break-after: page;
              page-break-after: always;
            }
            .inspection-print-sheet:last-child {
              break-after: auto;
              page-break-after: auto;
            }
          }
        `}
      </style>

      {showToolbar ? (
        <div className="inspection-print-toolbar mx-auto mb-3 flex max-w-[297mm] items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-700">A4横 HTML 帳票プレビュー</p>
            <p className="text-xs text-slate-600">{INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER}</p>
            <p className="text-xs text-slate-600">
              1枚目は丸数字付き図面、2枚目以降は測定値記録欄です。保存済みテンプレートを対象とします。
            </p>
          </div>
          <button
            type="button"
            disabled={!printReady}
            onClick={() => window.print()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {printReady ? '印刷プレビュー' : '図面読込中…'}
          </button>
        </div>
      ) : null}

      <img
        src={imageUrl}
        alt=""
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onLoad={(event) => {
          const img = event.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />

      <div className="grid gap-6 print:block">
        {printReady ? (
          <>
            <DrawingPage
              viewModel={viewModel}
              imageUrl={imageUrl}
              imageNaturalWidth={naturalSize.w}
              imageNaturalHeight={naturalSize.h}
            />
            {viewModel.recordPages.map((page) => (
              <RecordPage key={page.pageNumber} page={page} metadata={viewModel.metadata} />
            ))}
          </>
        ) : (
          <article className="inspection-print-loading mx-auto grid h-[210mm] w-[297mm] place-items-center rounded bg-white p-[5mm] shadow-2xl">
            <p className="text-sm text-slate-600">図面を読み込み中…</p>
          </article>
        )}
      </div>
    </div>
  );
}
