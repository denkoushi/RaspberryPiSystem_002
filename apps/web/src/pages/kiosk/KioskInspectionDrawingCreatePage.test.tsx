import { buildDefaultInspectionDrawingMeasurementLabelSettings } from '@raspi-system/shared-types';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInspectionDrawingCreatePage } from './KioskInspectionDrawingCreatePage';

import type { createPartMeasurementTemplate } from '../../api/client';
import type { InspectionDrawingCanvas } from '../../features/part-measurement/inspection-drawing/InspectionDrawingCanvas';
import type {
  PartMeasurementDrawingOcrStatusDto,
  PartMeasurementTemplateDto,
  PartMeasurementVisualTemplateDto
} from '../../features/part-measurement/types';
import type { ComponentProps } from 'react';

const apiMocks = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  getVisual: vi.fn(),
  listVisuals: vi.fn(),
  labelSettings: vi.fn(),
  ocrStatus: vi.fn(),
  fhincdCandidates: vi.fn(),
  activeExists: vi.fn(),
  createTemplate: vi.fn(),
  reviseTemplate: vi.fn(),
  createGroup: vi.fn(),
  reviseGroup: vi.fn(),
  confirm: vi.fn()
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getResolvedClientKey: vi.fn(() => 'test-client-key'),
    getKioskInspectionDrawingTemplate: apiMocks.getTemplate,
    getPartMeasurementVisualTemplate: apiMocks.getVisual,
    listPartMeasurementVisualTemplates: apiMocks.listVisuals,
    listInspectionDrawingMeasurementLabelSettings: apiMocks.labelSettings,
    getPartMeasurementVisualTemplateOcrStatus: apiMocks.ocrStatus,
    listInspectionDrawingFhincdCandidates: apiMocks.fhincdCandidates,
    existsActivePartMeasurementTemplate: apiMocks.activeExists,
    createPartMeasurementTemplate: apiMocks.createTemplate,
    reviseKioskInspectionDrawingTemplate: apiMocks.reviseTemplate,
    createKioskInspectionDrawingTemplateGroup: apiMocks.createGroup,
    reviseKioskInspectionDrawingTemplateGroup: apiMocks.reviseGroup
  };
});

vi.mock('../../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks');
  return {
    ...actual,
    useKioskProductionScheduleResources: () => ({
      data: { resources: ['R001', 'R002'], resourceNameMap: {} }
    })
  };
});

vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', () => ({
  usePartMeasurementDrawingBlobUrl: (path: string | null) => ({
    blobUrl: path ? 'blob:test-drawing' : null,
    error: null
  })
}));

// Exercise the page's add-point callback without jsdom image geometry/pointer capture.
// The sidebar, metadata, validation and payload mapping remain real components/code.
vi.mock('../../features/part-measurement/inspection-drawing/InspectionDrawingCanvas', () => ({
  InspectionDrawingCanvas: ({ onAddPoint }: ComponentProps<typeof InspectionDrawingCanvas>) => (
    <button type="button" disabled={!onAddPoint} onClick={() => onAddPoint?.(0.25, 0.5)}>
      テスト用の測定点配置
    </button>
  )
}));

const visual: PartMeasurementVisualTemplateDto = {
  id: 'visual-1',
  name: '図面71-A61',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/visual-1.png',
  isActive: true,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z'
};

const template: PartMeasurementTemplateDto = {
  id: 'template-1',
  fhincd: 'PART-9000',
  resourceCd: 'R001',
  fkojun: '10',
  processGroup: 'cutting',
  templateScope: 'three_key',
  candidateFhinmei: null,
  name: '既存の検査テンプレート',
  version: 3,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: visual.id,
  visualTemplate: visual,
  siblingGroupId: null,
  siblingGroup: null,
  items: [{
    id: 'point-1',
    sortOrder: 0,
    datumSurface: '—',
    measurementPoint: '穴径',
    measurementLabel: '穴径',
    displayMarker: '1',
    unit: null,
    allowNegative: true,
    decimalPlaces: 3,
    markerXRatio: '0.25',
    markerYRatio: '0.5',
    nominalValue: '10',
    lowerLimit: '9.9',
    upperLimit: '10.1'
  }]
};

