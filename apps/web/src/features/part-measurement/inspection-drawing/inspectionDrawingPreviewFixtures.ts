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

export const INSPECTION_DRAWING_PREVIEW_POINTS: InspectionDrawingPoint[] = [
  {
    id: 'preview-pt-1',
    name: '穴径 A',
    xRatio: 0.35,
    yRatio: 0.42,
    nominal: 10.0,
    lower: 9.95,
    upper: 10.05,
    testValue: '10.01'
  },
  {
    id: 'preview-pt-2',
    name: '穴径 B',
    xRatio: 0.62,
    yRatio: 0.38,
    nominal: 8.0,
    lower: 7.9,
    upper: 8.1,
    testValue: '8.25'
  },
  {
    id: 'preview-pt-3',
    name: '面取り C',
    xRatio: 0.5,
    yRatio: 0.68,
    nominal: 0.5,
    lower: 0.3,
    upper: 0.7,
    testValue: ''
  }
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
