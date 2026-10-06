import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyTemplateEditorCanvasToolbar } from './AssemblyTemplateEditorCanvasToolbar';

import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ controller: {} as Record<string, unknown> }));
vi.mock('./AssemblyTemplateEditorContext', () => ({
  useAssemblyTemplateEditor: () => mocks.controller,
  useAssemblyTemplateEditorNavigation: () => ({
    renderLink: ({ children, to, ...props }: { children: ReactNode; to: string; className: string }) => <a href={to} {...props}>{children}</a>
  })
}));

function controller(overrides: Record<string, unknown> = {}) {
  return {
    busy: false, readOnly: false, readiness: { isReady: true },
    selectedPage: { key: 'page-1', imageRelativePath: '/page.png' }, selectedDocument: null,
    selectedPageIndex: 0, pageOptions: [{ key: 'page-1' }, { key: 'page-2' }],
    procedureSteps: [], selectedStep: { viewMode: 'full_page' },
    selectedStepPage: { key: 'page-1' },
    markerMode: 'bolt', placementAction: 'place', inspectorMode: 'closed',
    settingsPaneOpen: false, stepSupplementOpen: false, boltConditionPaneOpen: false,
    saveTemplate: vi.fn(), addCurrentFullPageStep: vi.fn(),
    setMarkerMode: vi.fn(), setPlacementAction: vi.fn(),
    setSelectedCheckItemId: vi.fn(), setSelectedBoltId: vi.fn(),
    setShowFullPage: vi.fn(), setSelectedPageKey: vi.fn(),
    setStepSupplementOpen: vi.fn(), setInspectorMode: vi.fn(),
    setBoltConditionPaneOpen: vi.fn(),
    canvasZoom: { zoomOut: vi.fn(), zoomIn: vi.fn(), fitToView: vi.fn() },
    ...overrides
  };
}

describe('template editor symbol rail', () => {
  beforeEach(() => { mocks.controller = controller(); });

  it('keeps the specified order, Japanese accessible names and bottom return link', () => {
    render(<AssemblyTemplateEditorCanvasToolbar />);
    const rail = screen.getByRole('navigation', { name: 'テンプレート操作' });
    expect(within(rail).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      '保存', '締結', 'チェック', '矩形', '全体追加', '締付条件', '注意・補足', '縮小', '拡大', '全体', '前頁', '次頁'
    ]);
    const back = within(rail).getByRole('link', { name: '一覧へ戻る' });
    expect(back).toHaveAttribute('href', '/kiosk/assembly/library');
    expect(back.parentElement).toHaveClass('mt-auto', 'pb-[84px]');
    expect(screen.getByRole('button', { name: '前頁' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '締結' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    { settingsPaneOpen: true, stepSupplementOpen: true, inspectorMode: 'bolt', pressed: 'true' },
    { settingsPaneOpen: true, stepSupplementOpen: false, inspectorMode: 'step', pressed: 'false' },
    { settingsPaneOpen: false, stepSupplementOpen: true, inspectorMode: 'step', pressed: 'false' }
  ])('reflects notes visibility with $inspectorMode mode and supplement $stepSupplementOpen', ({ pressed, ...state }) => {
    mocks.controller = controller(state);
    render(<AssemblyTemplateEditorCanvasToolbar />);
    expect(screen.getByRole('button', { name: '注意・補足', exact: true })).toHaveAttribute('aria-pressed', pressed);
  });

  it('routes save, placement, conditions, notes, zoom and page navigation to existing actions', () => {
    const c = mocks.controller;
    render(<AssemblyTemplateEditorCanvasToolbar />);
    for (const name of ['保存', 'チェック', '締結', '全体追加', '締付条件', '注意・補足', '縮小', '拡大', '全体', '次頁']) fireEvent.click(screen.getByRole('button', { name, exact: true }));
    expect(c.saveTemplate).toHaveBeenCalledOnce();
    expect(c.addCurrentFullPageStep).toHaveBeenCalledOnce();
    expect(c.setMarkerMode).toHaveBeenNthCalledWith(1, 'check');
    expect(c.setMarkerMode).toHaveBeenNthCalledWith(2, 'bolt');
    expect(c.setSelectedBoltId).toHaveBeenCalledWith(null);
    expect(c.setSelectedCheckItemId).toHaveBeenCalledWith(null);
    expect(c.setBoltConditionPaneOpen).toHaveBeenCalledWith(true);
    expect(c.setInspectorMode).toHaveBeenCalledWith('step');
    expect(c.setStepSupplementOpen).toHaveBeenCalledWith(true);
    const zoom = c.canvasZoom as ReturnType<typeof controller>['canvasZoom'];
    expect(zoom.zoomOut).toHaveBeenCalledOnce();
    expect(zoom.zoomIn).toHaveBeenCalledOnce();
    expect(zoom.fitToView).toHaveBeenCalledOnce();
    expect(c.setSelectedPageKey).toHaveBeenCalledWith('page-2');
  });

  it('closes notes from the symbol rail when they are already visible', () => {
    mocks.controller = controller({ settingsPaneOpen: true, stepSupplementOpen: true });
    render(<AssemblyTemplateEditorCanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '注意・補足', exact: true }));
    expect(mocks.controller.setStepSupplementOpen).toHaveBeenCalledWith(false);
    expect(mocks.controller.setInspectorMode).not.toHaveBeenCalled();
  });

  it('includes crop range correction in rectangle mode even at the step limit', () => {
    mocks.controller = controller({ selectedStep: { viewMode: 'crop' }, procedureSteps: Array(300), placementAction: 'crop' });
    render(<AssemblyTemplateEditorCanvasToolbar />);
    const crop = screen.getByRole('button', { name: '矩形' });
    expect(crop).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '範囲修正' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全体追加' })).toBeDisabled();
    fireEvent.click(crop);
    expect(mocks.controller.setShowFullPage).toHaveBeenCalledWith(true);
    expect(mocks.controller.setSelectedPageKey).toHaveBeenCalledWith('page-1');
    expect(mocks.controller.setInspectorMode).toHaveBeenCalledWith('step');
  });

  it('adds a rectangle on the displayed page when a crop on another page remains selected', () => {
    mocks.controller = controller({ selectedStep: { viewMode: 'crop' }, selectedPage: { key: 'page-2', imageRelativePath: '/page-2.png' } });
    render(<AssemblyTemplateEditorCanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '矩形' }));
    expect(mocks.controller.setPlacementAction).toHaveBeenCalledWith('crop');
    expect(mocks.controller.setShowFullPage).toHaveBeenCalledWith(true);
    expect(mocks.controller.setSelectedPageKey).not.toHaveBeenCalled();
    expect(mocks.controller.setInspectorMode).not.toHaveBeenCalled();
  });

  it('retains readonly and readiness gates while allowing navigation and zoom', () => {
    mocks.controller = controller({ readOnly: true, templateId: 'template-1', selectedPageIndex: 1, readiness: { isReady: false } });
    render(<AssemblyTemplateEditorCanvasToolbar />);
    for (const name of ['新しい版で保存', '締結', 'チェック', '矩形', '全体追加', '次頁']) expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
    for (const name of ['前頁', '拡大', '縮小', '全体']) expect(screen.getByRole('button', { name, exact: true })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '前頁' }));
    expect(mocks.controller.setSelectedPageKey).toHaveBeenCalledWith('page-1');
  });
});
