import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  ingestAssemblyProcedureDocumentsFromGmail,
  listAssemblyTemplateSummaries,
  publishAssemblyProcedureDocument,
  retireAssemblyTemplate
} from '../../api/client';
import { KioskFilterCombobox } from '../../components/kiosk/KioskFilterCombobox';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  AssemblyProcedureLibrarySection,
  AssemblyProcedureGmailImportConfirmDialog,
  AssemblyProcedurePreviewDialog,
  AssemblyProcedureUploadModal,
  AssemblyTemplateHistoryDialog,
  AssemblyTemplateLibraryTable,
  KIOSK_ASSEMBLY_HOME_PATH,
  kioskAssemblyTemplateNewPath,
  kioskAssemblyLibraryPath,
  parseAssemblyLibrarySearch,
  readAssemblyApiErrorMessage,
  useAssemblyLibraryFilterOptions,
  useAssemblyTemplateLibrary
} from '../../features/assembly';
import { KioskSopLauncher } from '../../features/kiosk-sop';

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
  const { focus: requestedFocus, modelCode: requestedModelCode } = parseAssemblyLibrarySearch(location.search);
  const focus = requestedFocus ?? 'procedures';
  const appliedModelCode = useRef<string | null>(null);
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [procedureMessage, setProcedureMessage] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [gmailImportBusy, setGmailImportBusy] = useState(false);
  const [gmailConfirmOpen, setGmailConfirmOpen] = useState(false);
  const [gmailImportMessage, setGmailImportMessage] = useState<string | null>(null);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);
  const [procedureSearchQuery, setProcedureSearchQuery] = useState('');
  const [procedureStatusFilter, setProcedureStatusFilter] = useState<'all' | 'published' | 'draft' | 'unused'>('all');
  const [templateRefreshToken, setTemplateRefreshToken] = useState(0);
  const [historyTemplates, setHistoryTemplates] = useState<AssemblyTemplateSummaryDto[]>([]);
  const [historyTitle, setHistoryTitle] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [procedurePreview, setProcedurePreview] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [highlightedTemplateId, setHighlightedTemplateId] = useState<string | null>(null);
  const templateLibrary = useAssemblyTemplateLibrary({ refreshToken: templateRefreshToken });
  const { filters, templates, setModelCode } = templateLibrary;
  const procedurePatternOptions = useMemo(() => [...new Set(templates.map(template => template.procedurePattern))]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja')).map(value => ({ value, label: value })), [templates]);
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
    if (appliedModelCode.current === requestedModelCode) return;
    appliedModelCode.current = requestedModelCode;
    if (requestedModelCode) setModelCode(requestedModelCode);
  }, [requestedModelCode, setModelCode]);

  useEffect(() => {
    const saved = (location.state as { assemblyTemplateSaved?: {
      id: string;
      modelCode: string;
      procedurePattern: string;
      version: number;
    } } | null)?.assemblyTemplateSaved;
    if (!saved) return;
    setModelCode(saved.modelCode);
    setHighlightedTemplateId(saved.id);
    setMessage(`テンプレート ${saved.modelCode} / ${saved.procedurePattern} v${saved.version} を保存しました。`);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, setModelCode]);

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
    setProcedureMessage(
      `手順書「${document.name}」を${pageCount}ページ登録しました（下書き）。公開すると使用開始できます。`
    );
    setProcedurePreview(document);
  }, []);

  const handleLibraryChanged = useCallback((nextMessage: string) => {
    setProcedureMessage(nextMessage);
    setLibraryRefreshToken((token) => token + 1);
    setTemplateRefreshToken((token) => token + 1);
  }, []);

  const handleProcedurePublish = useCallback(async (document: AssemblyProcedureDocumentDto, accessPassword: string) => {
    const published = await publishAssemblyProcedureDocument({ id: document.id, accessPassword });
    setProcedureMessage(`手順書「${published.name}」を公開しました。内容確認済みです。`);
    setLibraryRefreshToken((token) => token + 1);
    setTemplateRefreshToken((token) => token + 1);
    return published;
  }, []);

  const handleCreateTemplateFromProcedure = useCallback((document: AssemblyProcedureDocumentDto) => {
    setProcedurePreview(null);
    navigate(kioskAssemblyTemplateNewPath({ procedureDocumentId: document.id }));
  }, [navigate]);

  const handleGmailImport = useCallback(async () => {
    setGmailConfirmOpen(false);
    setGmailImportBusy(true);
    setGmailImportMessage(null);
    try {
      const result = await ingestAssemblyProcedureDocumentsFromGmail();
      if (result.imported > 0) {
        setLibraryRefreshToken((token) => token + 1);
      }
      const failureDetails = result.items
        .filter((item) => item.error)
        .slice(0, 3)
        .map((item) => `${item.filename ?? 'メール'}: ${item.error}`)
        .join(' / ');
      const summary =
        `Gmail取込: 新規${result.imported}件、重複${result.duplicates}件、失敗${result.failed}件` +
        `（受信箱残り${result.remainingInInbox}件）。`;
      setGmailImportMessage(
        failureDetails
          ? `${summary} ${failureDetails}`
          : result.imported > 0
            ? `${summary} 取り込んだ手順書は下書きです。確認後に公開してください。`
            : summary
      );
    } catch (error: unknown) {
      setGmailImportMessage(readAssemblyApiErrorMessage(error, 'Gmailからの手順書取込に失敗しました。'));
    } finally {
      setGmailImportBusy(false);
    }
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

  const toolbarStart = <>
    <h1 className="shrink-0 text-xl font-bold">組立</h1>
    <nav className="flex shrink-0 rounded border border-white/20" aria-label="管理一覧の切替">
      {(['procedures', 'templates'] as const).map(value => <Link key={value}
        to={kioskAssemblyLibraryPath({ focus: value, modelCode: requestedModelCode })}
        aria-current={focus === value ? 'page' : undefined}
        className={`flex h-11 items-center px-3 text-sm font-semibold ${focus === value ? 'bg-emerald-400/20 text-emerald-100' : 'text-white/60'}`}>
        {value === 'procedures' ? '手順書' : 'テンプレート'}
      </Link>)}
    </nav>
  </>;
  const toolbarEnd = <>
    <KioskSopLauncher manualId="assembly-procedure-template" initialSheetId={focus === 'templates' ? 'assembly-revision' : 'assembly-overview'} className="h-11 !px-2 !py-0 !text-white/60" />
    <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex h-11 shrink-0 items-center !px-2 !py-0 text-sm !text-white/60')}>組立へ戻る</Link>
  </>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-800 text-white">
      <AssemblyProcedureUploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={handleUploadSuccess} />
      <AssemblyProcedurePreviewDialog
        document={procedurePreview}
        isOpen={procedurePreview != null}
        onClose={() => setProcedurePreview(null)}
        onPublish={handleProcedurePublish}
        onCreateTemplate={handleCreateTemplateFromProcedure}
      />
      <AssemblyProcedureGmailImportConfirmDialog
        isOpen={gmailConfirmOpen}
        busy={gmailImportBusy}
        onConfirm={() => void handleGmailImport()}
        onCancel={() => setGmailConfirmOpen(false)}
      />

      {focus === 'procedures' ? (
        <AssemblyProcedureLibrarySection
          toolbarStart={toolbarStart}
          toolbarEnd={toolbarEnd}
          initialSearchQuery={procedureSearchQuery}
          initialStatusFilter={procedureStatusFilter}
          onSearchQueryChange={setProcedureSearchQuery}
          onStatusFilterChange={setProcedureStatusFilter}
          refreshToken={libraryRefreshToken}
          onRegisterClick={() => setUploadOpen(true)}
          onImportClick={() => setGmailConfirmOpen(true)}
          importing={gmailImportBusy}
          importMessage={gmailImportMessage}
          statusMessage={procedureMessage}
          onChanged={handleLibraryChanged}
          onPreviewClick={(document) => setProcedurePreview(document)}
        />
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="assembly-template-pane-heading">
          <h2 id="assembly-template-pane-heading" className="sr-only">組立テンプレート</h2>
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-1 whitespace-nowrap border-b border-white/15 bg-slate-900 px-3 py-1.5">
            {toolbarStart}
            <div className="min-w-[180px] max-w-[320px] flex-1"><Input value={filters.q} onChange={e => templateLibrary.setQ(e.target.value)} aria-label="全体検索" placeholder="全体検索" className="h-11 min-h-11 px-2 text-sm" /></div>
            <div className="w-[88px] shrink-0"><KioskFilterCombobox value={filters.modelCode} onChange={templateLibrary.setModelCode} placeholder="機種名" ariaLabel="機種名"
              options={modelCodeOptions.options} loading={modelCodeOptions.loading} optionUpdateMode="live" inputClassName="h-11 min-h-11 px-2 text-sm" /></div>
            <div className="w-[88px] shrink-0"><KioskFilterCombobox value={filters.procedurePattern} onChange={templateLibrary.setProcedurePattern} placeholder="手順" ariaLabel="手順パターン"
              options={procedurePatternOptions} optionUpdateMode="live" inputClassName="h-11 min-h-11 px-2 text-sm" /></div>
            <div className="w-[88px] shrink-0"><KioskFilterCombobox value={filters.procedureDocumentName} onChange={templateLibrary.setProcedureDocumentName} placeholder="手順書名" ariaLabel="テンプレートの手順書名"
              options={procedureDocumentOptions.options} loading={procedureDocumentOptions.loading} optionUpdateMode="live" inputClassName="h-11 min-h-11 px-2 text-sm" /></div>
            <div className="flex shrink-0 gap-1" aria-label="テンプレートの状態">
              {([false, true] as const).map(value => <button key={String(value)} type="button" aria-pressed={filters.includeInactive === value} onClick={() => templateLibrary.setIncludeInactive(value)}
                className={`h-11 rounded-full border px-2 text-sm font-semibold ${filters.includeInactive === value ? 'border-emerald-400 bg-emerald-400/20 text-emerald-100' : 'border-white/20 text-white/60'}`}>{value ? '無効化済みも表示' : '有効'}</button>)}
            </div>
            <Button type="button" variant="ghostOnDark" className="h-11 w-11 shrink-0 !p-0 text-2xl" aria-label={templateLibrary.loading ? '更新中…' : '再読込'} title="再読込" disabled={templateLibrary.loading} onClick={templateLibrary.reload}><span aria-hidden="true">↻</span></Button>
            <Button type="button" variant="ghostOnDark" className="h-11 w-11 shrink-0 !p-0 text-2xl" aria-label="解除" title="解除" disabled={!templateLibrary.hasActiveFilters} onClick={templateLibrary.resetFilters}><span aria-hidden="true">×</span></Button>
            <div className="ml-auto flex shrink-0 items-center gap-2">{toolbarEnd}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
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

            <div className="min-h-0 flex-1">
              <AssemblyTemplateLibraryTable
                templates={visibleTemplateRows}
                busy={templateLibrary.loading || actionBusy}
                onHistoryClick={(key) => void handleHistoryClick(key)}
                lineageGroupKey={lineageGroupKey}
                onRetireClick={(template) => void handleRetireTemplate(template)}
                highlightedTemplateId={highlightedTemplateId}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
