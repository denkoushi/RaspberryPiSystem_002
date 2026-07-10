import { absoluteBoundsToToleranceRaw, parseToleranceRawFields } from './toleranceFields';

import type { InspectionDrawingPoint } from './types';
import type { KioskInspectionDrawingTemplateSummaryDto, PartMeasurementTemplateDto } from '../types';

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#f8fafc"/>
  <rect x="40" y="40" width="720" height="520" fill="none" stroke="#334155" stroke-width="2"/>
  <circle cx="400" cy="300" r="120" fill="none" stroke="#0f172a" stroke-width="3"/>
  <line x1="120" y1="300" x2="680" y2="300" stroke="#64748b" stroke-width="1" stroke-dasharray="8 6"/>
  <line x1="400" y1="80" x2="400" y2="520" stroke="#64748b" stroke-width="1" stroke-dasharray="8 6"/>
  <text x="60" y="70" font-family="sans-serif" font-size="18" fill="#475569">検査図面サンプル</text>
</svg>`;

/** 開発プレビュー用（data URL で Vite / キオスク双方で確実に表示） */
export const INSPECTION_DRAWING_PREVIEW_IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(previewSvg)}`;

function previewPoint(
  id: string,
  name: string,
  markerNo: number,
  xRatio: number,
  yRatio: number,
  nominal: number,
  lower: number,
  upper: number,
  testValue: string
): InspectionDrawingPoint {
  const raw = absoluteBoundsToToleranceRaw(nominal, lower, upper);
  return {
    id,
    name,
    markerNo,
    xRatio,
    yRatio,
    nominalRaw: raw.nominalRaw,
    lowerToleranceRaw: raw.lowerToleranceRaw,
    upperToleranceRaw: raw.upperToleranceRaw,
    testValue
  };
}

export const INSPECTION_DRAWING_PREVIEW_POINTS: InspectionDrawingPoint[] = [
  previewPoint('preview-pt-1', '穴径 A', 1, 0.35, 0.42, 10.0, 9.95, 10.05, '10.01'),
  previewPoint('preview-pt-2', '穴径 B', 2, 0.62, 0.38, 8.0, 7.9, 8.1, '8.25'),
  previewPoint('preview-pt-3', '面取り C', 3, 0.5, 0.68, 0.5, 0.3, 0.7, '')
];

/** 開発プレビュー — 帳票 ViewModel 生成用テンプレート DTO */
export const INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE: PartMeasurementTemplateDto = {
  id: 'preview-print-template',
  fhincd: 'DEMO-12345',
  resourceCd: 'R001',
  processGroup: 'cutting',
  templateScope: 'three_key',
  candidateFhinmei: null,
  name: '検査図面プレビュー（紙出力）',
  version: 3,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: 'preview-visual-1',
  visualTemplate: {
    id: 'preview-visual-1',
    name: 'サンプル図面 A',
    drawingImageRelativePath: '/preview/sample-a.svg',
    isActive: true,
    createdAt: '2026-06-14T08:00:00.000Z',
    updatedAt: '2026-06-14T08:00:00.000Z'
  },
  siblingGroupId: null,
  siblingGroup: null,
  items: INSPECTION_DRAWING_PREVIEW_POINTS.map((point, index) => {
    const bounds = parseToleranceRawFields({
      nominalRaw: point.nominalRaw,
      lowerToleranceRaw: point.lowerToleranceRaw,
      upperToleranceRaw: point.upperToleranceRaw
    });
    if ('error' in bounds) {
      throw new Error(bounds.error);
    }
    return {
      id: point.id,
      sortOrder: index,
      datumSurface: 'A',
      measurementPoint: 'P',
      measurementLabel: point.name,
      displayMarker: String(point.markerNo),
      unit: 'mm',
      allowNegative: false,
      decimalPlaces: 3,
      markerXRatio: String(point.xRatio),
      markerYRatio: String(point.yRatio),
      nominalValue: String(bounds.nominal),
      lowerLimit: String(bounds.lowerLimit),
      upperLimit: String(bounds.upperLimit)
    };
  })
};

const previewVisualUpdatedAt = '2026-05-30T08:30:00.000Z';

