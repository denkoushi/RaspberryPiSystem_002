import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import { useMemo, useState } from 'react';

import {
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM,
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM,
  INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM,
  INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER,
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM,
  getInspectionDrawingPrintRecordTableWidthMm
} from './inspectionDrawingPrintConstants';
import {
  buildInspectionDrawingPrintRecordPageQrPayload,
  formatInspectionDrawingPrintTolerance,
  type InspectionDrawingPrintMetadata,
  type InspectionDrawingPrintRecordPage,
  type InspectionDrawingPrintViewModel
} from './inspectionDrawingPrintViewModel';
import { formatInspectionDrawingPointDisplayName } from './measurementPointSupplement';
import { computePrintCalloutLines, computePrintMarkerPosition } from './printMarkerLayout';

import type { InspectionDrawingPoint } from './types';
import type { CSSProperties } from 'react';

type InspectionDrawingPrintPreviewProps = {
  viewModel: InspectionDrawingPrintViewModel;
  imageUrl: string;
  showToolbar?: boolean;
  returnAction?: {
    label: string;
    onClick: () => void;
  };
};

function markerStyle(leftPercent: number, topPercent: number): CSSProperties {
  return {
    left: `${leftPercent}%`,
    top: `${topPercent}%`
  };
}

const inspectionDrawingPrintQrWriter = new QRCodeWriter();

function buildQrCodeSvgPath(payload: string): { width: number; height: number; path: string } {
  const matrix = inspectionDrawingPrintQrWriter.encode(payload, BarcodeFormat.QR_CODE, 96, 96, new Map());
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const commands: string[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matrix.get(x, y)) {
        commands.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }

  return { width, height, path: commands.join('') };
}

function QrCodeSvg({
  payload,
  label,
  className = 'h-[24mm] w-[24mm]'
}: {
  payload: string;
  label: string;
  className?: string;
}) {
  const qr = useMemo(() => buildQrCodeSvgPath(payload), [payload]);

  return (
    <svg
      data-testid="inspection-print-record-qr-code"
      data-qr-payload={payload}
      role="img"
      aria-label={label}
      className={`${className} bg-white`}
      viewBox={`0 0 ${qr.width} ${qr.height}`}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={qr.width} height={qr.height} fill="#ffffff" />
      <path d={qr.path} fill="#020617" />
    </svg>
  );
}

function SheetFiducials() {
  const markers: CSSProperties[] = [
    { top: '2.4mm', left: '2.4mm', borderTopWidth: '0.8mm', borderLeftWidth: '0.8mm' },
    { top: '2.4mm', right: '2.4mm', borderTopWidth: '0.8mm', borderRightWidth: '0.8mm' },
    { bottom: '2.4mm', left: '2.4mm', borderBottomWidth: '0.8mm', borderLeftWidth: '0.8mm' },
    { right: '2.4mm', bottom: '2.4mm', borderRightWidth: '0.8mm', borderBottomWidth: '0.8mm' }
  ];

  return (
    <>
      {markers.map((style, index) => (
        <span
          key={index}
          data-testid="inspection-print-sheet-fiducial"
          aria-hidden="true"
          className="pointer-events-none absolute z-10"
          style={{
            width: '7mm',
            height: '7mm',
            borderStyle: 'solid',
            borderColor: '#020617',
            ...style
          }}
        />
      ))}
    </>
  );
}

function splitRecordPointLabel(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return ['-'];

  const whitespaceParts = normalized.split(/\s+/).filter(Boolean);
  if (whitespaceParts.length > 1) {
    return [whitespaceParts[0], whitespaceParts.slice(1).join(' ')];
  }

  const characters = Array.from(normalized);
  if (characters.length > 6) {
    const splitAt = Math.ceil(characters.length / 2);
    return [characters.slice(0, splitAt).join(''), characters.slice(splitAt).join('')];
  }

  return [normalized];
}

