import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { listAssemblyTemplateSummaries, retireAssemblyTemplate } from '../../api/client';
import { KioskFilterCombobox } from '../../components/kiosk/KioskFilterCombobox';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  AssemblyProcedureLibrarySection,
  AssemblyProcedureUploadModal,
  AssemblyTemplateHistoryDialog,
  AssemblyTemplateLibraryTable,
  KIOSK_ASSEMBLY_HOME_PATH,
  parseAssemblyLibrarySearch,
  readAssemblyApiErrorMessage,
  useAssemblyLibraryFilterOptions,
  useAssemblyTemplateLibrary
} from '../../features/assembly';

import type { AssemblyProcedureDocumentDto, AssemblyTemplateSummaryDto } from '../../features/assembly/types';

function lineageGroupKey(template: AssemblyTemplateSummaryDto): string {
  return `${template.modelCode}::${template.procedurePattern}`;
}

function pickRepresentative(group: AssemblyTemplateSummaryDto[]): AssemblyTemplateSummaryDto | undefined {
  if (group.length === 0) return undefined;
  const active = group.find((row) => row.isActive);
  return active ?? group[0];
}

export function KioskAssemblyPage() {
  const location = useLocation();
  const [message, setMessage] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);
  const [templateRefreshToken, setTemplateRefreshToken] = useState(0);
  const [historyTemplates, setHistoryTemplates] = useState<AssemblyTemplateSummaryDto[]>([]);
  const [historyTitle, setHistoryTitle] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const templateLibrary = useAssemblyTemplateLibrary({ refreshToken: templateRefreshToken });
  const { filters, templates } = templateLibrary;
  const modelCodeOptions = useAssemblyLibraryFilterOptions({
    field: 'templateModelCode',
    query: filters.modelCode,
    includeInactive: filters.includeInactive
  });
  const procedureDocumentOptions = useAssemblyLibraryFilterOptions({
    field: 'templateProcedureDocumentName',
    query: filters.procedureDocumentName,
    includeInactive: filters.includeInactive
  });

  useEffect(() => {
    const { focus } = parseAssemblyLibrarySearch(location.search);
    if (!focus) return;
    const targetId =
      focus === 'procedures' ? 'assembly-procedure-library-heading' : 'assembly-template-pane-heading';
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.search]);

  const groupedTemplates = useMemo(() => {
    const map = new Map<string, AssemblyTemplateSummaryDto[]>();
    for (const template of templates) {
      const key = lineageGroupKey(template);
      const group = map.get(key) ?? [];
      group.push(template);
      group.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.version - a.version;
      });
      map.set(key, group);
    }
    return map;
  }, [templates]);

  const visibleTemplateRows = useMemo(
    () =>
      [...groupedTemplates.values()]
        .map((group) => pickRepresentative(group))
        .filter((row): row is AssemblyTemplateSummaryDto => row != null),
    [groupedTemplates]
  );

  const rowByKey = useMemo(() => {
    const map = new Map<string, AssemblyTemplateSummaryDto>();
    for (const row of visibleTemplateRows) map.set(lineageGroupKey(row), row);
    return map;
  }, [visibleTemplateRows]);

  const handleUploadSuccess = useCallback((document: AssemblyProcedureDocumentDto) => {
    setUploadOpen(false);
    setLibraryRefreshToken((token) => token + 1);
    const pageCount = document.pages?.length ?? (document.imageRelativePath ? 1 : 0);
    setMessage(
      `手順書「${document.name}」を${pageCount}ページ登録しました（下書き）。公開すると使用開始できます。`
    );
  }, []);

  const handleLibraryChanged = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
    setLibraryRefreshToken((token) => token + 1);
    setTemplateRefreshToken((token) => token + 1);
  }, []);

  const handleHistoryClick = async (key: string) => {
    const row = rowByKey.get(key);
    if (!row) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const rows = await listAssemblyTemplateSummaries({
        modelCode: row.modelCode,
        procedurePattern: row.procedurePattern,
        includeInactive: true,
        limit: 200
      });
      rows.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.version - a.version;
      });
      setHistoryTemplates(rows);
      setHistoryTitle(`${row.modelCode} / ${row.procedurePattern}`);
      setHistoryOpen(true);
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, 'テンプレート履歴の取得に失敗しました。'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRetireTemplate = async (template: AssemblyTemplateSummaryDto) => {
    if (!window.confirm(`テンプレート「${template.modelCode} / ${template.procedurePattern} v${template.version}」を無効化します。よろしいですか。`)) {
      return;
    }
    setActionBusy(true);
    setMessage(null);
    try {
      await retireAssemblyTemplate(template.id);
      setMessage(`テンプレートを無効化しました: ${template.modelCode} / ${template.procedurePattern}`);
      setTemplateRefreshToken((token) => token + 1);
      setLibraryRefreshToken((token) => token + 1);
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, 'テンプレートの無効化に失敗しました。'));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.35rem] font-bold leading-tight">組立 手順書/テンプレート管理</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={KIOSK_ASSEMBLY_HOME_PATH}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            組立トップ
          </Link>
        </div>
      </div>

      <AssemblyProcedureUploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={handleUploadSuccess} />

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2 overflow-auto 2xl:grid-cols-[33rem_minmax(0,1fr)] 2xl:overflow-hidden">
        <AssemblyProcedureLibrarySection
          refreshToken={libraryRefreshToken}
          onRegisterClick={() => setUploadOpen(true)}
          onChanged={handleLibraryChanged}
        />

        <section
          className="flex min-h-0 min-w-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-950/45 p-1.5"
          aria-labelledby="assembly-template-pane-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 id="assembly-template-pane-heading" className="text-[1.08rem] font-bold text-white/90">
              組立テンプレート
            </h2>
            <span className="text-[0.9rem] font-semibold text-white/55">{visibleTemplateRows.length}件</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-slate-900/60 p-2">
            <div className="w-[11rem]">
              <Input
                value={filters.q}
                onChange={(e) => templateLibrary.setQ(e.target.value)}
                placeholder="全体検索"
                className="min-h-9 px-2 text-[0.86rem]"
              />
            </div>
            <div className="w-[9rem]">
              <KioskFilterCombobox
                value={filters.modelCode}
                onChange={templateLibrary.setModelCode}
                placeholder="型番/FHINCD"
                ariaLabel="型番/FHINCD"
                options={modelCodeOptions.options}
                loading={modelCodeOptions.loading}
                optionUpdateMode="live"
                inputClassName="min-h-9 px-2 text-[0.86rem]"
              />
            </div>
            <div className="w-[9rem]">
              <Input
                value={filters.procedurePattern}
                onChange={(e) => templateLibrary.setProcedurePattern(e.target.value)}
                placeholder="手順パターン"
                className="min-h-9 px-2 text-[0.86rem]"
              />
            </div>
            <div className="w-[11rem]">
              <KioskFilterCombobox
                value={filters.procedureDocumentName}
                onChange={templateLibrary.setProcedureDocumentName}
                placeholder="手順書名"
                ariaLabel="テンプレートの手順書名"
                options={procedureDocumentOptions.options}
                loading={procedureDocumentOptions.loading}
                optionUpdateMode="live"
                inputClassName="min-h-9 px-2 text-[0.86rem]"
              />
            </div>
            <label className="flex min-h-9 items-center gap-1 rounded border border-white/20 px-2 text-[0.78rem] font-semibold text-white/80">
              <input
                type="checkbox"
                checked={filters.includeInactive}
                onChange={(event) => templateLibrary.setIncludeInactive(event.target.checked)}
              />
              旧版含む
            </label>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-9 !px-2 !py-0 text-[0.86rem]"
              disabled={templateLibrary.loading}
              onClick={templateLibrary.reload}
            >
              {templateLibrary.loading ? '更新中…' : '再読込'}
            </Button>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-9 !px-2 !py-0 text-[0.86rem]"
              disabled={!templateLibrary.hasActiveFilters}
              onClick={templateLibrary.resetFilters}
            >
              解除
            </Button>
          </div>

          {templateLibrary.error ?? modelCodeOptions.error ?? procedureDocumentOptions.error ?? message ? (
            <p className="px-1 text-[1rem] font-semibold text-amber-200">
              {templateLibrary.error ?? modelCodeOptions.error ?? procedureDocumentOptions.error ?? message}
            </p>
          ) : null}

          <AssemblyTemplateHistoryDialog
            isOpen={historyOpen}
            title={historyTitle}
            templates={historyTemplates}
            onClose={() => setHistoryOpen(false)}
          />

          <div className="min-h-0 flex-1 rounded bg-slate-950/35 p-1">
            <AssemblyTemplateLibraryTable
              templates={visibleTemplateRows}
              busy={templateLibrary.loading || actionBusy}
              onHistoryClick={(key) => void handleHistoryClick(key)}
              lineageGroupKey={lineageGroupKey}
              onRetireClick={(template) => void handleRetireTemplate(template)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
