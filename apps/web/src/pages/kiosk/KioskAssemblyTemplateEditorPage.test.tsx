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
  listTorqueWrenches: vi.fn(),
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
  listTorqueWrenches: mocks.listTorqueWrenches,
  reviseAssemblyTemplate: mocks.reviseTemplate,
  verifyAssemblyTemplateAccessPassword: mocks.verifyPassword
}));

vi.mock('../../features/assembly/AssemblyProcedureCanvas', () => ({
  AssemblyProcedureCanvas: ({
    bolts,
    onSelectBolt
  }: {
    bolts: Array<{ id: string }>;
    onSelectBolt?: (id: string) => void;
  }) => (
    <div data-testid="assembly-procedure-canvas">
      {bolts[0] && onSelectBolt ? (
        <button type="button" onClick={() => onSelectBolt(bolts[0]!.id)}>
          テスト締付マーカーを選択
        </button>
      ) : null}
    </div>
  )
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

function clickLeftPaneDocuments() {
  const toggle = within(
    screen.getByTestId('assembly-template-editor-left-pane')
  ).getByLabelText('文書・工程');
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

function clickLeftPaneSteps() {
  const buttons = within(
    screen.getByTestId('assembly-template-editor-left-pane')
  ).getAllByRole('button', { name: '手順', exact: true });
  fireEvent.click(buttons[0]!);
}

async function selectMachineName(candidate = 'L300KP') {
  fireEvent.click(screen.getByRole('button', { name: '機種名を選ぶ' }));
  const dialog = await screen.findByRole('dialog', { name: '機種名を選択' });
  fireEvent.click(
    await within(dialog).findByRole('button', { name: candidate, exact: true })
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
    mocks.listTorqueWrenches.mockResolvedValue([]);
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

  it('preserves the authentication failure message and keeps the editor locked', async () => {
    mocks.verifyPassword.mockResolvedValue({ success: false });
    renderRoute('/kiosk/assembly/templates/new');

    await authenticate();

    expect(await screen.findByText('パスワードが違います。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('パスワード')).toHaveValue('2520');
    expect(screen.queryByTestId('assembly-template-editor-header')).not.toBeInTheDocument();
  });

  it('preserves the editor data load failure message without exposing the workspace', async () => {
    mocks.listDocuments.mockRejectedValue(new Error('load failed'));
    renderRoute('/kiosk/assembly/templates/new');

    expect(await screen.findByText('load failed')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-unified-editor-workspace')).not.toBeInTheDocument();
  });

  it('starts blank, does not select the first document, and keeps save disabled after only a machine name is selected', async () => {
    renderRoute('/kiosk/assembly/templates/new');
    await authenticate();

    expect(
      await screen.findByRole('heading', { name: '組立テンプレート新規' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '使用文書' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '基本設定' })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /未完了 \d+件/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'テンプレート名を入力してください。' })
    );

    await waitFor(() =>
      expect(
        document.getElementById('assembly-template-name')
      ).toHaveFocus()
    );
  });

  it('keeps optional details closed without clearing stored values or dirtying the draft', async () => {
    const source = templateFixture();
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート編集' });
    fireEvent.click(screen.getByRole('button', { name: '文書/工程', exact: true }));
    clickLeftPaneDocuments();
    const header = screen.getByTestId('assembly-template-editor-header');
    await waitFor(() => expect(within(header).getByText('保存済み')).toBeInTheDocument());
    expect(screen.queryByLabelText('工程No.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '詳細（任意）' }));
    expect(screen.getByLabelText('工程No.')).toHaveValue(source.areas[0]!.processNo);
    fireEvent.click(screen.getByRole('button', { name: '詳細（任意）' }));
    clickLeftPaneSteps();
    clickLeftPaneDocuments();
    expect(screen.queryByLabelText('工程No.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '詳細（任意）' }));
    expect(screen.getByLabelText('工程No.')).toHaveValue(source.areas[0]!.processNo);
    expect(within(header).getByText('保存済み')).toBeInTheDocument();
  });

  it('opens optional details and focuses a field with an overlength value', async () => {
    const source = templateFixture();
    source.areas[0]!.processNo = 'X'.repeat(81);
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート編集' });
    fireEvent.click(screen.getByRole('button', { name: /未完了 \d+件/ }));
    fireEvent.click(screen.getByRole('button', { name: '工程の入力値が最大文字数を超えています。' }));
    await waitFor(() => expect(screen.getByLabelText('工程No.')).toHaveFocus());
    expect(screen.getByRole('button', { name: '詳細（任意）' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('selects and expands the document details when its display label is invalid', async () => {
    const source = templateFixture();
    source.procedureSequence!.items[0]!.label = 'X'.repeat(121);
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート編集' });
    fireEvent.click(screen.getByRole('button', { name: '文書/工程', exact: true }));
    clickLeftPaneDocuments();
    fireEvent.click(screen.getByRole('button', { name: /未完了 \d+件/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '文書の表示ラベルは120文字以内にしてください。'
      })
    );

    await waitFor(() => expect(screen.getByLabelText('表示ラベル')).toHaveFocus());
    expect(screen.getByRole('button', { name: '詳細（任意）' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('scrolls newly expanded optional details into view without scrolling on collapse', async () => {
    const source = templateFixture();
    mocks.getTemplate.mockResolvedValue(source);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
      await authenticate();
      await screen.findByRole('heading', { name: '組立テンプレート編集' });
      fireEvent.click(screen.getByRole('button', { name: '文書/工程', exact: true }));
      clickLeftPaneDocuments();

      const toggle = screen.getByRole('button', { name: '詳細（任意）' });
      fireEvent.click(toggle);
      const details = document.getElementById(
        `assembly-area-details-${source.areas[0]!.id}`
      );
      expect(details).not.toBeNull();
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: 'nearest',
          behavior: 'auto'
        });
        expect(scrollIntoView.mock.contexts).toContain(details);
      });
      const callsAfterExpand = scrollIntoView.mock.calls.length;

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(scrollIntoView).toHaveBeenCalledTimes(callsAfterExpand);
    } finally {
      if (originalScrollIntoView) {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  it('remembers details disclosure independently for each area', async () => {
    const source = templateFixture({ areas: [areaFixture(), areaFixture('area-second', 2)] });
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート編集' });
    fireEvent.click(screen.getByRole('button', { name: '文書/工程', exact: true }));
    clickLeftPaneDocuments();
    fireEvent.click(screen.getByRole('button', { name: '詳細（任意）' }));
    fireEvent.click(screen.getByRole('button', { name: /^20-A2/ }));
    expect(screen.queryByLabelText('工程No.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^10-A1/ }));
    expect(screen.getByLabelText('工程No.')).toHaveValue('10');
  });

  it('opens the right inspector when the operator requests step notes', async () => {
    renderRoute(`/kiosk/assembly/templates/new?procedureDocumentId=${DOCUMENT_ID}`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '注意・補足' })).toBeEnabled()
    );
    expect(screen.queryByTestId('assembly-editor-settings-pane')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '注意・補足' }));
    expect(await screen.findByTestId('assembly-editor-settings-pane')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '設定を閉じる' }));
    expect(screen.queryByTestId('assembly-editor-settings-pane')).not.toBeInTheDocument();
  });

  it('keeps the step inspector available when page navigation clears marker selection', async () => {
    const source = templateFixture();
    mocks.getTemplate.mockResolvedValue(source);
    renderRoute(`/kiosk/assembly/templates/new?sourceTemplateId=${source.id}`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });

    fireEvent.click(screen.getByRole('button', { name: 'テスト締付マーカーを選択' }));
    expect(await screen.findByTestId('assembly-editor-settings-pane')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次頁' }));

    await waitFor(() =>
      expect(screen.getByTestId('assembly-editor-settings-pane')).toBeInTheDocument()
    );
  });

  it('suggests a template name, preserves a manual override, and can restore automation', async () => {
    renderRoute('/kiosk/assembly/templates/new');
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });
    const initialPattern = document.getElementById(
      'assembly-template-procedure-pattern'
    ) as HTMLInputElement;
    expect(initialPattern).toBeInstanceOf(HTMLInputElement);
    expect(initialPattern).toHaveValue('標準');
    await selectMachineName();

    const pattern = document.getElementById(
      'assembly-template-procedure-pattern'
    ) as HTMLInputElement;
    const name = document.getElementById('assembly-template-name') as HTMLTextAreaElement;
    expect(pattern).toBeInstanceOf(HTMLInputElement);
    expect(name).toBeInstanceOf(HTMLTextAreaElement);
    expect(name).toHaveAttribute('rows', '3');
    expect(name).toHaveClass('break-all');
    fireEvent.change(pattern, { target: { value: '標準' } });
    expect(name).toHaveValue('L300KP 標準 組立');

    fireEvent.change(name, { target: { value: '現場向け名称' } });
    fireEvent.change(pattern, { target: { value: '夜勤' } });
    expect(name).toHaveValue('現場向け名称');
    fireEvent.click(screen.getByRole('button', { name: '自動提案に戻す' }));
    expect(name).toHaveValue('L300KP 夜勤 組立');
  });

  it('renders a selected full-width machine name in half-width while preserving raw titles and save values', async () => {
    const rawMachineName = 'Ｌ３００ＫＰ';
    const rawProcedurePattern = '標準 ＡＢＣ１２３';
    const rawTemplateName = '組立テンプレート ＡＢＣ１２３';
    const rawDocumentTitle = '主手順書 ＡＢＣ１２３';
    const source = templateFixture({
      procedurePattern: rawProcedurePattern,
      name: rawTemplateName,
      procedureSequence: {
        source: 'template_version',
        stepSource: 'template_steps',
        items: [procedureItem('item-primary', DOCUMENT_ID, rawDocumentTitle)],
        steps: [procedureStep('step-primary')]
      }
    });
    mocks.getTemplate.mockResolvedValue(source);
    mocks.listMachineNameCandidates.mockResolvedValue({
      candidates: [rawMachineName],
      hasMore: false
    });

    renderRoute(`/kiosk/assembly/templates/new?sourceTemplateId=${source.id}`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート新規' });
    await selectMachineName(rawMachineName);

    const machineDisplay = screen.getByTitle(rawMachineName);
    expect(machineDisplay).toHaveTextContent('L300KP');
    expect(
      screen.getByRole('button', { name: '変更', exact: true })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '機種名を変更', exact: true })
    ).not.toBeInTheDocument();

    const pattern = document.getElementById(
      'assembly-template-procedure-pattern'
    ) as HTMLInputElement;
    const name = document.getElementById('assembly-template-name') as HTMLTextAreaElement;
    expect(pattern).toBeInstanceOf(HTMLInputElement);
    expect(name).toBeInstanceOf(HTMLTextAreaElement);
    expect(name).toHaveAttribute('rows', '3');
    expect(pattern).toHaveValue(rawProcedurePattern);
    expect(pattern).toHaveAttribute('title', rawProcedurePattern);
    expect(name).toHaveValue(`${rawTemplateName} 複製`);
    expect(name).toHaveAttribute('title', `${rawTemplateName} 複製`);

    const documentCard = document.querySelector(
      '[id^="assembly-document-"]'
    ) as HTMLElement;
    const documentTitle = documentCard.querySelector('span[title]');
    expect(documentTitle).not.toBeNull();
    expect(documentTitle).toHaveAttribute('title', rawDocumentTitle);
    expect(documentTitle).toHaveTextContent('主手順書 ABC123');

    const saveButton = screen.getByRole('button', { name: '保存', exact: true });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(mocks.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          modelCode: rawMachineName,
          procedurePattern: rawProcedurePattern,
          name: `${rawTemplateName} 複製`
        })
      )
    );
  });

  it('moves document label editing into optional area details without dirtying or changing the raw label', async () => {
    const rawLabel = '表示ラベル ＡＢＣ１２３';
    const source = templateFixture();
    source.procedureSequence!.items[0]!.label = rawLabel;
    mocks.getTemplate.mockResolvedValue(source);

    renderRoute(`/kiosk/assembly/templates/${source.id}/edit`);
    await authenticate();
    await screen.findByRole('heading', { name: '組立テンプレート編集' });
    fireEvent.click(screen.getByRole('button', { name: '文書/工程', exact: true }));
    clickLeftPaneDocuments();

    const header = screen.getByTestId('assembly-template-editor-header');
    await waitFor(() =>
      expect(within(header).getByText('保存済み')).toBeInTheDocument()
    );
    const documentCard = document.querySelector(
      '[id^="assembly-document-"]'
    ) as HTMLElement;
    const detailsButton = screen.getByRole('button', {
      name: '詳細（任意）',
      exact: true
    });

    expect(within(documentCard).queryByRole('button', { name: '詳細' })).not.toBeInTheDocument();
    expect(within(documentCard).getByRole('button', { name: /を削除$/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('表示ラベル')).not.toBeInTheDocument();
    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('表示ラベル')).toHaveValue(rawLabel);
    const labelDisplay = documentCard.querySelector('span[title]');
    expect(labelDisplay).toHaveAttribute('title', rawLabel);
    expect(labelDisplay).toHaveTextContent('表示ラベル ABC123');

    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('表示ラベル')).not.toBeInTheDocument();
    expect(within(header).getByText('保存済み')).toBeInTheDocument();

    fireEvent.click(detailsButton);
    expect(screen.getByLabelText('表示ラベル')).toHaveValue(rawLabel);
    expect(within(header).getByText('保存済み')).toBeInTheDocument();
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
      procedurePattern: '改版 ＡＢＣ１２３',
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
          procedurePattern: '改版 ＡＢＣ１２３',
          procedureItems: expect.arrayContaining([
            expect.objectContaining({ assemblyProcedureDocumentId: DOCUMENT_ID }),
            expect.objectContaining({ kioskDocumentId: KIOSK_DOCUMENT_ID })
          ])
        })
      )
    );
  });
});
