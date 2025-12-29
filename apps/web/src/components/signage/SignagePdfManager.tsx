import { FormEvent, useState } from 'react';

import { useSignagePdfs, useSignagePdfMutations } from '../../api/hooks';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import type { SignagePdf } from '../../api/client';

interface Props {
  title?: string;
}

export function SignagePdfManager({ title = 'PDF管理' }: Props) {
  const pdfsQuery = useSignagePdfs();
  const { upload, update, remove } = useSignagePdfMutations();
  const [isUploading, setIsUploading] = useState(false);
  const [formData, setFormData] = useState({
    file: null as File | null,
    name: '',
    displayMode: 'SINGLE' as 'SLIDESHOW' | 'SINGLE',
    slideInterval: null as number | null
  });

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.file) {
      alert('PDFファイルを選択してください');
      return;
    }
    try {
      setIsUploading(true);
      await upload.mutateAsync({
        file: formData.file,
        name: formData.name || formData.file.name.replace(/\.pdf$/i, ''),
        displayMode: formData.displayMode,
        slideInterval: formData.slideInterval
      });
      setFormData({
        file: null,
        name: '',
        displayMode: 'SINGLE',
        slideInterval: null
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('このPDFを削除しますか？')) {
      await remove.mutateAsync(id);
    }
  };

  const handleToggleEnabled = async (pdf: SignagePdf) => {
    await update.mutateAsync({
      id: pdf.id,
      payload: { enabled: !pdf.enabled }
    });
  };

  return (
    <Card title={title}>
      <form onSubmit={handleUpload} className="mb-6 space-y-4 rounded-lg border-2 border-slate-500 bg-white p-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700">PDFファイル</label>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
            className="mt-1 block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">名前</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="PDFファイル名から自動生成されます"
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">表示モード</label>
          <select
            value={formData.displayMode}
            onChange={(e) => setFormData({ ...formData, displayMode: e.target.value as 'SLIDESHOW' | 'SINGLE' })}
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            <option value="SINGLE">単一表示</option>
            <option value="SLIDESHOW">スライドショー</option>
          </select>
        </div>
        {formData.displayMode === 'SLIDESHOW' && (
          <div>
            <label className="block text-sm font-semibold text-slate-700">スライド間隔（秒）</label>
            <input
              type="number"
              min="1"
              value={formData.slideInterval || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  slideInterval: e.target.value ? parseInt(e.target.value, 10) : null
                })
              }
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            />
          </div>
        )}
        <Button type="submit" disabled={isUploading || upload.isPending}>
          {isUploading || upload.isPending ? 'アップロード中...' : 'アップロード'}
        </Button>
      </form>

      {pdfsQuery.isError ? (
        <p className="text-sm font-semibold text-red-600">PDF一覧の取得に失敗しました</p>
      ) : pdfsQuery.isLoading ? (
        <p className="text-sm text-slate-700">読み込み中...</p>
      ) : pdfsQuery.data && pdfsQuery.data.length > 0 ? (
        <div className="space-y-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-500 bg-slate-100">
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">名前</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">ファイル名</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">表示モード</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">スライド間隔</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">状態</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">操作</th>
              </tr>
            </thead>
            <tbody>
              {pdfsQuery.data.map((pdf: SignagePdf) => (
                <tr key={pdf.id} className="border-b border-slate-500">
                  <td className="px-4 py-2 text-sm text-slate-700">{pdf.name}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{pdf.filename}</td>
                  <td className="px-4 py-2 text-sm text-slate-700">{pdf.displayMode === 'SLIDESHOW' ? 'スライドショー' : '単一表示'}</td>
                  <td className="px-4 py-2 text-sm text-slate-700">{pdf.slideInterval ? `${pdf.slideInterval}秒` : '-'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleToggleEnabled(pdf)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        pdf.enabled ? 'bg-emerald-500/20 text-emerald-700' : 'bg-gray-500/20 text-gray-700'
                      }`}
                    >
                      {pdf.enabled ? '有効' : '無効'}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <Button onClick={() => handleDelete(pdf.id)} variant="ghost" className="px-3 py-1 text-sm text-red-600">
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-700">PDFが登録されていません。</p>
      )}
    </Card>
  );
}
