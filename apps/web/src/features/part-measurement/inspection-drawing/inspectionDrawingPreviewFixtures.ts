import { absoluteBoundsToToleranceRaw } from './toleranceFields';

import type { InspectionDrawingPoint } from './types';
import type { KioskInspectionDrawingTemplateSummaryDto } from '../types';

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
      itemCount: 12
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
      itemCount: 10
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
      itemCount: 8
    }
  ];

/** 開発プレビュー — 資源表示名（resources API の resourceNameMap 形式） */
export const INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP: Record<string, string[]> = {
  R001: ['FJV50/80'],
  R002: ['研削ライン2']
};
