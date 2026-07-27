import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyTemplateEditorPage } from './KioskAssemblyTemplateEditorPage';

import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';
import type {
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateCreateInput,
  AssemblyTemplateDto
} from '../../features/assembly/types';

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  getKioskDocumentDetail: vi.fn(),
  getTemplate: vi.fn(),
  listCapabilityGroups: vi.fn(),
  listMachineNameCandidates: vi.fn(),
  listDocuments: vi.fn(),
  reviseTemplate: vi.fn(),
  verifyPassword: vi.fn()
}));

vi.mock('../../api/client', () => ({
  createAssemblyTemplate: mocks.createTemplate,
  getAssemblyTemplate: mocks.getTemplate,
  getKioskDocumentDetail: mocks.getKioskDocumentDetail,
  listAssemblyMachineNameCandidates: mocks.listMachineNameCandidates,
  listAssemblyProcedureDocumentSummaries: mocks.listDocuments,
  listTorqueWrenchCapabilityGroups: mocks.listCapabilityGroups,
  reviseAssemblyTemplate: mocks.reviseTemplate,
  verifyAssemblyTemplateAccessPassword: mocks.verifyPassword
}));

vi.mock('../../features/assembly/AssemblyProcedureCanvas', () => ({
  AssemblyProcedureCanvas: () => <div data-testid="assembly-procedure-canvas" />
}));

const NOW = '2026-07-26T00:00:00.000Z';
const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '99999999-9999-4999-8999-999999999999';
const KIOSK_DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';

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
  documentFixture(DOCUMENT_ID, '主手順書'),
  documentFixture(SECOND_DOCUMENT_ID, '追加手順書')
];

function capabilityGroupFixture(): TorqueWrenchCapabilityGroupApi {
  return {
    id: GROUP_ID,
    name: 'M6 標準',
    nominalDiameter: 'M6',
    boltLengthMm: '30',
    material: 'SCM435',
    strengthClass: '10.9',
    isActive: true,
    models: []
  };
}

function procedureItem(
  id: string,
  documentId: string,
  title: string
): NonNullable<AssemblyTemplateDto['procedureSequence']>['items'][number] {
  return {
    id,
    sortOrder: 0,
    label: null,
    documentType: 'assembly_procedure_document',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: documentId,
    document: {
      id: documentId,
      documentType: 'assembly_procedure_document',
      title,
      displayTitle: null,
      filename: `${title}.pdf`,
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: 2,
      enabled: true,
      updatedAt: NOW,
      imageRelativePath: `/api/${documentId}.png`
    }
  };
}

function procedureStep(
  id: string,
  documentId: string | null = DOCUMENT_ID,
  kioskDocumentId: string | null = null
): NonNullable<
  NonNullable<AssemblyTemplateDto['procedureSequence']>['steps']
>[number] {
  return {
    id,
    sortOrder: 0,
    kioskDocumentId,
    assemblyProcedureDocumentId: documentId,
    pageIndex: 0,
    viewMode: 'full_page',
    cropXRatio: null,
    cropYRatio: null,
    cropWidthRatio: null,
    cropHeightRatio: null,
    title: null,
    instructionText: null,
    emphasis: 'normal'
  };
}

