import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';

import { useAssemblyTemplateEditor, useAssemblyTemplateEditorNavigation } from './AssemblyTemplateEditorContext';

import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  bolt: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  crop: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />,
  full: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></>,
  condition: <path d="M4 7h16M4 12h10M4 17h7" />,
  note: <><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  previous: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />
};
const icon = (name: string) => <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
const buttonClass = 'grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] disabled:opacity-40 aria-pressed:bg-[#27313b]';

export function AssemblyTemplateEditorCanvasToolbar() {
  const c = useAssemblyTemplateEditor();
  const { renderLink } = useAssemblyTemplateEditorNavigation();
  const editingCrop = c.selectedStep?.viewMode === 'crop' && c.selectedStepPage?.key === c.selectedPage?.key;
  const enabled = Boolean(c.selectedPage?.imageRelativePath ?? c.selectedDocument?.imageRelativePath);
  const button = (label: string, name: string, onClick: () => void, options: { disabled?: boolean; pressed?: boolean; color?: string; target?: string } = {}) => (
    <button type="button" aria-label={label} title={label} aria-pressed={options.pressed} disabled={options.disabled} data-kiosk-sop-target={options.target} onClick={onClick} className={`${buttonClass} ${options.color ?? ''}`}>
      {icon(name)}
    </button>
  );
  const separator = <span aria-hidden="true" className="my-1 h-px w-9 shrink-0 bg-[#344252]" />;
  return (
    <nav aria-label="テンプレート操作" data-testid="assembly-editor-toolbar" className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] py-2.5">
      {button(c.busy ? '保存中…' : c.templateId ? '新しい版で保存' : '保存', 'save', () => void c.saveTemplate(), { disabled: c.busy || c.readOnly || !c.readiness.isReady, color: '!border-[#3ba776] bg-[#3ba776] text-[#0b1a12]', target: 'assembly-editor-save' })}
      {separator}
      {button('締結', 'bolt', () => {
        c.setMarkerMode('bolt');
        c.setPlacementAction('place');
        c.setSelectedCheckItemId(null);
      }, { disabled: c.readOnly, pressed: c.markerMode === 'bolt' && c.placementAction === 'place', color: '!border-[#f6b93b] text-[#f6b93b]', target: 'assembly-editor-marker-bolt' })}
      {button('チェック', 'check', () => {
        c.setMarkerMode('check');
        c.setPlacementAction('place');
        c.setSelectedBoltId(null);
      }, { disabled: c.readOnly, pressed: c.markerMode === 'check' && c.placementAction === 'place', target: 'assembly-editor-marker-check' })}
      {button('矩形', 'crop', () => {
        c.setPlacementAction('crop');
        c.setShowFullPage(true);
        if (editingCrop && c.selectedStepPage) {
          c.setSelectedPageKey(c.selectedStepPage.key);
          c.setStepSupplementOpen(true);
          c.setInspectorMode('step');
        }
      }, { disabled: c.readOnly || !c.selectedPage || (c.procedureSteps.length >= 300 && !editingCrop), pressed: c.placementAction === 'crop', target: 'assembly-editor-step-add-crop' })}
      {button('全体追加', 'full', c.addCurrentFullPageStep, { disabled: c.readOnly || !c.selectedPage || c.procedureSteps.length >= 300, target: 'assembly-editor-step-add-full' })}
      {separator}
      {button('締付条件', 'condition', () => c.setBoltConditionPaneOpen(!c.boltConditionPaneOpen), { pressed: c.boltConditionPaneOpen })}
      {button('注意・補足', 'note', () => {
        const open = !(c.settingsPaneOpen && c.stepSupplementOpen);
        c.setStepSupplementOpen(open);
        if (open) c.setInspectorMode('step');
      }, { disabled: !c.selectedStep, pressed: c.settingsPaneOpen && c.stepSupplementOpen })}
      {separator}
      {button('縮小', 'minus', c.canvasZoom.zoomOut, { disabled: !enabled })}
      {button('拡大', 'plus', c.canvasZoom.zoomIn, { disabled: !enabled })}
      {button('全体', 'fit', c.canvasZoom.fitToView, { disabled: !enabled })}
      {separator}
      {button('前頁', 'previous', () => c.setSelectedPageKey(c.pageOptions[c.selectedPageIndex - 1]!.key), { disabled: c.selectedPageIndex <= 0 })}
      {button('次頁', 'next', () => c.setSelectedPageKey(c.pageOptions[c.selectedPageIndex + 1]!.key), { disabled: c.selectedPageIndex < 0 || c.selectedPageIndex >= c.pageOptions.length - 1 })}
      <div className="mt-auto pb-[84px] pt-2">
        {renderLink({ to: KIOSK_ASSEMBLY_LIBRARY_PATH, 'aria-label': '一覧へ戻る', className: `${buttonClass} border-transparent text-[#9fb0c0]`, children: <span title="一覧へ戻る">{icon('previous')}</span> })}
      </div>
    </nav>
  );
}
