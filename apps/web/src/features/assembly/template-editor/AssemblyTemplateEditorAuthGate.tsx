import { Button, buttonClassName } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { KioskSopLauncher } from '../../kiosk-sop';
import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';

import {
  useAssemblyTemplateEditor,
  useAssemblyTemplateEditorNavigation
} from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorAuthGate() {
  const {
    accessGranted,
    busy,
    loading,
    message,
    passwordInput,
    setPasswordInput,
    templateId,
    verifyEditorPassword
  } = useAssemblyTemplateEditor();
  const { renderLink } = useAssemblyTemplateEditorNavigation();
  if (accessGranted && !loading) return null;
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">
        読込中…
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-slate-800 p-3 text-white">
        <section className="rounded border border-white/15 bg-slate-900/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">
                {templateId ? '組立テンプレート編集' : '組立テンプレート新規'}
              </h1>
              <p className="mt-1 text-sm font-semibold text-white/65">
                文書順・工程・マーカーを編集する前にパスワードを入力してください。
              </p>
            </div>
            <KioskSopLauncher
              manualId="assembly-procedure-template"
              initialSheetId={templateId ? 'assembly-revision' : 'assembly-template-auth-basics'}
              className="min-h-11"
            />
            {renderLink({
              to: KIOSK_ASSEMBLY_LIBRARY_PATH,
              className: buttonClassName(
                'ghostOnDark',
                'inline-flex min-h-11 items-center'
              ),
              children: '一覧へ'
            })}
          </div>
          <div className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-2">
            <Input
              data-kiosk-sop-target="assembly-editor-password"
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
              data-kiosk-sop-target="assembly-editor-authenticate"
              variant="primary"
              className="min-h-12"
              disabled={!passwordInput || busy}
              onClick={() => void verifyEditorPassword()}
            >
              認証
            </Button>
          </div>
          {message ? (
            <p className="mt-3 rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    );
  }
  return null;
}