const ocrStatus: PartMeasurementDrawingOcrStatusDto = {
  id: 'ocr-1',
  visualTemplateId: visual.id,
  status: 'failed',
  ocrVersion: 'v1',
  drawingImageFingerprint: 'test-fingerprint',
  engine: null,
  imageWidth: null,
  imageHeight: null,
  tokenCount: 0,
  payloadBytes: 0,
  queuePriority: 0,
  attemptCount: 1,
  failureReason: 'OCR unavailable',
  ocrStartedAt: null,
  ocrFinishedAt: null,
  lastQueuedAt: null,
  nextAttemptAt: null,
  updatedAt: visual.updatedAt
};

// Explicit expected values: do not derive the oracle using the page's mapper.
const expectedItem = {
  sortOrder: 0,
  datumSurface: '—',
  measurementPoint: '穴径',
  measurementLabel: '穴径',
  displayMarker: '1',
  unit: null,
  allowNegative: true,
  decimalPlaces: 3,
  markerXRatio: 0.25,
  markerYRatio: 0.5,
  calloutTipXRatio: null,
  calloutTipYRatio: null,
  nominalValue: 10,
  lowerLimit: 9.9,
  upperLimit: 10.1,
  depthMode: 'measured',
  valueKind: 'numeric'
} satisfies Parameters<typeof createPartMeasurementTemplate>[0]['items'][number] & {
  calloutTipXRatio: null;
  calloutTipYRatio: null;
  depthMode: 'measured';
  valueKind: 'numeric';
};

const createPath = '/kiosk/part-measurement/inspection/create';
const editPath = '/kiosk/part-measurement/inspection/templates/template-1/edit';

async function renderPage(path = createPath) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={createPath} element={<KioskInspectionDrawingCreatePage />} />
          <Route
            path="/kiosk/part-measurement/inspection/templates/:templateId/edit"
            element={<KioskInspectionDrawingCreatePage />}
          />
        </Routes>
      </MemoryRouter>
    );
  });
}

function pointList() {
  return within(screen.getByRole('list', { name: '測定点一覧' }));
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  });
}

