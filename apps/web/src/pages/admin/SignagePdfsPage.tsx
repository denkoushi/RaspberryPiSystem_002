import { FormEvent, useState } from 'react';
import { useSignagePdfs, useSignagePdfMutations } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { SignagePdf } from '../../api/client';

export function SignagePdfsPage() {
  const pdfsQuery = useSignagePdfs();
  const { upload, update, remove } = useSignagePdfMutations();
  const [isUploading, setIsUploading] = useState(false);
  const [formData, setFormData] = useState({
    file: null as File | null,
    name: '',
    displayMode: 'SINGLE' as 'SLIDESHOW' | 'SINGLE',
    slideInterval: null as number | null,
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
        slideInterval: formData.slideInterval,
      });
      setFormData({
        file: null,
        name: '',
        displayMode: 'SINGLE',
        slideInterval: null,
      });
      setIsUploading(false);
    } catch (error) {
      console.error('Failed to upload PDF:', error);
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
      payload: { enabled: !pdf.enabled },
    });
  };

  return (
    <div className="space-y-6">
      <Card title="PDF管理">
        <form onSubmit={handleUpload} className="mb-6 space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
          <div>
            <label className="block text-sm text-white/70">PDFファイル</label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
              className="mt-1 block w-full text-sm text-white/80"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">名前</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="PDFファイル名から自動生成されます"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">表示モード</label>
            <select
              value={formData.displayMode}
              onChange={(e) => setFormData({ ...formData, displayMode: e.target.value as 'SLIDESHOW' | 'SINGLE' })}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
            >
              <option value="SINGLE">単一表示</option>
              <option value="SLIDESHOW">スライドショー</option>
            </select>
          </div>
          {formData.displayMode === 'SLIDESHOW' && (
            <div>
              <label className="block text-sm text-white/70">スライド間隔（秒）</label>
              <input
                type="number"
                min="1"
                value={formData.slideInterval || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    slideInterval: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
            </div>
          )}
          <Button type="submit" disabled={isUploading || upload.isPending}>
            {isUploading || upload.isPending ? 'アップロード中...' : 'アップロード'}
          </Button>
        </form>

        {pdfsQuery.isError ? (
          <p className="text-red-400">PDF一覧の取得に失敗しました</p>
        ) : pdfsQuery.isLoading ? (
          <p>読み込み中...</p>
        ) : pdfsQuery.data && pdfsQuery.data.length > 0 ? (
          <div className="space-y-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-2 text-left">名前</th>
                  <th className="px-4 py-2 text-left">ファイル名</th>
                  <th className="px-4 py-2 text-left">表示モード</th>
                  <th className="px-4 py-2 text-left">スライド間隔</th>
                  <th className="px-4 py-2 text-left">状態</th>
                  <th className="px-4 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {pdfsQuery.data.map((pdf: SignagePdf) => (
                  <tr key={pdf.id} className="border-b border-white/5">
                    <td className="px-4 py-2">{pdf.name}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{pdf.filename}</td>
                    <td className="px-4 py-2">
                      {pdf.displayMode === 'SLIDESHOW' ? 'スライドショー' : '単一表示'}
                    </td>
                    <td className="px-4 py-2">{pdf.slideInterval ? `${pdf.slideInterval}秒` : '-'}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleToggleEnabled(pdf)}
                        className={`rounded-md px-2 py-1 text-xs ${
                          pdf.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {pdf.enabled ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        onClick={() => handleDelete(pdf.id)}
                        variant="ghost"
                        className="px-3 py-1 text-sm text-red-400"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>PDFが登録されていません。</p>
        )}
      </Card>
    </div>
  );
}

