import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  deleteAssemblyProcedureDocument,
  unpublishAssemblyProcedureDocument
} from '../../api/client';
import { KioskFilterCombobox, type KioskFilterOption } from '../../components/kiosk/KioskFilterCombobox';
import { Button, buttonClassName } from '../../components/ui/Button';
import { IconActionTooltip } from '../../components/ui/IconActionTooltip';
import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import { AssemblyLibraryActionIcon } from './AssemblyLibraryActionIcon';
import { AssemblyProcedureRenameModal } from './AssemblyProcedureRenameModal';
import { kioskAssemblyProcedureDocumentEditPath, kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import {
  assemblyProcedureDocumentPageCount,
  resolveAssemblyDocumentStatus
} from './assemblyTemplateDraft';
import {
  formatAssemblyTimestamp,
  readAssemblyApiErrorMessage
} from './assemblyUiHelpers';
import { useAssemblyLibraryFilterOptions } from './useAssemblyLibraryFilterOptions';
import { useAssemblyProcedureLibrary } from './useAssemblyProcedureLibrary';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentSummaryDto } from './types';
import type { MouseEvent, ReactNode } from 'react';

export type AssemblyProcedureLibraryStatusFilter = 'all' | 'published' | 'draft' | 'unused';

type Props = {
  refreshToken?: number;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  initialSearchQuery?: string;
  initialStatusFilter?: AssemblyProcedureLibraryStatusFilter;
  onSearchQueryChange?: (query: string) => void;
  onStatusFilterChange?: (status: AssemblyProcedureLibraryStatusFilter) => void;
  onRegisterClick: () => void;
  onImportClick?: () => void;
  importing?: boolean;
  importMessage?: string | null;
  statusMessage?: string | null;
  onChanged?: (message: string) => void;
  onPreviewClick?: (document: AssemblyProcedureDocumentSummaryDto) => void;
  previewDocuments?: AssemblyProcedureDocumentSummaryDto[];
};