/** 開発プレビュー — 一覧カード用モック（API 不要） */
export const INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES: KioskInspectionDrawingTemplateSummaryDto[] =
  [
    {
      id: 'preview-tpl-active',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '検査図面プレビュー（有効）',
      version: 3,
      isActive: true,
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'preview-visual-1',
      visualTemplate: {
        id: 'preview-visual-1',
        name: 'サンプル図面 A',
        drawingImageRelativePath: '/preview/sample-a.svg',
        isActive: true,
        createdAt: previewVisualUpdatedAt,
        updatedAt: previewVisualUpdatedAt
      },
      siblingGroupId: 'preview-sibling-1',
      siblingGroup: {
        id: 'preview-sibling-1',
        displayName: 'サンプル図面 A DEMO-12345',
        fhincd: 'DEMO-12345',
        processGroup: 'cutting',
        activeResourceCds: ['R001', 'R002', 'R003'],
        createdAt: '2026-05-30T08:30:00.000Z',
        updatedAt: '2026-05-30T08:30:00.000Z'
      },
      itemCount: 12,
      updatedAt: previewVisualUpdatedAt
    },
    {
      id: 'preview-tpl-active-v2',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '検査図面プレビュー（有効）',
      version: 2,
      isActive: false,
      selfInspectionMode: 'fixed_count',
      selfInspectionFixedCount: 3,
      selfInspectionSampleSize: 3,
      visualTemplateId: 'preview-visual-1-old',
      visualTemplate: {
        id: 'preview-visual-1-old',
        name: 'サンプル図面 A（旧）',
        drawingImageRelativePath: '/preview/sample-a-v2.svg',
        isActive: true,
        createdAt: '2026-05-20T08:00:00.000Z',
        updatedAt: '2026-05-25T10:00:00.000Z'
      },
      siblingGroupId: null,
      siblingGroup: null,
      itemCount: 10,
      updatedAt: '2026-05-25T10:00:00.000Z'
    },
    {
      id: 'preview-tpl-history',
      fhincd: 'DEMO-67890',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: '研削工程サンプル',
      version: 2,
      isActive: false,
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'preview-visual-2',
      visualTemplate: {
        id: 'preview-visual-2',
        name: 'サンプル図面 B',
        drawingImageRelativePath: '/preview/sample-b.svg',
        isActive: true,
        createdAt: previewVisualUpdatedAt,
        updatedAt: '2026-05-28T14:00:00.000Z'
      },
      siblingGroupId: null,
      siblingGroup: null,
      itemCount: 8,
      updatedAt: '2026-05-28T14:00:00.000Z'
    }
  ];

/** 開発プレビュー — 資源表示名（resources API の resourceNameMap 形式） */
export const INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP: Record<string, string[]> = {
  R001: ['FJV50/80'],
  R002: ['研削ライン2'],
  R003: ['切削ライン3'],
  R004: ['MC-7161A'],
  R005: ['MC-7161B'],
  R006: ['MC-7161C'],
  '25M': ['25M'],
  '033': ['33号機'],
  '589': ['589号機']
};

function previewVisual(id: string, name: string, updatedAt: string) {
  return {
    id,
    name,
    drawingImageRelativePath: `/preview/${id}.svg`,
    isActive: true,
    createdAt: updatedAt,
    updatedAt
  };
}

/** 開発プレビュー — 図面ライブラリ表の縦スクロール確認用 */
export const INSPECTION_DRAWING_PREVIEW_VISUAL_LIBRARY: ReturnType<typeof previewVisual>[] = [
  previewVisual('preview-visual-1', '7161テーブル', previewVisualUpdatedAt),
  previewVisual('preview-visual-2', '7161固定金具', '2026-05-28T14:00:00.000Z'),
  previewVisual('preview-visual-3', '7161固定板', '2026-05-27T09:15:00.000Z'),
  previewVisual('preview-visual-4', '7161モータブラケット', '2026-05-26T11:30:00.000Z'),
  previewVisual('preview-visual-5', '7161マニホールド', '2026-05-25T16:45:00.000Z'),
  previewVisual('preview-visual-6', '7161ベアリング押エ', '2026-05-24T08:00:00.000Z'),
  previewVisual('preview-visual-7', '7161ベアリングサポート', '2026-05-23T13:20:00.000Z'),
  previewVisual('preview-visual-8', '7161ナットホルダー', '2026-05-22T10:10:00.000Z'),
  previewVisual('preview-visual-9', '7161ストッパー（2）', '2026-05-21T15:55:00.000Z'),
  previewVisual('preview-visual-10', '7161サドル', '2026-05-20T07:40:00.000Z'),
  previewVisual('preview-visual-11', '7161工具受けプレート', '2026-05-19T16:40:00.000Z'),
  previewVisual('preview-visual-12', '7161カバー支柱', '2026-05-18T12:30:00.000Z'),
  previewVisual('preview-visual-13', '7161長尺ガイドプレート', '2026-05-17T10:20:00.000Z'),
  previewVisual('preview-visual-14', '7161クランプベース', '2026-05-16T09:10:00.000Z'),
  previewVisual('preview-visual-15', '7161位置決めピン受け', '2026-05-15T15:50:00.000Z'),
  previewVisual('preview-visual-16', '7161リニアガイド支え', '2026-05-14T14:25:00.000Z'),
  previewVisual('preview-visual-17', '7161センサーブラケット', '2026-05-13T11:15:00.000Z'),
  previewVisual('preview-visual-18', '7161カップリングホルダー', '2026-05-12T08:45:00.000Z'),
  previewVisual('preview-visual-19', '7161スライドブロック', '2026-05-11T17:05:00.000Z'),
  previewVisual('preview-visual-20', '7161調整板', '2026-05-10T07:35:00.000Z')
];

