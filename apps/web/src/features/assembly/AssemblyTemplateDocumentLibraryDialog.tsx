import { useMemo } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { resolveAssemblyDocumentStatus } from './assemblyTemplateDraft';
import { hasAssemblyProcedureDocument } from './assemblyTemplateProcedureDraft';

import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';
import type { AssemblyProcedureDocumentSummaryDto } from './types';

type Props = {
  open: boolean;
  documents: AssemblyProcedureDocumentSummaryDto[];
  procedureItems: AssemblyTemplateProcedureDraftItem[];
  search: string;
  readOnly: boolean;
  onSearchChange: (value: string) => void;
  onAdd: (
    document: AssemblyProcedureDocumentSummaryDto,
    mode: 'all_pages' | 'document_only'
  ) => void;
  onClose: () => void;
};

export function AssemblyTemplateDocumentLibraryDialog({
  open,
  documents,
  procedureItems,
  search,
  readOnly,
  onSearchChange,
  onAdd,
  onClose
}: Props) {
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return documents.filter(
      (document) =>
        document.isActive &&
        resolveAssemblyDocumentStatus(document) === 'published' &&
        (!normalizedSearch || document.name.toLowerCase().includes(normalizedSearch))
    );
  }, [documents, search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assembly-document-library-title"
    >
      <section className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/20 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <div>
            <h2 id="assembly-document-library-title" className="text-lg font-bold">
              文書ライブラリ
            </h2>
            <p className="text-xs font-semibold text-white/55">
              公開済みの組立手順書を文書順へ追加します。
            </p>
          </div>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11"
            onClick={onClose}
          >
            閉じる
          </Button>
        </div>
        <div className="border-b border-white/10 p-3">
          <Input
            value={search}
            autoFocus
            placeholder="手順書名で検索"
            aria-label="手順書検索"
            className="min-h-11"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {filteredDocuments.length === 0 ? (
            <p className="rounded border border-dashed border-white/15 p-5 text-center text-sm text-white/55">
              追加できる手順書がありません。
            </p>
          ) : (
            <ul className="grid gap-2">
              {filteredDocuments.map((document) => {
                const alreadyAdded = hasAssemblyProcedureDocument(procedureItems, document.id);
                return (
                  <li
                    key={document.id}
                    className="flex min-h-14 items-center justify-between gap-3 rounded border border-white/10 bg-slate-950/50 p-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{document.name}</p>
                      <p className="text-xs text-white/50">{document.pages.length || 1}ページ</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        aria-label={alreadyAdded ? '追加済み' : '追加'}
                        variant={alreadyAdded ? 'ghostOnDark' : 'primary'}
                        className="min-h-11"
                        disabled={alreadyAdded || readOnly}
                        onClick={() => onAdd(document, 'all_pages')}
                      >
                        {alreadyAdded ? '追加済み' : '全ページを手順へ追加'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghostOnDark"
                        className="min-h-11"
                        disabled={alreadyAdded || readOnly}
                        onClick={() => onAdd(document, 'document_only')}
                      >
                        文書だけ追加
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
