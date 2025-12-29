import { useState } from 'react';

import { useGmailConfig, useGmailConfigMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function GmailConfigPage() {
  const { data: config, isLoading } = useGmailConfig();
  const { update, remove, authorize, refresh } = useGmailConfigMutations();
  const [formData, setFormData] = useState<{
    clientId: string;
    clientSecret: string;
    subjectPattern: string;
    fromEmail: string;
    redirectUri: string;
  }>({
    clientId: '',
    clientSecret: '',
    subjectPattern: '',
    fromEmail: '',
    redirectUri: ''
  });
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading) {
    return <Card title="Gmail設定"><p className="text-sm font-semibold text-slate-700">読み込み中...</p></Card>;
  }

  const handleEdit = () => {
    if (config) {
      setFormData({
        clientId: config.clientId || '',
        clientSecret: '', // セキュリティのため、既存の値は設定しない
        subjectPattern: config.subjectPattern || '',
        fromEmail: config.fromEmail || '',
        redirectUri: config.redirectUri || ''
      });
      setIsEditing(true);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData({
      clientId: '',
      clientSecret: '',
      subjectPattern: '',
      fromEmail: '',
      redirectUri: ''
    });
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync(formData);
      setIsEditing(false);
      alert('Gmail設定を更新しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '設定の更新に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Gmail設定を削除しますか？\n\n削除後はGmail経由でのデータ取得ができなくなります。')) {
      return;
    }

    try {
      await remove.mutateAsync();
      alert('Gmail設定を削除しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '設定の削除に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleAuthorize = async () => {
    try {
      const response = await authorize.mutateAsync();
      if (response.authorizeUrl) {
        // 新しいウィンドウで認証URLを開く
        window.open(response.authorizeUrl, '_blank', 'width=600,height=700');
        alert('認証ウィンドウを開きました。認証完了後、このページをリロードしてください。');
      } else {
        alert('認証URLの取得に失敗しました');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '認証URLの取得に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh.mutateAsync();
      alert('トークンをリフレッシュしました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'トークンのリフレッシュに失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const isConfigured = config?.provider === 'gmail' && config?.clientId;

  return (
    <Card
      title="Gmail設定"
      action={
        !isEditing ? (
          <div className="flex gap-2">
            {isConfigured && (
              <>
                <Button onClick={handleAuthorize} disabled={authorize.isPending}>
                  OAuth認証
                </Button>
                {config.hasRefreshToken && (
                  <Button onClick={handleRefresh} disabled={refresh.isPending} variant="secondary">
                    トークン更新
                  </Button>
                )}
                <Button onClick={handleEdit} variant="secondary">
                  編集
                </Button>
                <Button
                  onClick={handleDelete}
                  disabled={remove.isPending}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  削除
                </Button>
              </>
            )}
            {!isConfigured && (
              <Button onClick={handleEdit}>
                新規設定
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={update.isPending}>
              保存
            </Button>
            <Button onClick={handleCancel} variant="secondary" disabled={update.isPending}>
              キャンセル
            </Button>
          </div>
        )
      }
    >
      {!isEditing ? (
        <div className="space-y-4">
          {isConfigured ? (
            <>
              <div className="rounded-md bg-green-50 border-2 border-green-200 p-4">
                <p className="text-sm font-semibold text-green-800">✓ Gmail設定が有効です</p>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-semibold text-slate-700">Client ID:</span>
                  <p className="text-sm text-slate-600 mt-1">{config.clientId || '-'}</p>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700">Client Secret:</span>
                  <p className="text-sm text-slate-600 mt-1">{config.clientSecret || '-'}</p>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700">件名パターン:</span>
                  <p className="text-sm text-slate-600 mt-1">{config.subjectPattern || '-'}</p>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700">送信元メールアドレス:</span>
                  <p className="text-sm text-slate-600 mt-1">{config.fromEmail || '-'}</p>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700">リダイレクトURI:</span>
                  <p className="text-sm text-slate-600 mt-1">{config.redirectUri || '-'}</p>
                </div>
                <div className="flex gap-4 mt-4">
                  <div>
                    <span className="text-sm font-semibold text-slate-700">アクセストークン:</span>
                    <p className="text-sm text-slate-600 mt-1">
                      {config.hasAccessToken ? '✓ 設定済み' : '✗ 未設定'}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">リフレッシュトークン:</span>
                    <p className="text-sm text-slate-600 mt-1">
                      {config.hasRefreshToken ? '✓ 設定済み' : '✗ 未設定'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md bg-yellow-50 border-2 border-yellow-200 p-4">
              <p className="text-sm font-semibold text-yellow-800">Gmail設定が未設定です</p>
              <p className="text-sm text-yellow-700 mt-2">
                「新規設定」ボタンをクリックして、Gmail APIの認証情報を設定してください。
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border-2 border-blue-200 p-4">
            <p className="text-sm font-semibold text-blue-800">Gmail API設定</p>
            <p className="text-sm text-blue-700 mt-2">
              Google Cloud ConsoleでGmail APIを有効化し、OAuth 2.0認証情報を作成してください。
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Client ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              placeholder="例: 123456789-abcdefghijklmnop.apps.googleusercontent.com"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Client Secret <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={formData.clientSecret}
              onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
              placeholder="既存の設定を変更しない場合は空欄のまま"
            />
            <p className="text-xs text-slate-500 mt-1">
              既存の設定を変更しない場合は空欄のままにしてください
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              件名パターン（任意）
            </label>
            <input
              type="text"
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={formData.subjectPattern}
              onChange={(e) => setFormData({ ...formData, subjectPattern: e.target.value })}
              placeholder="例: [Pi5 CSV Import]"
            />
            <p className="text-xs text-slate-500 mt-1">
              メール検索時に使用する件名パターン（Gmail検索クエリ形式）
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              送信元メールアドレス（任意）
            </label>
            <input
              type="email"
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={formData.fromEmail}
              onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
              placeholder="例: powerautomate@example.com"
            />
            <p className="text-xs text-slate-500 mt-1">
              メール検索時に使用する送信元メールアドレス（指定しない場合はすべてのメールを検索）
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              リダイレクトURI <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={formData.redirectUri}
              onChange={(e) => setFormData({ ...formData, redirectUri: e.target.value })}
              placeholder="例: http://localhost:8080/api/gmail/oauth/callback"
            />
            <p className="text-xs text-slate-500 mt-1">
              Google Cloud Consoleで設定したリダイレクトURIと一致させる必要があります
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

