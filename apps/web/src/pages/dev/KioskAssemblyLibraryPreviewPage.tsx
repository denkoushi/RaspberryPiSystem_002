import { useMemo, useState } from 'react';

import {
  AssemblyProcedureLibrarySection,
  AssemblyProcedureUploadModal,
  AssemblyTemplateHistoryDialog,
  AssemblyTemplateLibraryTable
} from '../../features/assembly';

import type { AssemblyProcedureDocumentSummaryDto, AssemblyTemplateSummaryDto } from '../../features/assembly/types';

const now = new Date('2026-07-03T10:00:00+09:00').toISOString();

const previewDocuments: AssemblyProcedureDocumentSummaryDto[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'CSPBTLD ストッパー取付 手順書',
    imageRelativePath: '/api/storage/assembly-procedure-images/preview-1.png',
    status: 'published',
    publishedAt: now,
    pages: [{ pageIndex: 0, imageRelativePath: '/api/storage/assembly-procedure-images/preview-1.png' }],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    activeTemplateCount: 3,
    totalTemplateCount: 5
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'CEM20N3X10D-BTLA 締付要領',
    imageRelativePath: '/api/storage/assembly-procedure-images/preview-2.png',
    status: 'draft',
    publishedAt: null,
    pages: [{ pageIndex: 0, imageRelativePath: '/api/storage/assembly-procedure-images/preview-2.png' }],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    activeTemplateCount: 1,
    totalTemplateCount: 1
  }
];

const previewTemplates: AssemblyTemplateSummaryDto[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    modelCode: 'FH-20A',
    procedurePattern: '手順7',
    name: 'FH-20A ストッパー取付',
    version: 4,
    isActive: true,
    procedureDocumentId: previewDocuments[0].id,
    procedureDocumentName: previewDocuments[0].name,
    areaCount: 2,
    boltCount: 8,
    createdAt: now,
    updatedAt: now
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    modelCode: 'FH-20A',
    procedurePattern: '手順7',
    name: 'FH-20A ストッパー取付 旧版',
    version: 3,
    isActive: false,
    procedureDocumentId: previewDocuments[0].id,
    procedureDocumentName: previewDocuments[0].name,
    areaCount: 2,
    boltCount: 8,
    createdAt: now,
    updatedAt: now
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    modelCode: 'FH-25B',
    procedurePattern: '手順8',
    name: 'FH-25B ユニット組立',
    version: 1,
    isActive: true,
    procedureDocumentId: previewDocuments[1].id,
    procedureDocumentName: previewDocuments[1].name,
    areaCount: 3,
    boltCount: 12,
    createdAt: now,
    updatedAt: now
  }
];

function lineageGroupKey(template: AssemblyTemplateSummaryDto): string {
  return `${template.modelCode}::${template.procedurePattern}`;
}

export function KioskAssemblyLibraryPreviewPage() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const visibleRows = useMemo(() => previewTemplates.filter((template) => template.isActive), []);
  const historyRows = historyKey
    ? previewTemplates.filter((template) => lineageGroupKey(template) === historyKey)
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-2">
        <h1 className="text-[1.35rem] font-bold leading-tight">組立トルク管理</h1>
      </div>
      <AssemblyProcedureUploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={() => setUploadOpen(false)} />
      <AssemblyTemplateHistoryDialog
        isOpen={historyKey != null}
        title={historyRows[0] ? `${historyRows[0].modelCode} / ${historyRows[0].procedurePattern}` : '履歴'}
        templates={historyRows}
        onClose={() => setHistoryKey(null)}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2 overflow-auto 2xl:grid-cols-[33rem_minmax(0,1fr)] 2xl:overflow-hidden">
        <AssemblyProcedureLibrarySection
          onRegisterClick={() => setUploadOpen(true)}
          previewDocuments={previewDocuments}
        />
        <section className="flex min-h-0 min-w-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-950/45 p-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-[1.08rem] font-bold text-white/90">組立テンプレート</h2>
            <span className="text-[0.9rem] font-semibold text-white/55">{visibleRows.length}件</span>
          </div>
          <div className="min-h-0 flex-1 rounded bg-slate-950/35 p-1">
            <AssemblyTemplateLibraryTable
              templates={visibleRows}
              onHistoryClick={setHistoryKey}
              lineageGroupKey={lineageGroupKey}
              onRetireClick={() => undefined}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