async function fillNewDrawing() {
  await renderPage(`${createPath}?visualTemplateId=visual-1`);
  fireEvent.change(screen.getByRole('combobox', { name: '品番' }), { target: { value: ' PART-NEW ' } });
  fireEvent.click(screen.getByRole('button', { name: '選択' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'R001' }));
  fireEvent.click(screen.getByRole('button', { name: '決定' }));
  fireEvent.click(screen.getByRole('button', { name: 'テスト用の測定点配置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '名称' }), { target: { value: '穴径' } });
  fireEvent.change(screen.getByRole('textbox', { name: '基準値' }), { target: { value: '10' } });
  fireEvent.change(screen.getByRole('textbox', { name: '上限公差' }), { target: { value: '+0.1' } });
  fireEvent.change(screen.getByRole('textbox', { name: '下限公差' }), { target: { value: '-0.1' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe('KioskInspectionDrawingCreatePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    apiMocks.getTemplate.mockResolvedValue(template);
    apiMocks.getVisual.mockResolvedValue(visual);
    apiMocks.listVisuals.mockResolvedValue([visual]);
    apiMocks.labelSettings.mockResolvedValue(buildDefaultInspectionDrawingMeasurementLabelSettings());
    // A terminal OCR state keeps manual entry available without polling/candidate requests.
    apiMocks.ocrStatus.mockResolvedValue(ocrStatus);
    apiMocks.fhincdCandidates.mockResolvedValue([]);
    apiMocks.activeExists.mockResolvedValue(false);
    apiMocks.confirm.mockReturnValue(true);
    vi.stubGlobal('confirm', apiMocks.confirm);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders a blank new drawing with metadata, drawing controls and an empty point list', async () => {
    await renderPage();

    expect(screen.getByText('新規作成 — 品番・工程・資源CDごとに1テンプレートです。')).toBeVisible();
    expect(screen.getByRole('combobox', { name: '品番' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'テンプレ' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '工順 (FKOJUN)' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '検査数' })).toHaveValue('full');
    expect(screen.getByRole('button', { name: '切削' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '図面ソースを選択' })).toHaveTextContent('未選択');
    expect(screen.getByText('図面を選ぶとここに表示されます')).toBeVisible();
    expect(screen.getByText('測定点一覧')).toBeVisible();
    expect(screen.getByText('測定点がありません。図面上で点を置いてください。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'テスト入力' })).toBeDisabled();
    expect(apiMocks.getTemplate).not.toHaveBeenCalled();
  });

  it('loads an edit route into locked metadata, editable fields and the selected marker', async () => {
    await renderPage(editPath);

    expect(apiMocks.getTemplate).toHaveBeenCalledWith('template-1', 'test-client-key');
    expect(screen.getByText('PART-9000')).toBeVisible();
    expect(screen.getByText('R001')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: '品番' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '工順 (FKOJUN)' })).toHaveValue('10');
    expect(screen.getByRole('textbox', { name: '工順 (FKOJUN)' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'テンプレ' })).toHaveValue(template.name);
    expect(screen.getByRole('combobox', { name: '工程' })).toHaveValue('cutting');
    expect(screen.getByText('v3 · 有効')).toBeVisible();
    expect(screen.getByRole('button', { name: '図面ソースを選択' })).toHaveTextContent(`既存: ${visual.name}`);
    expect(pointList().getByRole('button', { name: /No\.1.*穴径/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '名称' })).toHaveValue('穴径');
    expect(screen.getByRole('textbox', { name: '基準値' })).toHaveValue('10');
    expect(screen.getByRole('textbox', { name: '上限公差' })).toHaveValue('0.1');
    expect(screen.getByRole('textbox', { name: '下限公差' })).toHaveValue('-0.1');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByText('保存済み')).toBeVisible();
  });

  it('loads sourceTemplateId as a new draft with an automatic name and a same-key save block', async () => {
    await renderPage(`${createPath}?sourceTemplateId=template-1`);

    expect(apiMocks.getTemplate).toHaveBeenCalledWith('template-1', 'test-client-key');
    expect(screen.getByText(/雛形から新規作成/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: '品番' })).toHaveValue(template.fhincd);
    expect(screen.getByRole('textbox', { name: 'テンプレ' })).toHaveValue(`${visual.name} ${template.fhincd}`);
    expect(screen.getByRole('button', { name: 'R001' })).toBeEnabled();
    expect(pointList().getByRole('button', { name: /No\.1.*穴径/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(apiMocks.createTemplate).not.toHaveBeenCalled();
  });

  it('adds an unnamed point, selects it and removes only that point', async () => {
    await renderPage(editPath);
    fireEvent.click(screen.getByRole('button', { name: 'テスト用の測定点配置' }));

    expect(pointList().getAllByRole('button')).toHaveLength(2);
    expect(pointList().getByRole('button', { name: /No\.2.*名称未選択/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '名称' })).toHaveValue('');
    expect(screen.getByText('2番: 名称未入力')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '一点削除' }));
    expect(pointList().getAllByRole('button')).toHaveLength(1);
    expect(pointList().getByRole('button', { name: /No\.1.*穴径/ })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: '名称' })).not.toBeInTheDocument();
    expect(apiMocks.reviseTemplate).not.toHaveBeenCalled();
  });

  it('updates a selected point field in the list and marks the form unsaved', async () => {
    await renderPage(editPath);
    fireEvent.change(screen.getByRole('textbox', { name: '基準値' }), { target: { value: '12' } });

    expect(screen.getByRole('textbox', { name: '基準値' })).toHaveValue('12');
    expect(pointList().getByRole('button')).toHaveTextContent('基準 12');
    expect(screen.getByText('未保存あり')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('confirms clearing all points and blocks saving the empty list', async () => {
    await renderPage(editPath);
    apiMocks.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '全削除' }));
    expect(pointList().getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '全削除' }));
    expect(apiMocks.confirm).toHaveBeenLastCalledWith('すべての測定点を削除します。続行しますか？');
    expect(screen.getByText('測定点がありません。図面上で点を置いてください。')).toBeVisible();
    expect(screen.getByText('測定点なし')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    await save();
    expect(apiMocks.reviseTemplate).not.toHaveBeenCalled();
  });

  it('creates a single-resource template with the automatic name and explicit numeric item payload', async () => {
    const created: PartMeasurementTemplateDto = {
      ...template, fhincd: 'PART-NEW', fkojun: '', name: `${visual.name} PART-NEW`
    };
    apiMocks.createTemplate.mockResolvedValue(created);
    apiMocks.getTemplate.mockResolvedValue(created);
    await fillNewDrawing();

    expect(apiMocks.getVisual).toHaveBeenCalledWith('visual-1', 'test-client-key');
    expect(apiMocks.activeExists).toHaveBeenCalledWith(
      { fhincd: 'PART-NEW', processGroup: 'cutting', resourceCd: 'R001', fkojun: '' },
      'test-client-key'
    );
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    await save();

    expect(apiMocks.createTemplate).toHaveBeenCalledExactlyOnceWith({
      templateScope: 'three_key',
      fhincd: 'PART-NEW',
      resourceCd: 'R001',
      processGroup: 'cutting',
      fkojun: '',
      name: `${visual.name} PART-NEW`,
      visualTemplateId: 'visual-1',
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      failIfActiveExists: true,
      items: [expectedItem]
    }, 'test-client-key');
    expect(apiMocks.reviseTemplate).not.toHaveBeenCalled();
    expect(apiMocks.createGroup).not.toHaveBeenCalled();
    expect(screen.getByText('PART-NEW')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'テンプレ' })).toHaveValue(created.name);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('revises the existing template with changed name, inspection count and item bounds', async () => {
    const revised: PartMeasurementTemplateDto = {
      ...template, name: '改版後', version: 4, selfInspectionMode: 'fixed_count',
      selfInspectionFixedCount: 2, selfInspectionSampleSize: 2,
      items: [{ ...template.items[0]!, nominalValue: '12', lowerLimit: '11.9', upperLimit: '12.1' }]
    };
    apiMocks.reviseTemplate.mockResolvedValue(revised);
    await renderPage(editPath);
    fireEvent.change(screen.getByRole('textbox', { name: 'テンプレ' }), { target: { value: ' 改版後 ' } });
    fireEvent.change(screen.getByRole('combobox', { name: '検査数' }), { target: { value: 'fixed_count' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '指定数' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('textbox', { name: '基準値' }), { target: { value: '12' } });
    await save();

    expect(apiMocks.reviseTemplate).toHaveBeenCalledExactlyOnceWith('template-1', {
      name: '改版後',
      visualTemplateId: 'visual-1',
      selfInspectionMode: 'fixed_count',
      selfInspectionFixedCount: 2,
      detachFromSiblingGroup: false,
      items: [{ ...expectedItem, nominalValue: 12, lowerLimit: 11.9, upperLimit: 12.1 }]
    }, 'test-client-key');
    expect(apiMocks.createTemplate).not.toHaveBeenCalled();
    expect(apiMocks.reviseGroup).not.toHaveBeenCalled();
    expect(screen.getByText('保存しました。履歴から旧版を確認できます。')).toBeVisible();
    expect(screen.getByText('v4 · 有効')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('blocks a new template with missing fhincd even when the drawing and item are ready', async () => {
    await fillNewDrawing();
    fireEvent.change(screen.getByRole('combobox', { name: '品番' }), { target: { value: '' } });

    expect(screen.getByText('品番未入力')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    await save();
    expect(apiMocks.createTemplate).not.toHaveBeenCalled();
    expect(apiMocks.createGroup).not.toHaveBeenCalled();
  });

  it('blocks fixed-count inspection until its required count is supplied', async () => {
    await renderPage(editPath);
    fireEvent.change(screen.getByRole('combobox', { name: '検査数' }), { target: { value: 'fixed_count' } });

    expect(screen.getByText('指定数では検査件数を入力してください')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    await save();
    expect(apiMocks.reviseTemplate).not.toHaveBeenCalled();
  });

  it.each([
    [{ response: { data: { message: '改版を保存できませんでした。' } } }, '改版を保存できませんでした。'],
    [new Error('offline'), '保存に失敗しました。']
  ])('shows save API error %j and keeps the edited form available', async (error, message) => {
    apiMocks.reviseTemplate.mockRejectedValue(error);
    await renderPage(editPath);
    fireEvent.change(screen.getByRole('textbox', { name: 'テンプレ' }), { target: { value: '未保存の名前' } });
    await save();

    expect(apiMocks.reviseTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'テンプレ' })).toHaveValue('未保存の名前');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByText('未保存あり')).toBeVisible();
  });
});
