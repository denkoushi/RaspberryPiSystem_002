import { useState, useEffect } from 'react';

import { useSignageEmergency, useSignageEmergencyMutation, useSignagePdfs } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { SignagePdf } from '../../api/client';

export function SignageEmergencyPage() {
  const emergencyQuery = useSignageEmergency();
  const pdfsQuery = useSignagePdfs();
  const setEmergency = useSignageEmergencyMutation();
  const [formData, setFormData] = useState({
    enabled: false,
    message: '',
    contentType: 'TOOLS' as 'TOOLS' | 'PDF' | 'SPLIT' | null,
    pdfId: null as string | null,
    expiresAt: null as Date | null,
  });

  useEffect(() => {
    if (emergencyQuery.data) {
      setFormData({
        enabled: emergencyQuery.data.enabled || false,
        message: emergencyQuery.data.message || '',
        contentType: emergencyQuery.data.contentType || null,
        pdfId: emergencyQuery.data.pdfId || null,
        expiresAt: emergencyQuery.data.expiresAt ? new Date(emergencyQuery.data.expiresAt) : null,
      });
    }
  }, [emergencyQuery.data]);

  const handleSave = async () => {
    try {
      await setEmergency.mutateAsync({
        enabled: formData.enabled,
        message: formData.message || null,
        contentType: formData.contentType,
        pdfId: formData.pdfId,
        expiresAt: formData.expiresAt,
      });
    } catch (error) {
      console.error('Failed to set emergency:', error);
    }
  };

  const handleDisable = async () => {
    try {
      await setEmergency.mutateAsync({
        enabled: false,
        message: null,
        contentType: null,
        pdfId: null,
        expiresAt: null,
      });
      setFormData({
        enabled: false,
        message: '',
        contentType: null,
        pdfId: null,
        expiresAt: null,
      });
    } catch (error) {
      console.error('Failed to disable emergency:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="緊急表示設定">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              className="rounded border-white/10"
            />
            <label className="text-sm text-white/70">緊急表示を有効にする</label>
          </div>

          {formData.enabled && (
            <>
              <div>
                <label className="block text-sm text-white/70">コンテンツタイプ</label>
                <select
                  value={formData.contentType || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contentType: (e.target.value || null) as 'TOOLS' | 'PDF' | 'SPLIT' | null,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                >
                  <option value="">メッセージのみ</option>
                  <option value="TOOLS">工具管理データ</option>
                  <option value="PDF">PDF</option>
                </select>
              </div>

              {formData.contentType === 'PDF' && (
                <div>
                  <label className="block text-sm text-white/70">PDF</label>
                  <select
                    value={formData.pdfId || ''}
                    onChange={(e) => setFormData({ ...formData, pdfId: e.target.value || null })}
                    className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                  >
                    <option value="">選択してください</option>
                    {pdfsQuery.data?.map((pdf: SignagePdf) => (
                      <option key={pdf.id} value={pdf.id}>
                        {pdf.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formData.contentType === null && (
                <div>
                  <label className="block text-sm text-white/70">メッセージ</label>
                  <textarea
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    rows={4}
                    className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                    placeholder="緊急メッセージを入力してください"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-white/70">有効期限（任意）</label>
                <input
                  type="datetime-local"
                  value={
                    formData.expiresAt
                      ? new Date(formData.expiresAt.getTime() - formData.expiresAt.getTimezoneOffset() * 60000)
                          .toISOString()
                          .slice(0, 16)
                      : ''
                  }
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      expiresAt: e.target.value ? new Date(e.target.value) : null,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                />
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={setEmergency.isPending}>
              {setEmergency.isPending ? '保存中...' : '保存'}
            </Button>
            {formData.enabled && (
              <Button onClick={handleDisable} variant="ghost" disabled={setEmergency.isPending}>
                無効化
              </Button>
            )}
          </div>

          {emergencyQuery.data?.enabled && (
            <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm text-yellow-200">
              <p className="font-semibold">現在、緊急表示が有効です</p>
              {emergencyQuery.data.expiresAt && (
                <p className="mt-1">
                  有効期限: {new Date(emergencyQuery.data.expiresAt).toLocaleString('ja-JP')}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

