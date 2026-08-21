import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';

import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';

export function AssemblyProcedureDocumentEditorAuthGate() {
  const {
    accessGranted,
    busy,
    loading,
    message,
    passwordInput,
    setPasswordInput,
    verifyEditorPassword,
    document
  } = useAssemblyProcedureDocumentEditor();

  if (accessGranted && !loading) return null;
  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-slate-800 p-3 text-white">
      <section className="rounded border border-white/15 bg-slate-900/75 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">手順書オーバーレイ編集</h1>
            <p className="mt-1 text-sm font-semibold text-white/65">
              {document?.name ?? '手順書'}を編集する前に管理パスワードを入力してください。
            </p>
          </div>
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className="inline-flex min-h-11 items-center rounded bg-transparent px-4 py-2 font-semibold text-white/90 ring-1 ring-white/20 hover:bg-white/10">
            一覧へ
          </Link>
        </div>
        <div className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-2">
          <Input
            data-testid="assembly-document-editor-password"
            data-kiosk-sop-target="assembly-document-editor-password"
            value={passwordInput}
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="パスワード"
            className="min-h-12 text-lg"
            disabled={busy}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void verifyEditorPassword();
            }}
          />
          <Button
            type="button"
            data-kiosk-sop-target="assembly-document-editor-authenticate"
            variant="primary"
            className="min-h-12"
            disabled={!passwordInput || busy}
            onClick={() => void verifyEditorPassword()}
          >
            {busy ? '確認中…' : '認証'}
          </Button>
        </div>
        {message ? <p className="mt-3 rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100" role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
