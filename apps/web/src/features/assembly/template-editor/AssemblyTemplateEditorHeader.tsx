import { Button, buttonClassName } from '../../../components/ui/Button';
import { KioskSopLauncher } from '../../kiosk-sop';
import {
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  kioskAssemblyTemplateNewPath
} from '../assemblyRoutes';
import { AssemblyTemplateHeaderGuide } from '../AssemblyTemplateCreationGuide';

import {
  useAssemblyTemplateEditor,
  useAssemblyTemplateEditorNavigation
} from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorHeader() {
  const {
    busy,
    focusReadinessIssue,
    handleGuideStageClick,
    inspectorMode,
    isDirty,
    loadedTemplate,
    procedurePaneOpen,
    readOnly,
    readiness,
    reloadCapabilityCatalog,
    saveTemplate,
    selectedStep,
    setInspectorMode,
    setStepSupplementOpen,
    setLeftPaneTab,
    setProcedurePaneOpen,
    settingsPaneOpen,
    templateId
  } = useAssemblyTemplateEditor();
  const { renderLink } = useAssemblyTemplateEditorNavigation();
  return (
  <header
    data-testid="assembly-template-editor-header"
    className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded border border-white/15 bg-slate-900/70 px-2 py-1 xl:min-h-14 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:gap-2"
  >
    <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-2">
      <h1 className="text-[1.12rem] font-bold leading-tight">
        {templateId ? '組立テンプレート編集' : '組立テンプレート新規'}
      </h1>
      {loadedTemplate ? (
        <span className="rounded border border-white/15 bg-slate-950/60 px-2 py-1 text-xs font-bold text-white/70">
          v{loadedTemplate.version} {loadedTemplate.isActive ? '有効' : '旧版'}
        </span>
      ) : null}
      {loadedTemplate &&
      loadedTemplate.procedureSequence?.source !== 'template_version' ? (
        <span className="rounded border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-100">
          旧形式を取込
        </span>
      ) : null}
      {readOnly ? (
        <span className="text-xs font-semibold text-amber-200">表示のみ</span>
      ) : isDirty ? (
        <span className="text-xs font-bold text-amber-200">未保存あり</span>
      ) : (
        <span className="text-xs font-semibold text-emerald-200">保存済み</span>
      )}
    </div>
    <AssemblyTemplateHeaderGuide
      readiness={readiness}
      readOnly={readOnly}
      onStageClick={handleGuideStageClick}
      onIssueClick={focusReadinessIssue}
      onRetryCapabilityCatalog={reloadCapabilityCatalog}
    />
    <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 xl:col-start-3">
      <KioskSopLauncher
        manualId="assembly-procedure-template"
        initialSheetId={templateId ? 'assembly-revision' : 'assembly-template-auth-basics'}
        className="min-h-10"
      />
      <Button
        type="button"
        data-kiosk-sop-target="assembly-editor-help"
        variant="ghostOnDark"
        className="min-h-10 whitespace-nowrap !px-2 text-xs"
        aria-expanded={procedurePaneOpen}
        aria-controls="assembly-procedure-pane"
        onClick={() =>
          setProcedurePaneOpen((current) => {
            if (!current && typeof window !== 'undefined' && window.innerWidth < 1366) {
              setLeftPaneTab('documents');
            }
            return !current;
          })
        }
      >
      文書/工程
      </Button>
      <Button
        type="button"
        variant={inspectorMode === 'step' ? 'primary' : 'ghostOnDark'}
        className="min-h-10 whitespace-nowrap !px-2 text-xs"
        disabled={!selectedStep}
        aria-expanded={settingsPaneOpen}
        aria-controls="assembly-editor-settings-pane"
        onClick={() => {
          setStepSupplementOpen(true);
          setInspectorMode((current) => (current === 'step' ? 'closed' : 'step'));
        }}
      >
        注意・補足
      </Button>
      {renderLink({
        to: KIOSK_ASSEMBLY_LIBRARY_PATH,
        className: buttonClassName(
          'ghostOnDark',
          'inline-flex min-h-10 items-center whitespace-nowrap !px-2 text-xs'
        ),
        children: '一覧へ'
      })}
      {loadedTemplate ? (
        renderLink({
          to: kioskAssemblyTemplateNewPath({ sourceTemplateId: loadedTemplate.id }),
          className: buttonClassName(
            'ghostOnDark',
            'inline-flex min-h-10 items-center whitespace-nowrap !px-2 text-xs'
          ),
          children: '複製して新規'
        })
      ) : null}
      <Button
        type="button"
        variant="primary"
        className="min-h-10 whitespace-nowrap !px-2 text-sm"
        data-kiosk-sop-target="assembly-editor-save"
        disabled={busy || readOnly || !readiness.isReady}
        onClick={() => void saveTemplate()}
      >
        {busy ? '保存中…' : templateId ? '新しい版で保存' : '保存'}
      </Button>
    </div>
  </header>
  );
}
