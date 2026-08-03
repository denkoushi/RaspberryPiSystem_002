import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAssemblyTemplateSaveInput } from './buildAssemblyTemplateSaveInput';

import type { AssemblyTemplateSaveInput } from './buildAssemblyTemplateSaveInput';

const mocks = vi.hoisted(() => ({ evaluateReadiness: vi.fn() }));

vi.mock('../assemblyTemplateReadiness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assemblyTemplateReadiness')>()),
  evaluateAssemblyTemplateReadiness: mocks.evaluateReadiness
}));

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function validInput(): AssemblyTemplateSaveInput {
  return {
    accessPassword: '2520',
    areas: [
      {
        id: 'area-1',
        sortOrder: 0,
        processNo: '10',
        areaCode: 'A1',
        areaName: '工程1',
        unitCode: 'U1',
        requireManualAdvance: true,
        bolts: []
      }
    ],
    capabilityCatalog: { status: 'ready', groups: [] },
    checkItems: [],
    documents: [
      {
        id: DOCUMENT_ID,
        name: '主手順書',
        imageRelativePath: '/api/document.png',
        status: 'published',
        publishedAt: '2026-08-03T00:00:00.000Z',
        isActive: true,
        pages: [{ pageIndex: 0, imageRelativePath: '/api/document-1.png' }],
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z',
        activeTemplateCount: 0,
        totalTemplateCount: 0
      }
    ],
    machineNameSelectionRequired: true,
    markers: [],
    modelCode: 'L300KP',
    pageOptions: [
      {
        key: `assembly:${DOCUMENT_ID}:0`,
        label: '主手順書 1頁',
        source: 'assembly_procedure_document',
        documentId: DOCUMENT_ID,
        pageIndex: 0,
        imageRelativePath: '/api/document-1.png'
      }
    ],
    procedureItems: [
      {
        localId: 'document-local-1',
        documentType: 'assembly_procedure_document',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: DOCUMENT_ID,
        label: '',
        document: {
          id: DOCUMENT_ID,
          documentType: 'assembly_procedure_document',
          title: '主手順書',
          displayTitle: null,
          filename: 'main.pdf',
          confirmedDocumentNumber: null,
          confirmedSummaryText: null,
          pageCount: 1,
          enabled: true,
          updatedAt: '2026-08-03T00:00:00.000Z',
          imageRelativePath: '/api/document.png'
        }
      }
    ],
    procedurePattern: '標準',
    procedureSteps: [
      {
        localId: 'step-local-1',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: DOCUMENT_ID,
        pageIndex: 0,
        viewMode: 'full_page',
        crop: null,
        title: '',
        instructionText: '',
        emphasis: 'normal'
      }
    ],
    selectedDocument: null,
    templateName: 'L300KP 標準'
  };
}

describe('buildAssemblyTemplateSaveInput', () => {
  beforeEach(() => {
    mocks.evaluateReadiness.mockReturnValue({ isReady: true, issues: [] });
  });

  it('preserves the complete create payload contract', () => {
    expect(buildAssemblyTemplateSaveInput(validInput())).toEqual({
      ok: true,
      payload: {
        name: 'L300KP 標準',
        modelCode: 'L300KP',
        procedurePattern: '標準',
        procedureDocumentId: DOCUMENT_ID,
        areas: [
          {
            sortOrder: 0,
            processNo: '10',
            areaCode: 'A1',
            areaName: '工程1',
            unitCode: 'U1',
            requireManualAdvance: true,
            bolts: []
          }
        ],
        checkItems: [],
        traceabilityMode: 'REQUIRED',
        procedureItems: [
          {
            kioskDocumentId: null,
            assemblyProcedureDocumentId: DOCUMENT_ID,
            label: null
          }
        ],
        procedureSteps: [
          {
            kioskDocumentId: null,
            assemblyProcedureDocumentId: DOCUMENT_ID,
            pageIndex: 0,
            viewMode: 'full_page',
            cropXRatio: null,
            cropYRatio: null,
            cropWidthRatio: null,
            cropHeightRatio: null,
            title: null,
            instructionText: null,
            emphasis: 'normal'
          }
        ],
        accessPassword: '2520'
      }
    });
  });

  it('keeps readiness failure ahead of credential validation and exposes its focus target', () => {
    const issue = {
      stage: 'basic',
      code: 'model_code_required',
      message: '機種名を選択してください。',
      target: { kind: 'basic', field: 'modelCode' }
    } as const;
    mocks.evaluateReadiness.mockReturnValue({ isReady: false, issues: [issue] });

    expect(
      buildAssemblyTemplateSaveInput({ ...validInput(), accessPassword: null })
    ).toEqual({
      ok: false,
      message: '未完了項目を入力してから保存してください。',
      readinessIssue: issue
    });
  });

  it('preserves the authentication error after readiness succeeds', () => {
    expect(
      buildAssemblyTemplateSaveInput({ ...validInput(), accessPassword: null })
    ).toEqual({
      ok: false,
      message: '編集パスワードを認証してください。'
    });
  });
});
