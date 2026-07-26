import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyTemplateEditorPage } from './KioskAssemblyTemplateEditorPage';

import type {
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateCreateInput,
  AssemblyTemplateDto
} from '../../features/assembly/types';

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  getKioskDocumentDetail: vi.fn(),
  getTemplate: vi.fn(),
  listDocuments: vi.fn(),
  reviseTemplate: vi.fn(),
  verifyPassword: vi.fn()
}));

vi.mock('../../api/client', () => ({
  createAssemblyTemplate: mocks.createTemplate,
  getAssemblyTemplate: mocks.getTemplate,
  getKioskDocumentDetail: mocks.getKioskDocumentDetail,
  listAssemblyProcedureDocumentSummaries: mocks.listDocuments,
  listCompatibleTorqueWrenchCapabilityGroups: vi.fn().mockResolvedValue([]),
  reviseAssemblyTemplate: mocks.reviseTemplate,
  verifyAssemblyProcedureOrderAccessPassword: mocks.verifyPassword
}));

vi.mock('../../features/assembly/AssemblyProcedureCanvas', () => ({
  AssemblyProcedureCanvas: () => <div data-testid="assembly-procedure-canvas" />
}));

const NOW = '2026-07-26T00:00:00.000Z';

function documentFixture(id: string, name: string): AssemblyProcedureDocumentSummaryDto {
  return {
    id,
    name,
    imageRelativePath: `/api/${id}.png`,
    status: 'published',
    publishedAt: NOW,
    isActive: true,
    pages: [
      { pageIndex: 0, imageRelativePath: `/api/${id}-1.png` },
      { pageIndex: 1, imageRelativePath: `/api/${id}-2.png` }
    ],
    createdAt: NOW,
    updatedAt: NOW,
    activeTemplateCount: 0,
    totalTemplateCount: 0
  };
}