function areaFixture(
  id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  markerNo = 1
): AssemblyTemplateDto['areas'][number] {
  return {
    id,
    templateId: '88888888-8888-4888-8888-888888888888',
    sortOrder: markerNo - 1,
    processNo: `${markerNo * 10}`,
    areaCode: `A${markerNo}`,
    areaName: `工程${markerNo}`,
    unitCode: `U${markerNo}`,
    requireManualAdvance: true,
    createdAt: NOW,
    updatedAt: NOW,
    bolts: [
      {
        id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${markerNo}`,
        areaId: id,
        templateId: '88888888-8888-4888-8888-888888888888',
        sortOrder: 0,
        tighteningId: `T-${markerNo}`,
        markerNo,
        xRatio: '0.5',
        yRatio: '0.5',
        calloutTipXRatio: null,
        calloutTipYRatio: null,
        boltSpec: `保存済み独自表記${markerNo}`,
        nominalDiameter: 'M6',
        boltLengthMm: '30',
        material: 'SCM435',
        strengthClass: '10.9',
        capabilityGroupId: GROUP_ID,
        nominalTorque: '10',
        lowerLimit: '9',
        upperLimit: '11',
        unit: 'N·m',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: DOCUMENT_ID,
        pageIndex: 0,
        createdAt: NOW,
        updatedAt: NOW
      }
    ]
  };
}

function templateFixture(
  overrides: Partial<AssemblyTemplateDto> = {}
): AssemblyTemplateDto {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    modelCode: 'SOURCE-MACHINE',
    procedurePattern: '標準',
    name: '雛形元テンプレート',
    version: 1,
    isActive: true,
    traceabilityMode: 'REQUIRED',
    procedureDocumentId: DOCUMENT_ID,
    procedureDocument: documents[0]!,
    procedureSequence: {
      source: 'template_version',
      stepSource: 'template_steps',
      items: [procedureItem('item-primary', DOCUMENT_ID, '主手順書')],
      steps: [procedureStep('step-primary')]
    },
    areas: [areaFixture()],
    checkItems: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/kiosk/assembly/templates/new"
          element={<KioskAssemblyTemplateEditorPage />}
        />
        <Route
          path="/kiosk/assembly/templates/:templateId/edit"
          element={<KioskAssemblyTemplateEditorPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

async function authenticate() {
  fireEvent.change(await screen.findByPlaceholderText('パスワード'), {
    target: { value: '2520' }
  });
  fireEvent.click(screen.getByRole('button', { name: '認証' }));
  await waitFor(() =>
    expect(mocks.verifyPassword).toHaveBeenCalledWith({ password: '2520' })
  );
}

async function selectMachineName() {
  fireEvent.click(screen.getByRole('button', { name: '機種名を選ぶ' }));
  const dialog = await screen.findByRole('dialog', { name: '機種名を選択' });
  fireEvent.click(
    await within(dialog).findByRole('button', { name: 'L300KP' })
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'この機種名を使用' })
  );
}

describe('KioskAssemblyTemplateEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDocuments.mockResolvedValue(documents);
    mocks.listCapabilityGroups.mockResolvedValue([capabilityGroupFixture()]);
    mocks.listMachineNameCandidates.mockResolvedValue({
      candidates: ['L300KP'],
      hasMore: false
    });
    mocks.getKioskDocumentDetail.mockResolvedValue({
      document: {
        id: KIOSK_DOCUMENT_ID,
        title: '旧PDF要領書',
        displayTitle: '旧PDF要領書'
      },
      pageUrls: ['/api/legacy-kiosk-1.png']
    });
    mocks.verifyPassword.mockResolvedValue({ success: true });
    mocks.createTemplate.mockImplementation(
      async (payload: AssemblyTemplateCreateInput) =>
        templateFixture({
          id: '33333333-3333-4333-8333-333333333333',
          modelCode: payload.modelCode,
          procedurePattern: payload.procedurePattern,
          name: payload.name
        })
    );
  });

  it('starts blank, does not select the first document, and keeps save disabled after only a machine name is selected', async () => {
    renderRoute('/kiosk/assembly/templates/new');
    await authenticate();

    expect(
      await screen.findByRole('heading', { name: '組立テンプレート新規' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '使用文書' })).toBeInTheDocument();
    expect(screen.queryByText('主手順書')).not.toBeInTheDocument();
    expect(screen.queryByText('旧形式を取込')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /文書を上へ/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存', exact: true })).toBeDisabled();

    await selectMachineName();

    expect(screen.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it('moves from an unfinished guide item to its field', async () => {
    renderRoute('/kiosk/assembly/templates/new');
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });

    fireEvent.click(
      screen.getByRole('button', { name: '手順パターンを入力してください。' })
    );

    await waitFor(() =>
      expect(
        document.getElementById('assembly-template-procedure-pattern')
      ).toHaveFocus()
    );
  });

  it('posts only after a complete clone is given a machine name and preserves its custom bolt display name', async () => {
    const source = templateFixture();
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/new?sourceTemplateId=${source.id}`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });

    expect(screen.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await selectMachineName();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));

    await waitFor(() =>
      expect(mocks.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          modelCode: 'L300KP',
          traceabilityMode: 'REQUIRED',
          accessPassword: '2520',
          areas: [
            expect.objectContaining({
              bolts: [
                expect.objectContaining({
                  boltSpec: '保存済み独自表記1',
                  capabilityGroupId: GROUP_ID
                })
              ]
            })
          ]
        })
      )
    );
  });

  it('requires confirmation with the affected bolt count before deleting an area', async () => {
    const source = templateFixture({
      areas: [
        areaFixture(),
        areaFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2)
      ]
    });
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/new?sourceTemplateId=${source.id}`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });

    fireEvent.click(screen.getByRole('button', { name: '工程1を削除' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/締付点1件も、すべての表示手順から削除/)
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: '工程を削除' })
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '工程1を削除' })).toBeDisabled()
    );
  });

  it('shows an inactive imported legacy template read-only without authentication', async () => {
    mocks.getTemplate.mockResolvedValue(
      templateFixture({
        modelCode: 'LEGACY-001',
        name: '旧版テンプレート',
        isActive: false,
        traceabilityMode: 'LEGACY',
        procedureSequence: {
          source: 'primary_fallback',
          items: []
        }
      })
    );

    renderRoute('/kiosk/assembly/templates/44444444-4444-4444-8444-444444444444/edit');

    expect(
      await screen.findByRole('heading', { name: '組立テンプレート編集' })
    ).toBeInTheDocument();
    expect(screen.getByText('表示のみ')).toBeInTheDocument();
    expect(screen.getByText('旧形式を取込')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('パスワード')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新しい版で保存' })).toBeDisabled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it('preserves an existing KioskDocument when revising an imported legacy sequence', async () => {
    const legacy = templateFixture({
      modelCode: 'LEGACY-IMPORT',
      name: '旧形式テンプレート',
      procedureSequence: {
        source: 'legacy_machine_order',
        stepSource: 'document_expansion',
        items: [
          procedureItem('legacy-primary', DOCUMENT_ID, '主手順書'),
          {
            id: 'legacy-kiosk',
            sortOrder: 1,
            label: '準備資料',
            documentType: 'kiosk_document',
            kioskDocumentId: KIOSK_DOCUMENT_ID,
            assemblyProcedureDocumentId: null,
            document: {
              id: KIOSK_DOCUMENT_ID,
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
        ],
        steps: [
          procedureStep('legacy-primary-step'),
          {
            ...procedureStep('legacy-kiosk-step', null, KIOSK_DOCUMENT_ID),
            sortOrder: 1
          }
        ]
      }
    });
    mocks.getTemplate.mockResolvedValue(legacy);
    mocks.reviseTemplate.mockResolvedValue({
      ...legacy,
      id: '77777777-7777-4777-8777-777777777777',
      version: 2
    });

    renderRoute(`/kiosk/assembly/templates/${legacy.id}/edit`);
    await authenticate();
    expect(await screen.findByText('旧形式を取込')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新しい版で保存' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: '新しい版で保存' }));

    await waitFor(() =>
      expect(mocks.reviseTemplate).toHaveBeenCalledWith(
        legacy.id,
        expect.objectContaining({
          procedureItems: expect.arrayContaining([
            expect.objectContaining({ assemblyProcedureDocumentId: DOCUMENT_ID }),
            expect.objectContaining({ kioskDocumentId: KIOSK_DOCUMENT_ID })
          ])
        })
      )
    );
  });
});
