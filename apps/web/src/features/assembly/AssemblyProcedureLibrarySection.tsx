import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  deleteAssemblyProcedureDocument,
  unpublishAssemblyProcedureDocument
} from '../../api/client';
import { KioskFilterCombobox, type KioskFilterOption } from '../../components/kiosk/KioskFilterCombobox';
import { Button, buttonClassName } from '../../components/ui/Button';

import { AssemblyProcedureRenameModal } from './AssemblyProcedureRenameModal';
import { kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import {
  assemblyProcedureDocumentPageCount,
  resolveAssemblyDocumentStatus
} from './assemblyTemplateDraft';
import {
  assemblyProcedureStatusClassName,
  assemblyProcedureStatusLabel,
  formatAssemblyTimestamp,
  readAssemblyApiErrorMessage
} from './assemblyUiHelpers';
import { useAssemblyLibraryFilterOptions } from './useAssemblyLibraryFilterOptions';
import { useAssemblyProcedureLibrary } from './useAssemblyProcedureLibrary';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentSummaryDto } from './types';

type Props = {
  refreshToken?: number;
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
  onRegisterClick,
  onImportClick,
  importing = false,
  importMessage,
  statusMessage,
  onChanged,
  onPreviewClick,
  previewDocuments
}: Props) {
  const isPreview = previewDocuments != null;
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<AssemblyProcedureDocumentSummaryDto | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const apiState = useAssemblyProcedureLibrary({ refreshToken, enabled: !isPreview });
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

  const documents = isPreview ? previewFilteredDocuments : apiState.documents;
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
    <section
      className="flex min-h-0 w-full max-w-full flex-col gap-2 rounded border border-white/15 bg-slate-900/70 p-2 2xl:w-[33rem] 2xl:shrink-0"
      aria-labelledby="assembly-procedure-library-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="assembly-procedure-library-heading" className="shrink-0 text-[1.15rem] font-bold leading-tight">
          手順書ライブラリ
        </h2>
        <div className="w-[10rem] max-w-full shrink-0">
          <KioskFilterCombobox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="手順書名で検索"
            ariaLabel="手順書名で検索"
            options={filterOptions}
            loading={apiFilterOptions.loading}
            optionUpdateMode="live"
            inputClassName="min-h-9 px-2 text-[0.9rem]"
          />
        </div>
        <Button
          type="button"
          data-kiosk-sop-target="assembly-library-refresh"
          variant="ghostOnDark"
          className="min-h-9 shrink-0 !px-2 !py-0 text-[0.86rem]"
          disabled={loading}
          onClick={() => reload()}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
        <Button
          type="button"
          data-kiosk-sop-target="assembly-file-register"
          variant="ghostOnDark"
          className="min-h-11 shrink-0 !px-2 !py-0 text-[0.86rem]"
          onClick={onRegisterClick}
        >
          ファイルから登録
        </Button>
        {onImportClick ? (
          <Button
            type="button"
            data-kiosk-sop-target="assembly-gmail-import"
            variant="ghostOnDark"
            className="min-h-11 shrink-0 !px-2 !py-0 text-[0.86rem]"
            disabled={importing}
            onClick={onImportClick}
          >
            {importing ? '取込中…' : 'Gmailから取り込む'}
          </Button>
        ) : null}
      </div>

      <p className="px-1 text-[0.78rem] font-semibold text-white/55">
        まず内容を確認し、公開した手順書からテンプレートを新規作成します。ファイル登録とGmail取込は下書きで保存されます。
      </p>

      {importMessage ? (
        <p className="px-1 text-[0.9rem] font-semibold text-amber-100">{importMessage}</p>
      ) : null}
      {statusMessage ? <p className="px-1 text-[0.9rem] font-semibold text-emerald-100">{statusMessage}</p> : null}

      {error ?? actionError ?? apiFilterOptions.error ? (
        <p className="text-[0.98rem] font-semibold text-amber-200">
          {error ?? actionError ?? apiFilterOptions.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/10 bg-slate-950/40 p-1.5">
        {loading && documents.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">読込中…</p>
        ) : documents.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">
            {searchQuery.trim() ? '条件に合う手順書はありません。' : '登録済み手順書はありません。'}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[0.82rem]" aria-label="手順書ライブラリ">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[42%]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-900 text-[0.74rem] text-white/70">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1.5 font-bold">状態</th>
                <th className="px-2 py-1.5 font-bold">頁</th>
                <th className="px-2 py-1.5 font-bold">テンプレ</th>
                <th className="px-2 py-1.5 text-right font-bold">更新</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const status = resolveAssemblyDocumentStatus(document);
                const pageCount = assemblyProcedureDocumentPageCount(document);
                const isPublished = status === 'published';
                const busy = busyDocumentId === document.id;
                return (
                  <Fragment key={document.id}>
                    <tr className="border-t border-white/10 first:border-t-0">
                      <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[0.68rem] font-semibold ${assemblyProcedureStatusClassName(status)}`}
                        >
                          {assemblyProcedureStatusLabel(status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 font-semibold text-white/70">{pageCount}</td>
                      <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 font-semibold text-white/70">
                        {document.activeTemplateCount}/{document.totalTemplateCount}
                      </td>
                      <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 text-right font-semibold text-white/65">
                        {formatAssemblyTimestamp(document.updatedAt)}
                      </td>
                    </tr>
                    <tr className="border-b border-white/10 last:border-b-0">
                      <td colSpan={4} className="px-2 pb-1.5 pt-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-bold text-white" title={document.name}>
                            {document.name}
                          </span>
                          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          data-kiosk-sop-target="assembly-procedure-preview"
                          variant={isPublished ? 'secondary' : 'primary'}
                          className="min-h-11 shrink-0 rounded !px-2 !py-0 text-[0.75rem] leading-tight"
                          disabled={isPreview || busy}
                          onClick={() => onPreviewClick?.(document)}
                        >
                          {isPublished ? '内容確認' : '内容確認・公開'}
                        </Button>
                        <Link
                          to={kioskAssemblyTemplateNewPath({ procedureDocumentId: document.id })}
                          data-kiosk-sop-target="assembly-template-new"
                          className={buttonClassName(
                            'primary',
                            `inline-flex min-h-11 shrink-0 items-center rounded !px-2 !py-0 text-[0.75rem] leading-tight ${!isPublished ? 'pointer-events-none opacity-40' : ''}`
                          )}
                          aria-disabled={!isPublished}
                          title={!isPublished ? '公開後にテンプレート作成できます' : '新規テンプレート'}
                          onClick={(event) => {
                            if (!isPublished) event.preventDefault();
                          }}
                        >
                          テンプレート新規作成
                        </Link>
                        {!isPublished ? null : (
                          <Button
                            type="button"
                            variant="secondary"
                            className="min-h-11 shrink-0 rounded !px-2 !py-0 text-[0.75rem] leading-tight"
                            disabled={isPreview || busy}
                            onClick={() => void handleUnpublish(document)}
                          >
                            公開取消
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-11 shrink-0 rounded !px-2 !py-0 text-[0.75rem] leading-tight"
                          disabled={isPreview || busy}
                          onClick={() => setRenameTarget(document)}
                        >
                          名前変更
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          className="min-h-11 shrink-0 rounded !px-2 !py-0 text-[0.75rem] leading-tight"
                          disabled={isPreview || busy || document.totalTemplateCount > 0}
                          title={document.totalTemplateCount > 0 ? 'テンプレートで使用中のため削除できません' : '削除'}
                          onClick={() => void handleDelete(document)}
                        >
                          削除
                        </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
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
