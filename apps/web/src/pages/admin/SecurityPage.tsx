import { useEffect, useState } from 'react';

import { getRoleAuditLogs, mfaActivate, mfaDisable, mfaInitiate } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';

import type { RoleAuditLog } from '../../api/types';

type Status = { message: string; tone: 'info' | 'error' | 'success' } | null;

export function SecurityPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>(null);
  const [loading, setLoading] = useState(false);

  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  const [auditLogs, setAuditLogs] = useState<RoleAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const logs = await getRoleAuditLogs(100);
      setAuditLogs(logs);
    } catch (error) {
      setStatus({ message: '監査ログの取得に失敗しました', tone: 'error' });
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadAuditLogs();
  }, []);

  const handleInitiate = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await mfaInitiate();
      setMfaSecret(res.secret);
      setOtpauthUrl(res.otpauthUrl);
      setBackupCodes(res.backupCodes);
      setStatus({ message: 'MFAのセットアップ情報を生成しました。認証アプリに登録してください。', tone: 'info' });
    } catch (error) {
      setStatus({ message: 'MFAセットアップの初期化に失敗しました', tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!mfaSecret || backupCodes.length === 0) {
      setStatus({ message: '先にセットアップ情報を生成してください', tone: 'error' });
      return;
    }
    if (!codeInput || codeInput.length < 6) {
      setStatus({ message: '6桁のコードを入力してください', tone: 'error' });
      return;
    }
    setLoading(true);
    try {
      const res = await mfaActivate({ secret: mfaSecret, code: codeInput, backupCodes });
      setBackupCodes(res.backupCodes);
      setStatus({ message: 'MFAを有効化しました。バックアップコードを安全な場所に保管してください。', tone: 'success' });
    } catch (error) {
      setStatus({ message: 'MFAの有効化に失敗しました。コードを確認してください。', tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!disablePassword) {
      setStatus({ message: 'パスワードを入力してください', tone: 'error' });
      return;
    }
    setLoading(true);
    try {
      await mfaDisable({ password: disablePassword });
      setStatus({ message: 'MFAを無効化しました', tone: 'info' });
      setMfaSecret(null);
      setOtpauthUrl(null);
      setBackupCodes([]);
      setCodeInput('');
      setDisablePassword('');
    } catch (error) {
      setStatus({ message: 'MFAの無効化に失敗しました。パスワードを確認してください。', tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-slate-900">MFA（多要素認証）設定</h2>
        <p className="text-sm font-semibold text-slate-700">
          管理画面ログインにワンタイムコードを追加します。TOTPアプリ（例: Google Authenticator）に登録し、バックアップコードを保管してください。
        </p>
        <div className="mt-4 grid gap-4 rounded-xl border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
          <div className="flex gap-3">
            <Button onClick={handleInitiate} disabled={loading}>
              セットアップ情報を生成
            </Button>
            {user?.mfaEnabled ? (
              <span className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">MFA有効</span>
            ) : (
              <span className="rounded bg-orange-500 px-2 py-1 text-xs text-white">MFA未設定</span>
            )}
          </div>
          {mfaSecret ? (
            <div className="space-y-2 text-sm font-semibold text-slate-700">
              <p>
                シークレットキー: <span className="font-mono text-slate-900">{mfaSecret}</span>
              </p>
              <p>
                otpauth URL: <span className="font-mono break-all text-slate-900">{otpauthUrl}</span>
              </p>
              {backupCodes.length > 0 && (
                <div>
                  <p className="font-bold text-slate-900">バックアップコード（紙などに保管）</p>
                  <ul className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code) => (
                      <li key={code} className="font-mono rounded border-2 border-slate-500 bg-white px-2 py-1 text-slate-900 shadow-lg">
                        {code}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700">
                  認証アプリに表示された6桁コード
                  <Input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="6桁コード"
                    inputMode="numeric"
                  />
                </label>
                <Button onClick={handleActivate} disabled={loading}>
                  コードを確認して有効化
                </Button>
              </div>
            </div>
          ) : null}
          <div className="space-y-2 text-sm font-semibold text-slate-700">
            <label className="text-sm font-semibold text-slate-700">
              MFA無効化（パスワード確認）
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="パスワード"
              />
            </label>
            <Button variant="secondary" onClick={handleDisable} disabled={loading}>
              MFAを無効化
            </Button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">権限変更の監査ログ</h2>
          <Button variant="secondary" onClick={() => void loadAuditLogs()} disabled={auditLoading}>
            再読込
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border-2 border-slate-500 bg-slate-100 shadow-lg">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-500 bg-slate-200 text-left">
                <th className="px-3 py-2 text-sm font-semibold text-slate-900">日時</th>
                <th className="px-3 py-2 text-sm font-semibold text-slate-900">実行者</th>
                <th className="px-3 py-2 text-sm font-semibold text-slate-900">対象</th>
                <th className="px-3 py-2 text-sm font-semibold text-slate-900">変更</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="border-t border-slate-500">
                  <td className="px-3 py-2 text-sm text-slate-700">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-slate-700">{log.actorUser?.username ?? log.actorUserId}</td>
                  <td className="px-3 py-2 text-sm text-slate-700">{log.targetUser?.username ?? log.targetUserId}</td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    {log.fromRole} → <span className="font-bold text-emerald-600">{log.toRole}</span>
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-center text-sm text-slate-600" colSpan={4}>
                    監査ログはありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {status ? (
        <div
          className={`rounded-xl p-3 text-sm ${
            status.tone === 'error'
              ? 'bg-red-900/50 text-red-200'
              : status.tone === 'success'
              ? 'bg-emerald-900/40 text-emerald-200'
              : 'bg-slate-800 text-white'
          }`}
        >
          {status.message}
        </div>
      ) : null}
    </div>
  );
}