export function AssemblyProcedureLibrarySection({
  refreshToken,
  toolbarStart,
  toolbarEnd,
  initialSearchQuery = '',
  initialStatusFilter = 'all',
  onSearchQueryChange,
  onStatusFilterChange,
  onRegisterClick,
  onImportClick,
  importing = false,
  importMessage,
  statusMessage,
  onChanged,
  onPreviewClick,
  previewDocuments
}: Props) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const isPreview = previewDocuments != null;
  const [previewSearchQuery, setPreviewSearchQuery] = useState(initialSearchQuery);
  const [renameTarget, setRenameTarget] = useState<AssemblyProcedureDocumentSummaryDto | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const apiState = useAssemblyProcedureLibrary({ refreshToken, enabled: !isPreview, initialSearchQuery });
  const apiFilterOptions = useAssemblyLibraryFilterOptions({
    field: 'procedureDocumentName',
    query: isPreview ? '' : apiState.searchQuery,
    enabled: !isPreview
  });

  const previewFilteredDocuments = useMemo(() => {
    if (!isPreview) return [];
    const q = previewSearchQuery.trim().toLowerCase();
    if (!q) return previewDocuments;
    return previewDocuments.filter((document) => document.name.toLowerCase().includes(q));
  }, [isPreview, previewDocuments, previewSearchQuery]);

  const availableDocuments = isPreview ? previewFilteredDocuments : apiState.documents;
  const unusedCount = availableDocuments.filter(document => document.manualAssignments.length === 0).length;
  const documents = availableDocuments.filter(document =>
    statusFilter === 'all' || (statusFilter === 'unused' ? document.manualAssignments.length === 0
      : document.isActive && resolveAssemblyDocumentStatus(document) === statusFilter)
  );
  const searchQuery = isPreview ? previewSearchQuery : apiState.searchQuery;
  const setSearchQuery = isPreview ? setPreviewSearchQuery : apiState.setSearchQuery;
  const loading = isPreview ? false : apiState.loading;
  const error = isPreview ? null : apiState.error;
  const reload = isPreview ? () => undefined : apiState.reload;
  const previewFilterOptions = useMemo<KioskFilterOption[]>(() => {
    if (!isPreview) return [];
    return [...new Set(previewDocuments.filter((document) => document.isActive).map((document) => document.name.trim()))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map((value) => ({ value, label: value }));
  }, [isPreview, previewDocuments]);
  const filterOptions = isPreview ? previewFilterOptions : apiFilterOptions.options;

  const handleRenameSuccess = (document: AssemblyProcedureDocumentDto) => {
    setRenameTarget(null);
    onChanged?.(`手順書名を変更しました: ${document.name}`);
    reload();
  };

  const handleUnpublish = async (document: AssemblyProcedureDocumentSummaryDto) => {
    if (isPreview) return;
    if (!window.confirm(`手順書「${document.name}」の公開を取り消します。使用中の場合はできません。よろしいですか。`)) {
      return;
    }
    setBusyDocumentId(document.id);
    setActionError(null);
    try {
      await unpublishAssemblyProcedureDocument(document.id);
      onChanged?.(`手順書「${document.name}」を下書きに戻しました。`);
      reload();
    } catch (e: unknown) {
      setActionError(readAssemblyApiErrorMessage(e, '公開取り消しに失敗しました。'));
    } finally {
      setBusyDocumentId(null);
    }
  };

  const handleDelete = async (document: AssemblyProcedureDocumentSummaryDto) => {
    if (isPreview) return;
    if (!window.confirm(`手順書「${document.name}」を削除します。よろしいですか。`)) return;
    setBusyDocumentId(document.id);
    setActionError(null);
    try {
      await deleteAssemblyProcedureDocument(document.id);
      onChanged?.(`手順書を削除しました: ${document.name}`);
      reload();
    } catch (e: unknown) {
      setActionError(readAssemblyApiErrorMessage(e, '手順書の削除に失敗しました。'));
    } finally {
      setBusyDocumentId(null);
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="assembly-procedure-library-heading">
      <h2 id="assembly-procedure-library-heading" className="sr-only">手順書ライブラリ</h2>
      <div className="flex h-14 shrink-0 items-center gap-2 whitespace-nowrap border-b border-white/15 bg-slate-900 px-3">
        {toolbarStart}
        <div className="w-80 shrink-0">
          <KioskFilterCombobox value={searchQuery} onChange={query => { setSearchQuery(query); onSearchQueryChange?.(query); }} placeholder="名前で検索" ariaLabel="手順書名で検索"
            options={filterOptions} loading={apiFilterOptions.loading} optionUpdateMode="live" inputClassName="h-11 min-h-11 px-2 text-sm" />
        </div>
        <div className="flex shrink-0 gap-1" aria-label="手順書の状態">
          {([['all', '全て'], ['published', '公開'], ['draft', '下書き'], ['unused', '未使用']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => { setStatusFilter(value); onStatusFilterChange?.(value); }}
              className={`h-11 rounded-full border px-3 text-sm font-semibold ${statusFilter === value ? value === 'unused' ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-emerald-400 bg-emerald-400/20 text-emerald-100' : 'border-white/20 text-white/60'}`}>{label}{value === 'unused' ? <span className="ml-2 font-mono">{unusedCount}</span> : null}</button>
          ))}
        </div>
        <Button type="button" data-kiosk-sop-target="assembly-library-refresh" variant="ghostOnDark" className="h-11 w-11 shrink-0 !p-0 text-2xl"
          aria-label={loading ? '更新中…' : '再読込'} title="再読込" disabled={loading} onClick={() => reload()}><span aria-hidden="true">↻</span></Button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button type="button" data-kiosk-sop-target="assembly-file-register" variant="ghostOnDark" className="h-11 !px-2 !py-0 text-sm" onClick={onRegisterClick}>ファイルから登録</Button>
          {onImportClick ? <Button type="button" data-kiosk-sop-target="assembly-gmail-import" variant="ghostOnDark" className="h-11 !px-2 !py-0 text-sm"
            disabled={importing} onClick={onImportClick} aria-label={importing ? '取込中…' : 'Gmailから取り込む'} title="Gmailから取り込む">{importing ? '取込中…' : 'Gmail から取込'}</Button> : null}
          {toolbarEnd}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
        {importMessage ? (
          <p className="px-1 text-[0.9rem] font-semibold text-amber-100">{importMessage}</p>
        ) : null}
        {statusMessage ? <p className="px-1 text-[0.9rem] font-semibold text-emerald-100">{statusMessage}</p> : null}

        {error ?? actionError ?? apiFilterOptions.error ? (
          <p className="text-[0.98rem] font-semibold text-amber-200">
            {error ?? actionError ?? apiFilterOptions.error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && documents.length === 0 ? (
            <p className="py-4 text-center text-[0.88rem] text-white/60">読込中…</p>
          ) : documents.length === 0 ? (
            <p className="py-4 text-center text-[0.88rem] text-white/60">
              {searchQuery.trim() ? '条件に合う手順書はありません。' : '登録済み手順書はありません。'}
            </p>
          ) : (
            <table className="w-full min-w-[1280px] table-fixed border-collapse text-left text-base" aria-label="手順書ライブラリ">
              <colgroup>
                <col className="w-[60px]" /><col /><col className="w-[142px]" /><col className="w-[300px]" /><col className="w-[70px]" />
                <col className="w-[90px]" /><col className="w-[140px]" /><col className="w-[300px]" />
              </colgroup>
              <thead className="sr-only"><tr>
                {['サムネイル', '名前', '状態', '使用先', '頁', 'テンプレ', '更新', '操作'].map(label => <th key={label} scope="col">{label}</th>)}
              </tr></thead>
              <tbody>
                {documents.map((document) => {
                  const status = resolveAssemblyDocumentStatus(document);
                  const pageCount = assemblyProcedureDocumentPageCount(document);
                  const isPublished = status === 'published';
                  const busy = busyDocumentId === document.id;
                  return (
                    <tr key={document.id} className="h-14 border-b border-white/10">
                      <td className="px-2"><ProcedureThumbnail url={document.pages?.find(page => page.pageIndex === 0)?.imageRelativePath || document.imageRelativePath} /></td>
                      <td className="truncate px-2 text-xl font-bold" title={document.name}>{document.name}</td>
                      <td className="px-2"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-sm font-semibold ${!document.isActive ? 'border-red-400 text-red-200' : isPublished ? 'border-emerald-400 text-emerald-100' : 'border-amber-400 text-amber-100'}`}>
                        {!document.isActive ? '無効' : isPublished ? `公開 第${document.revisionNumber ?? 1}版` : '下書き'}
                      </span></td>
                      <td className="px-2"><div className="flex min-w-0 items-center gap-1.5">
                        {document.manualAssignments.length ? <>
                          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-[#1b2530] px-2.5 py-1 text-[15px]">
                            <span className="truncate"><b className="font-mono">{document.manualAssignments[0].modelCode}</b><span className="text-white/60"> · </span>{document.manualAssignments[0].processName}</span>
                          </span>
                          {document.manualAssignments.length > 1 ? <span className="shrink-0 font-mono text-[15px] text-white/60">+{document.manualAssignments.length - 1}</span> : null}
                        </> : <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-amber-400 px-2.5 py-1 text-[15px] font-bold text-amber-400">
                          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>未使用
                        </span>}
                      </div></td>
                      <td className="px-2 text-right font-mono text-white/60">{pageCount}</td>
                      <td className="px-2 text-right font-mono text-white/60">{document.activeTemplateCount}/{document.totalTemplateCount}</td>
                      <td className="whitespace-nowrap px-2 text-right font-mono text-white/60">{formatAssemblyTimestamp(document.updatedAt)}</td>
                      <td className="px-2"><div className="flex justify-end gap-1">
                          <IconActionTooltip label={isPublished ? '内容確認' : '内容確認・公開'} disabled={isPreview || busy}><Button
                            type="button"
                            data-kiosk-sop-target="assembly-procedure-preview"
                            variant="ghostOnDark"
                            aria-label={isPublished ? '内容確認' : '内容確認・公開'}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0"
                            disabled={isPreview || busy}
                            onClick={() => onPreviewClick?.(document)}
                          >
                            <AssemblyLibraryActionIcon action="preview" />
                          </Button></IconActionTooltip>
                          <IconActionTooltip label={isPublished ? '改版編集' : '編集'}><Link
                            to={kioskAssemblyProcedureDocumentEditPath(document.id)}
                            data-kiosk-sop-target="assembly-procedure-edit"
                            aria-label={isPublished ? '改版編集' : '編集'}
                            className={buttonClassName(
                              'ghostOnDark',
                              'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0 !border-amber-400 !text-amber-200'
                            )}
                          >
                            <AssemblyLibraryActionIcon action="edit" />
                          </Link></IconActionTooltip>
                          <IconActionTooltip label={!isPublished ? '公開後にテンプレート作成できます' : 'テンプレート新規作成'} disabled={!isPublished}><Link
                            to={kioskAssemblyTemplateNewPath({ procedureDocumentId: document.id })}
                            data-kiosk-sop-target="assembly-template-new"
                            className={buttonClassName(
                              'ghostOnDark',
                              `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0 !border-emerald-400 !text-emerald-200 ${!isPublished ? 'pointer-events-none opacity-40' : ''}`
                            )}
                            aria-disabled={!isPublished}
                            aria-label="テンプレート新規作成"
                            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                              if (!isPublished) event.preventDefault();
                            }}
                          >
                            <AssemblyLibraryActionIcon action="create" />
                          </Link></IconActionTooltip>
                          {!isPublished || document.revisionRootId != null ? null : (
                            <IconActionTooltip label="公開取消" disabled={isPreview || busy}><Button
                              type="button"
                              variant="ghostOnDark"
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0"
                              disabled={isPreview || busy}
                              aria-label="公開取消" onClick={() => void handleUnpublish(document)}
                            >
                              <AssemblyLibraryActionIcon action="unpublish" />
                            </Button></IconActionTooltip>
                          )}
                          <IconActionTooltip label="名前変更" disabled={isPreview || busy}><Button
                            type="button"
                            variant="ghostOnDark"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0"
                            disabled={isPreview || busy}
                            aria-label="名前変更" onClick={() => setRenameTarget(document)}
                          >
                            <AssemblyLibraryActionIcon action="rename" />
                          </Button></IconActionTooltip>
                          <IconActionTooltip label={document.manualAssignments.length > 0 ? '使用中は削除できません' : document.totalTemplateCount > 0 ? 'テンプレートで使用中のため削除できません' : '削除'} disabled={isPreview || busy || document.totalTemplateCount > 0 || document.manualAssignments.length > 0}><Button
                            type="button"
                            variant="ghostOnDark"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded !border-red-400 !p-0 !text-red-300"
                            disabled={isPreview || busy || document.totalTemplateCount > 0 || document.manualAssignments.length > 0}
                            aria-label="削除" onClick={() => void handleDelete(document)}
                          >
                            <AssemblyLibraryActionIcon action="delete" />
                          </Button></IconActionTooltip>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
      <AssemblyProcedureRenameModal
        isOpen={renameTarget != null}
        document={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSuccess={handleRenameSuccess}
      />
    </section>
  );
}

function ProcedureThumbnailImage({ url }: { url: string }) {
  const { blobUrl } = useProtectedImageBlobUrl(url);
  return blobUrl ? <img src={blobUrl} alt="1ページ目" className="h-full w-full object-contain" /> : null;
}

function ProcedureThumbnail({ url }: { url?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !url) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '200px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [url]);
  return <div ref={ref} className="h-[26px] w-9 overflow-hidden rounded-[3px] border border-white/30 bg-white/10">
    {visible && url ? <ProcedureThumbnailImage url={url} /> : null}
  </div>;
}
