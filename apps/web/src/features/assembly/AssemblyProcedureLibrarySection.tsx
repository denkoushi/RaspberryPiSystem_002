import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { deleteAssemblyProcedureDocument } from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyProcedureRenameModal } from './AssemblyProcedureRenameModal';
import { kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import { formatAssemblyTimestamp, readAssemblyApiErrorMessage } from './assemblyUiHelpers';
import { useAssemblyProcedureLibrary } from './useAssemblyProcedureLibrary';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentSummaryDto } from './types';

type Props = {
  refreshToken?: number;
  onRegisterClick: () => void;
  onChanged?: (message: string) => void;
  previewDocuments?: AssemblyProcedureDocumentSummaryDto[];
};

export function AssemblyProcedureLibrarySection({
  refreshToken,
  onRegisterClick,
  onChanged,
  previewDocuments
}: Props) {
  const isPreview = previewDocuments != null;
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<AssemblyProcedureDocumentSummaryDto | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const apiState = useAssemblyProcedureLibrary({ refreshToken, enabled: !isPreview });

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

  const handleRenameSuccess = (document: AssemblyProcedureDocumentDto) => {
    setRenameTarget(null);
    onChanged?.(`手順書名を変更しました: ${document.name}`);
    reload();
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
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="手順書名で検索"
            aria-label="手順書名で検索"
            className="min-h-9 px-2 text-[0.9rem]"
          />
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-9 shrink-0 !px-2 !py-0 text-[0.86rem]"
          disabled={loading}
          onClick={() => reload()}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-9 shrink-0 !px-2 !py-0 text-[0.86rem]"
          onClick={onRegisterClick}
        >
          登録
        </Button>
      </div>

      {error ?? actionError ? <p className="text-[0.98rem] font-semibold text-amber-200">{error ?? actionError}</p> : null}

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
              <col className="w-[44%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
              <col className="w-[26%]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-900 text-[0.74rem] text-white/70">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1.5 font-bold">手順書名</th>
                <th className="px-2 py-1.5 font-bold">テンプレ</th>
                <th className="px-2 py-1.5 font-bold">更新</th>
                <th className="px-2 py-1.5 text-right font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className="border-b border-white/10 last:border-b-0">
                  <td className="truncate px-2 py-1.5 font-bold text-white" title={document.name}>
                    {document.name}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-white/70">
                    {document.activeTemplateCount}/{document.totalTemplateCount}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-white/65">
                    {formatAssemblyTimestamp(document.updatedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      <Link
                        to={kioskAssemblyTemplateNewPath({ procedureDocumentId: document.id })}
                        className={buttonClassName(
                          'primary',
                          'inline-flex min-h-6 shrink-0 items-center rounded !px-1.5 !py-0 text-[0.68rem] leading-none'
                        )}
                      >
                        新規
                      </Link>
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-6 shrink-0 rounded !px-1.5 !py-0 text-[0.68rem] leading-none"
                        disabled={isPreview}
                        onClick={() => setRenameTarget(document)}
                      >
                        名称
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        className="min-h-6 shrink-0 rounded !px-1.5 !py-0 text-[0.68rem] leading-none"
                        disabled={isPreview || busyDocumentId === document.id || document.totalTemplateCount > 0}
                        title={document.totalTemplateCount > 0 ? 'テンプレートで使用中のため削除できません' : '削除'}
                        onClick={() => void handleDelete(document)}
                      >
                        削除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
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