function previewLibraryTemplate(
  overrides: Partial<KioskInspectionDrawingTemplateSummaryDto> &
    Pick<
      KioskInspectionDrawingTemplateSummaryDto,
      'id' | 'fhincd' | 'resourceCd' | 'processGroup' | 'name' | 'version' | 'isActive' | 'itemCount'
    >
): KioskInspectionDrawingTemplateSummaryDto {
  return {
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    visualTemplateId: overrides.visualTemplate?.id ?? 'preview-visual-1',
    visualTemplate: overrides.visualTemplate ?? {
      id: 'preview-visual-1',
      name: 'サンプル図面 A',
      drawingImageRelativePath: '/preview/sample-a.svg',
      isActive: true,
      createdAt: previewVisualUpdatedAt,
      updatedAt: previewVisualUpdatedAt
    },
    siblingGroupId: overrides.siblingGroupId ?? null,
    siblingGroup: overrides.siblingGroup ?? null,
    updatedAt: previewVisualUpdatedAt,
    ...overrides
  };
}

/** 開発プレビュー — テンプレ2表・1.5行レイアウト確認用 */
export const INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATE_GRID: KioskInspectionDrawingTemplateSummaryDto[] =
  [
    previewLibraryTemplate({
      id: 'preview-tpl-01',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '検査図面プレビュー（有効）',
      version: 3,
      isActive: true,
      itemCount: 12,
      visualTemplate: previewVisual('preview-visual-1', '7161テーブル', previewVisualUpdatedAt),
      siblingGroupId: 'preview-grid-sibling-01',
      siblingGroup: {
        id: 'preview-grid-sibling-01',
        displayName: '7161テーブル DEMO-12345',
        fhincd: 'DEMO-12345',
        processGroup: 'cutting',
        activeResourceCds: ['R001', 'R002', 'R003', 'R004', 'R005', 'R006'],
        createdAt: previewVisualUpdatedAt,
        updatedAt: previewVisualUpdatedAt
      }
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-02',
      fhincd: 'DEMO-67890',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: '研削工程サンプル',
      version: 2,
      isActive: true,
      itemCount: 8,
      visualTemplate: {
        id: 'preview-visual-2',
        name: '7161固定金具',
        drawingImageRelativePath: '/preview/sample-b.svg',
        isActive: true,
        createdAt: previewVisualUpdatedAt,
        updatedAt: '2026-05-28T14:00:00.000Z'
      }
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-03',
      fhincd: 'ABC-10001',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '切削ライン標準',
      version: 1,
      isActive: true,
      itemCount: 6
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-04',
      fhincd: 'ABC-10002',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '外径測定テンプレ',
      version: 4,
      isActive: true,
      itemCount: 15
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-05',
      fhincd: 'XYZ-5500',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: '研削仕上げ検査',
      version: 1,
      isActive: true,
      itemCount: 9
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-06',
      fhincd: 'XYZ-5501',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: '面粗度チェック',
      version: 2,
      isActive: true,
      itemCount: 5
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-07',
      fhincd: 'PART-8800',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '穴径一括測定',
      version: 1,
      isActive: true,
      itemCount: 20
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-08',
      fhincd: 'PART-8801',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '位置度検査',
      version: 3,
      isActive: true,
      itemCount: 11
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-09',
      fhincd: 'LOT-2024-A',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: 'ロットA研削',
      version: 1,
      isActive: true,
      itemCount: 7
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-10',
      fhincd: 'LOT-2024-B',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: 'ロットB研削',
      version: 2,
      isActive: true,
      itemCount: 10
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-11',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '検査図面プレビュー（有効）',
      version: 2,
      isActive: false,
      itemCount: 10
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-12',
      fhincd: 'DEMO-67890',
      resourceCd: 'R002',
      processGroup: 'grinding',
      name: '研削工程サンプル',
      version: 1,
      isActive: false,
      itemCount: 6
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-13',
      fhincd: 'MD004293-01',
      resourceCd: '021',
      processGroup: 'cutting',
      name: '7161足（1）',
      version: 1,
      isActive: true,
      itemCount: 14,
      visualTemplate: previewVisual('preview-visual-3', '7161固定板', '2026-05-27T09:15:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-14',
      fhincd: 'MD100465-02',
      resourceCd: '033',
      processGroup: 'cutting',
      name: '7161サドル',
      version: 1,
      isActive: true,
      itemCount: 11,
      visualTemplate: previewVisual('preview-visual-10', '7161サドル', '2026-05-20T07:40:00.000Z'),
      siblingGroupId: 'preview-grid-sibling-02',
      siblingGroup: {
        id: 'preview-grid-sibling-02',
        displayName: '7161サドル MD100465-02',
        fhincd: 'MD100465-02',
        processGroup: 'cutting',
        activeResourceCds: ['033', '589', '25M'],
        createdAt: '2026-05-20T07:40:00.000Z',
        updatedAt: '2026-05-20T07:40:00.000Z'
      }
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-15',
      fhincd: 'SD000107-01',
      resourceCd: '25M',
      processGroup: 'cutting',
      name: 'test01',
      version: 1,
      isActive: true,
      itemCount: 1,
      visualTemplate: previewVisual('preview-visual-11', '7161工具受けプレート', '2026-05-19T16:40:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-16',
      fhincd: 'ABCD123456-1',
      resourceCd: 'R003',
      processGroup: 'cutting',
      name: '7161長尺ガイドプレート',
      version: 2,
      isActive: true,
      itemCount: 18,
      visualTemplate: previewVisual('preview-visual-13', '7161長尺ガイドプレート', '2026-05-17T10:20:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-17',
      fhincd: 'ABCD123456-2',
      resourceCd: 'R004',
      processGroup: 'cutting',
      name: '7161クランプベース',
      version: 1,
      isActive: true,
      itemCount: 9,
      visualTemplate: previewVisual('preview-visual-14', '7161クランプベース', '2026-05-16T09:10:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-18',
      fhincd: 'FGHI987654-1',
      resourceCd: 'R005',
      processGroup: 'grinding',
      name: '7161位置決めピン受け',
      version: 3,
      isActive: true,
      itemCount: 13,
      visualTemplate: previewVisual('preview-visual-15', '7161位置決めピン受け', '2026-05-15T15:50:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-19',
      fhincd: 'FGHI987654-2',
      resourceCd: 'R006',
      processGroup: 'grinding',
      name: '7161リニアガイド支え',
      version: 2,
      isActive: true,
      itemCount: 16,
      visualTemplate: previewVisual('preview-visual-16', '7161リニアガイド支え', '2026-05-14T14:25:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-20',
      fhincd: 'JKL000112-1',
      resourceCd: 'R001',
      processGroup: 'cutting',
      name: '7161センサーブラケット',
      version: 1,
      isActive: true,
      itemCount: 7,
      visualTemplate: previewVisual('preview-visual-17', '7161センサーブラケット', '2026-05-13T11:15:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-21',
      fhincd: 'JKL000112-2',
      resourceCd: 'R002',
      processGroup: 'cutting',
      name: '7161カップリングホルダー',
      version: 1,
      isActive: true,
      itemCount: 10,
      visualTemplate: previewVisual('preview-visual-18', '7161カップリングホルダー', '2026-05-12T08:45:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-22',
      fhincd: 'MNO000334-1',
      resourceCd: 'R003',
      processGroup: 'grinding',
      name: '7161スライドブロック',
      version: 4,
      isActive: true,
      itemCount: 12,
      visualTemplate: previewVisual('preview-visual-19', '7161スライドブロック', '2026-05-11T17:05:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-23',
      fhincd: 'MNO000334-2',
      resourceCd: 'R004',
      processGroup: 'grinding',
      name: '7161調整板',
      version: 2,
      isActive: true,
      itemCount: 8,
      visualTemplate: previewVisual('preview-visual-20', '7161調整板', '2026-05-10T07:35:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-24',
      fhincd: 'PQR000556-1',
      resourceCd: 'R005',
      processGroup: 'cutting',
      name: '7161モータブラケット',
      version: 1,
      isActive: true,
      itemCount: 17,
      visualTemplate: previewVisual('preview-visual-4', '7161モータブラケット', '2026-05-26T11:30:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-25',
      fhincd: 'PQR000556-2',
      resourceCd: 'R006',
      processGroup: 'cutting',
      name: '7161マニホールド',
      version: 1,
      isActive: true,
      itemCount: 19,
      visualTemplate: previewVisual('preview-visual-5', '7161マニホールド', '2026-05-25T16:45:00.000Z')
    }),
    previewLibraryTemplate({
      id: 'preview-tpl-26',
      fhincd: 'UVW000778-1',
      resourceCd: '589',
      processGroup: 'grinding',
      name: '7161ベアリングサポート',
      version: 2,
      isActive: true,
      itemCount: 6,
      visualTemplate: previewVisual('preview-visual-7', '7161ベアリングサポート', '2026-05-23T13:20:00.000Z')
    })
  ];
