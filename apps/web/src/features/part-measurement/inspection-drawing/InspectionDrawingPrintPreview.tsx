import { useMemo, useState } from 'react';

import {
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM,
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM,
  INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER,
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM,
  getInspectionDrawingPrintRecordTableWidthMm
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
    <header
      data-testid="inspection-print-sheet-header"
      className="grid grid-cols-[auto_1fr_auto] items-baseline gap-[3mm] overflow-hidden border-b-2 border-slate-900 pb-[1mm] text-[6.2pt] leading-none"
    >
      <span className="whitespace-nowrap text-[11pt] font-black">{title}</span>
      <div className="flex min-w-0 flex-nowrap items-baseline gap-[2.4mm] overflow-hidden font-bold whitespace-nowrap">
        <span className="shrink-0">部品: {metadata.fhincd}</span>
        <span className="shrink-0">資源: {metadata.resourceName}</span>
        <span className="shrink-0">工程: {metadata.processLabel}</span>
        <span className="shrink-0">版: v{metadata.templateVersion}</span>
        <span className="min-w-[28mm] truncate">テンプレート: {metadata.templateName}</span>
        <span className="min-w-[42mm] truncate font-mono">帳票ID: {metadata.previewIdentifier}</span>
      </div>
      <span className="whitespace-nowrap text-right font-bold">
        {pageLabel} / 発行: {metadata.issuedAtDisplay}
      </span>
    </header>
  );
}

function RecordSlot({
  slot,
  entrySlots
}: {
  slot: InspectionDrawingPrintRecordPage['slots'][number];
  entrySlots: InspectionDrawingPrintRecordPage['entrySlots'];
}) {
  if (slot.kind === 'empty') {
    return (
      <tr className="h-[10.5mm] border-t border-dashed border-slate-300 text-slate-300" aria-hidden>
        <td className="border-r border-dashed border-slate-300 bg-slate-50" />
        <td className="border-r border-dashed border-slate-300 bg-slate-50" />
        <td className="border-r border-dashed border-slate-300 bg-slate-50" />
        {entrySlots.map((entrySlot, index) => (
          <td
            key={entrySlot.entryIndex}
            className={
              index < entrySlots.length - 1
                ? 'border-r border-dashed border-slate-300 bg-slate-50'
                : 'bg-slate-50'
            }
          />
        ))}
      </tr>
    );
  }

  const { point } = slot;
  return (
    <tr className="h-[10.5mm] border-t border-slate-900">
      <td className="border-r border-slate-900 bg-slate-100 text-center text-[8pt] font-black">
        {point.markerNo}
      </td>
      <td className="border-r border-slate-900 px-[1mm] py-[0.6mm] text-[7pt] font-bold leading-tight break-words">
        {point.name || `測定点 ${point.markerNo}`}
      </td>
      <td className="border-r border-slate-900 px-[1mm] py-[0.6mm] text-[6.5pt] leading-tight break-words">
        {formatInspectionDrawingPrintTolerance(point)}
      </td>
      {entrySlots.map((entrySlot, index) => (
        <td
          key={entrySlot.entryIndex}
          className={
            index < entrySlots.length - 1
              ? 'border-r border-slate-900 px-[0.8mm] py-[0.6mm]'
              : 'px-[0.8mm] py-[0.6mm]'
          }
        >
          <span className="block h-[7mm] border border-slate-500 bg-white" />
        </td>
      ))}
    </tr>
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
              className="absolute flex h-[4.5mm] min-w-[4.5mm] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-950 bg-white px-[0.6mm] text-[6pt] font-black leading-none shadow"
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
  const tableWidthMm = getInspectionDrawingPrintRecordTableWidthMm(page.entrySlots.length);

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
      <section className="min-h-0">
        <table
          data-testid="inspection-print-record-table"
          className="table-fixed border-collapse border-2 border-slate-900 text-[7pt] leading-snug"
          style={{ width: `${tableWidthMm}mm` }}
        >
          <colgroup>
            <col style={{ width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.no}mm` }} />
            <col
              style={{
                width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementPoint}mm`
              }}
            />
            <col
              style={{
                width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.specification}mm`
              }}
            />
            {page.entrySlots.map((entrySlot) => (
              <col
                key={entrySlot.entryIndex}
                style={{
                  width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementValue}mm`
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="h-[5mm] bg-slate-100 text-center text-[7pt] font-black">
              <th rowSpan={2} className="border-r border-slate-900">No</th>
              <th rowSpan={2} className="border-r border-slate-900">測定点</th>
              <th rowSpan={2} className="border-r border-slate-900">規格</th>
              <th colSpan={page.entrySlots.length}>測定値</th>
            </tr>
            <tr className="h-[5mm] bg-slate-100 text-center text-[6.5pt] font-bold">
              {page.entrySlots.map((entrySlot, index) => (
                <th
                  key={entrySlot.entryIndex}
                  className={
                    index < page.entrySlots.length - 1
                      ? 'border-r border-t border-slate-900'
                      : 'border-t border-slate-900'
                  }
                >
                  {entrySlot.entryLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.slots.map((slot, index) => (
              <RecordSlot
                key={slot.kind === 'point' ? slot.point.id : `empty-${index}`}
                slot={slot}
                entrySlots={page.entrySlots}
              />
            ))}
          </tbody>
        </table>
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
