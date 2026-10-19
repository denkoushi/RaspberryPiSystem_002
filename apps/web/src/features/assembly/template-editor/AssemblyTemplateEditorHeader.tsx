import { AssemblyTemplateHeaderGuide } from '../AssemblyTemplateCreationGuide';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorHeader() {
  const {
    focusReadinessIssue, handleGuideStageClick, isDirty, loadedTemplate,
    readOnly, readiness, reloadCapabilityCatalog, templateId
  } = useAssemblyTemplateEditor();
  return (
    <header data-testid="assembly-template-editor-header" className="grid gap-3">
      <div className="flex items-center gap-2">
        <h1 aria-label={templateId ? '組立テンプレート編集' : '組立テンプレート新規'} className="text-xl font-black tracking-wider">テンプレート</h1>
        <span className="ml-auto whitespace-nowrap rounded-lg border border-[#344252] px-2 py-1 text-[15px] text-[#9fb0c0]">
          {readOnly ? '表示のみ' : !templateId || isDirty ? '未保存' : '保存済み'}
        </span>
      </div>
      {loadedTemplate ? <div className="flex flex-wrap gap-2 text-xs text-white/70">
        <span>v{loadedTemplate.version} {loadedTemplate.isActive ? '有効' : '旧版'}</span>
        {loadedTemplate.procedureSequence?.source !== 'template_version' ? <span className="text-amber-200">旧形式を取込</span> : null}
      </div> : null}
      <AssemblyTemplateHeaderGuide
        vertical
        readiness={readiness}
        readOnly={readOnly}
        onStageClick={handleGuideStageClick}
        onIssueClick={focusReadinessIssue}
        onRetryCapabilityCatalog={reloadCapabilityCatalog}
      />
    </header>
  );
}