function formatRecordSpecificationLines(point: InspectionDrawingPoint): string[] {
  const formatted = formatInspectionDrawingPrintTolerance(point);
  if (formatted.startsWith('合格範囲 ')) {
    return ['合格範囲', formatted.replace(/^合格範囲\s+/, '')];
  }

  const [base, tolerance] = formatted.split(' / ');
  return tolerance ? [base, tolerance] : [formatted];
}

function MeasurementValueWriteBoxes() {
  const digitIndexes = [0, 1, 2, 3];
  const decimalIndexes = [0, 1, 2];
  const digitBoxClass = 'block h-full min-w-0 border border-slate-500 bg-white';

  return (
    <span
      data-testid="inspection-print-measurement-value-boxes"
      className="grid h-[8.9mm] items-stretch gap-[0.35mm]"
      style={{ gridTemplateColumns: '4.5mm 21.2mm 1.5mm repeat(3, 5mm)' }}
      aria-hidden="true"
    >
      <span className={digitBoxClass} />
      <span className="grid h-full min-w-0 grid-cols-4 gap-[0.35mm]">
        {digitIndexes.map((index) => (
          <span key={index} className={digitBoxClass} />
        ))}
      </span>
      <span className="flex h-full items-end justify-center pb-[0.5mm] text-[10pt] font-black leading-none text-slate-950">
        .
      </span>
      {decimalIndexes.map((index) => (
        <span key={index} className={digitBoxClass} />
      ))}
    </span>
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
      <tr className="h-[11.5mm] border-t border-dashed border-slate-300 text-slate-300" aria-hidden>
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
  const pointLabelLines = splitRecordPointLabel(
    formatInspectionDrawingPointDisplayName(point, `測定点 ${point.markerNo}`)
  );
  const specificationLines = formatRecordSpecificationLines(point);

  return (
    <tr className="h-[11.5mm] border-t border-slate-900">
      <td className="border-r border-slate-900 bg-slate-100 text-center text-[8pt] font-black">
        {point.markerNo}
      </td>
      <td className="border-r border-slate-900 px-[0.75mm] py-[0.55mm] text-[9.8pt] font-black leading-[1.12] break-words">
        <span className="grid h-full min-w-0 content-center gap-[0.25mm]">
          {pointLabelLines.map((line, index) => (
            <span key={`${line}-${index}`} className="min-w-0 overflow-hidden text-clip whitespace-nowrap">
              {line}
            </span>
          ))}
        </span>
      </td>
      <td className="border-r border-slate-900 px-[0.45mm] py-0 text-[11.2pt] font-semibold leading-[0.95] break-words">
        <span className="grid h-full min-w-0 content-center gap-0">
          {specificationLines.map((line, index) => (
            <span
              key={`${line}-${index}`}
              className={
                index === 0
                  ? 'min-w-0 whitespace-nowrap text-clip'
                  : 'min-w-0 whitespace-nowrap text-clip text-[10.3pt]'
              }
            >
              {line}
            </span>
          ))}
        </span>
      </td>
      {entrySlots.map((entrySlot, index) => (
        <td
          key={entrySlot.entryIndex}
          className={
            index < entrySlots.length - 1
              ? 'border-r border-slate-900 px-[0.35mm] py-[0.75mm]'
              : 'px-[0.35mm] py-[0.75mm]'
          }
        >
          <MeasurementValueWriteBoxes />
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

  const calloutLines = useMemo(
    () =>
      computePrintCalloutLines(
        viewModel.points,
        containerWidth,
        containerHeight,
        imageNaturalWidth,
        imageNaturalHeight
      ),
    [containerHeight, containerWidth, imageNaturalHeight, imageNaturalWidth, viewModel.points]
  );

  return (
    <article
      className="inspection-print-sheet relative mx-auto grid h-[210mm] w-[297mm] grid-rows-[auto_1fr] gap-[2.5mm] overflow-hidden bg-white shadow-2xl"
      style={{ padding: `${INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM}mm` }}
    >
      <SheetHeader
        title="検査図面 位置確認"
        pageLabel={`1/${viewModel.totalPages}`}
        metadata={viewModel.metadata}
      />
      <main
        data-testid="inspection-print-drawing-area"
        className="relative overflow-hidden bg-white"
        style={{ height: `${INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM}mm` }}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        {calloutLines.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {calloutLines.map((line) => (
              <g key={`print-callout-${line.markerNo}-${line.tipLeftPercent}`}>
                <line
                  x1={`${line.x1Percent}%`}
                  y1={`${line.y1Percent}%`}
                  x2={`${line.x2Percent}%`}
                  y2={`${line.y2Percent}%`}
                  stroke="#b45309"
                  strokeWidth="1.2"
                />
                <circle
                  cx={`${line.tipLeftPercent}%`}
                  cy={`${line.tipTopPercent}%`}
                  r="3.2"
                  fill="#fde68a"
                  stroke="#b45309"
                  strokeWidth="1"
                />
                <text
                  x={`${line.tipLeftPercent}%`}
                  y={`${line.tipTopPercent}%`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="5"
                  fontWeight="800"
                  fill="#0f172a"
                >
                  {line.markerNo}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
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

function RecordPageQr({
  page,
  metadata,
  totalPages
}: {
  page: InspectionDrawingPrintRecordPage;
  metadata: InspectionDrawingPrintMetadata;
  totalPages: number;
}) {
  const payload = page.qrPayload ?? buildInspectionDrawingPrintRecordPageQrPayload({ metadata, page, totalPages });

  return (
    <aside
      data-testid="inspection-print-record-qr"
      className="absolute right-[8mm] top-[2.4mm] z-20 grid justify-items-center leading-none"
    >
      <QrCodeSvg
        payload={payload}
        label={`検査値記録欄 QR ${page.pageLabel}`}
        className="h-[22mm] w-[22mm]"
      />
    </aside>
  );
}

function RecordPage({
  page,
  metadata,
  totalPages
}: {
  page: InspectionDrawingPrintRecordPage;
  metadata: InspectionDrawingPrintMetadata;
  totalPages: number;
}) {
  const tableWidthMm = getInspectionDrawingPrintRecordTableWidthMm(page.entrySlots.length);

  return (
    <article className="inspection-print-sheet relative mx-auto grid h-[210mm] w-[297mm] grid-rows-[auto_1fr] gap-[1.6mm] overflow-hidden bg-white p-[5mm] shadow-2xl">
      <SheetFiducials />
      <RecordPageQr page={page} metadata={metadata} totalPages={totalPages} />
      <section className="pr-[34mm]">
        <div className="min-w-0">
          <SheetHeader title="検査値 記録欄" pageLabel={page.pageLabel} metadata={metadata} />
          <section
            data-testid="inspection-print-record-controls"
            className="mt-[1.2mm] grid w-[72mm] grid-cols-4 gap-[1mm] text-[6.2pt] font-bold leading-none"
          >
            {['検査日', '作業者', 'ロット', '数量'].map((label) => (
              <label key={label} className="grid gap-[0.45mm]">
                <span className="whitespace-nowrap">{label}</span>
                <span className="block h-[5.4mm] border border-slate-500 bg-white" />
              </label>
            ))}
          </section>
        </div>
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
              <th colSpan={page.entrySlots.length}>測定値（符号 / 整数4桁 / 小数3桁）</th>
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
  showToolbar = true,
  returnAction
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
          <div className="flex shrink-0 items-center gap-2">
            {returnAction ? (
              <button
                type="button"
                onClick={returnAction.onClick}
                className="rounded border border-slate-400 bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow"
              >
                {returnAction.label}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!printReady}
              onClick={() => window.print()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {printReady ? '印刷プレビュー' : '図面読込中…'}
            </button>
          </div>
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
              <RecordPage
                key={page.pageNumber}
                page={page}
                metadata={viewModel.metadata}
                totalPages={viewModel.totalPages}
              />
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