const documents = [
  documentFixture('11111111-1111-4111-8111-111111111111', '主手順書'),
  documentFixture('22222222-2222-4222-8222-222222222222', '追加手順書')
];

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly/templates/new']}>
      <Routes>
        <Route
          path="/kiosk/assembly/templates/new"
          element={<KioskAssemblyTemplateEditorPage />}
        />
        <Route
          path="/kiosk/assembly/templates/:templateId/edit"
          element={<div>保存後画面</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderExistingEditor(templateId: string) {
  return render(
    <MemoryRouter initialEntries={[`/kiosk/assembly/templates/${templateId}/edit`]}>
      <Routes>
        <Route
          path="/kiosk/assembly/templates/:templateId/edit"
          element={<KioskAssemblyTemplateEditorPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyTemplateEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDocuments.mockResolvedValue(documents);
    mocks.getKioskDocumentDetail.mockResolvedValue({
      document: {
        id: '55555555-5555-4555-8555-555555555555',
        title: '旧PDF要領書',
        displayTitle: '旧PDF要領書'
      },
      pageUrls: ['/api/legacy-kiosk-1.png']
    });
    mocks.verifyPassword.mockResolvedValue({ success: true });
    mocks.createTemplate.mockImplementation(async (payload: AssemblyTemplateCreateInput) => {
      return {
        id: '33333333-3333-4333-8333-333333333333',
        version: 1,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        procedureDocument: documents.find(
          (document) => document.id === payload.procedureDocumentId
        ),
        procedureSequence: { source: 'template_version', items: [] },
        areas: [],
        checkItems: [],
        ...payload
      } as unknown as AssemblyTemplateDto;
    });
  });

  it('authenticates once, starts single-document mode collapsed, and saves reordered documents together', async () => {
    renderEditor();

    expect(await screen.findByText('文書順・工程・マーカーを編集する前にパスワードを入力してください。')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('パスワード'), {
      target: { value: '2520' }
    });
    fireEvent.click(screen.getByRole('button', { name: '認証' }));
    await waitFor(() => expect(mocks.verifyPassword).toHaveBeenCalledWith({ password: '2520' }));

    expect(await screen.findByRole('heading', { name: '組立テンプレート新規' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '文書順' })).not.toBeInTheDocument();

    const pageSelect = screen.getByRole('combobox', { name: 'ページ' }) as HTMLSelectElement;
    expect(screen.getByRole('button', { name: '前頁' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '次頁' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '次頁' }));
    expect(pageSelect.selectedIndex).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '前頁' }));
    expect(pageSelect.selectedIndex).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '文書/工程 (1)' }));
    expect(screen.getByRole('heading', { name: '文書順' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '文書追加' }));

    const dialog = screen.getByRole('dialog', { name: '文書ライブラリ' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: '追加' })[0]!);
    expect(screen.getByText('追加手順書')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2番目の文書を上へ' }));
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));

    await waitFor(() =>
      expect(mocks.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          procedureDocumentId: documents[1]!.id,
          accessPassword: '2520',
          procedureItems: [
            expect.objectContaining({ assemblyProcedureDocumentId: documents[1]!.id }),
            expect.objectContaining({ assemblyProcedureDocumentId: documents[0]!.id })
          ]
        })
      )
    );
  });

  it('shows an inactive legacy template read-only without password authentication', async () => {
    mocks.getTemplate.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      modelCode: 'LEGACY-001',
      procedurePattern: '標準',
      name: '旧版テンプレート',
      version: 1,
      isActive: false,
      traceabilityMode: 'LEGACY',
      procedureDocumentId: documents[0]!.id,
      procedureDocument: documents[0],
      procedureSequence: {
        source: 'primary_fallback',
        items: []
      },
      areas: [],
      checkItems: [],
      createdAt: NOW,
      updatedAt: NOW
    } satisfies AssemblyTemplateDto);

    renderExistingEditor('44444444-4444-4444-8444-444444444444');

    expect(
      await screen.findByRole('heading', { name: '組立テンプレート編集' })
    ).toBeInTheDocument();
    expect(screen.getByText('表示のみ')).toBeInTheDocument();
    expect(screen.getByText('旧形式を取込')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('パスワード')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新しい版で保存' })).toBeDisabled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it('imports an active legacy sequence and preserves its existing KioskDocument on revision', async () => {
    const legacyTemplate = {
      id: '66666666-6666-4666-8666-666666666666',
      modelCode: 'LEGACY-IMPORT',
      procedurePattern: '標準',
      name: '旧形式テンプレート',
      version: 1,
      isActive: true,
      traceabilityMode: 'LEGACY',
      procedureDocumentId: documents[0]!.id,
      procedureDocument: documents[0]!,
      procedureSequence: {
        source: 'legacy_machine_order',
        items: [
          {
            id: 'legacy-primary',
            sortOrder: 0,
            label: '主工程',
            documentType: 'assembly_procedure_document',
            kioskDocumentId: null,
            assemblyProcedureDocumentId: documents[0]!.id,
            document: {
              id: documents[0]!.id,
              documentType: 'assembly_procedure_document',
              title: documents[0]!.name,
              displayTitle: null,
              filename: documents[0]!.name,
              confirmedDocumentNumber: null,
              confirmedSummaryText: null,
              pageCount: 2,
              enabled: true,
              updatedAt: NOW,
              imageRelativePath: documents[0]!.imageRelativePath
            }
          },
          {
            id: 'legacy-kiosk',
            sortOrder: 1,
            label: '準備資料',
            documentType: 'kiosk_document',
            kioskDocumentId: '55555555-5555-4555-8555-555555555555',
            assemblyProcedureDocumentId: null,
            document: {
              id: '55555555-5555-4555-8555-555555555555',
              documentType: 'kiosk_document',
              title: '旧PDF要領書',
              displayTitle: '旧PDF要領書',
              filename: 'legacy.pdf',
              confirmedDocumentNumber: null,
              confirmedSummaryText: null,
              pageCount: 1,
              enabled: true,
              updatedAt: NOW,
              imageRelativePath: null
            }
          }
        ]
      },
      areas: [],
      checkItems: [],
      createdAt: NOW,
      updatedAt: NOW
    } satisfies AssemblyTemplateDto;
    mocks.getTemplate.mockResolvedValue(legacyTemplate);
    mocks.reviseTemplate.mockResolvedValue({
      ...legacyTemplate,
      id: '77777777-7777-4777-8777-777777777777',
      version: 2,
      procedureSequence: {
        source: 'template_version',
        items: legacyTemplate.procedureSequence.items
      }
    } satisfies AssemblyTemplateDto);

    renderExistingEditor(legacyTemplate.id);
    fireEvent.change(await screen.findByPlaceholderText('パスワード'), {
      target: { value: '2520' }
    });
    fireEvent.click(screen.getByRole('button', { name: '認証' }));

    expect(await screen.findByText('旧形式を取込')).toBeInTheDocument();
    expect(screen.getByText('準備資料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新しい版で保存' }));

    await waitFor(() =>
      expect(mocks.reviseTemplate).toHaveBeenCalledWith(
        legacyTemplate.id,
        expect.objectContaining({
          accessPassword: '2520',
          procedureItems: [
            expect.objectContaining({
              assemblyProcedureDocumentId: documents[0]!.id
            }),
            expect.objectContaining({
              kioskDocumentId: '55555555-5555-4555-8555-555555555555'
            })
          ]
        })
      )
    );
  });
});
