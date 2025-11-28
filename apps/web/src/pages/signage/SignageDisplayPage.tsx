import { useEffect, useState } from 'react';
import { useSignageContent } from '../../api/hooks';
import type { SignageContentResponse } from '../../api/client';

export function SignageDisplayPage() {
  const { data: content, error, isLoading } = useSignageContent();
  const [currentPdfPage, setCurrentPdfPage] = useState(0);
  const [pdfPages, setPdfPages] = useState<string[]>([]);

  // PDFスライドショーの自動切り替え
  useEffect(() => {
    if (content?.pdf && content.displayMode === 'SLIDESHOW' && content.pdf.pages.length > 0) {
      const interval = setInterval(() => {
        setCurrentPdfPage((prev) => (prev + 1) % content.pdf!.pages.length);
      }, 5000); // 5秒間隔（実際にはAPIから取得したslideIntervalを使用すべき）

      return () => clearInterval(interval);
    }
  }, [content?.pdf, content?.displayMode]);

  // PDFページの更新
  useEffect(() => {
    if (content?.pdf?.pages) {
      setPdfPages(content.pdf.pages);
      setCurrentPdfPage(0);
    }
  }, [content?.pdf?.pages]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <p className="text-2xl font-semibold text-red-400">エラー</p>
          <p className="mt-2 text-white/70">コンテンツの取得に失敗しました</p>
          <p className="mt-1 text-sm text-white/50">サーバーに接続できません</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white"></div>
          <p className="text-white/70">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <p className="text-white/70">コンテンツがありません</p>
        </div>
      </div>
    );
  }

  // 工具管理データのみ表示
  if (content.contentType === 'TOOLS') {
    return (
      <div className="h-screen overflow-auto bg-slate-950 p-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="mb-6 text-3xl font-bold text-white">工具管理データ</h1>
          {content.tools && content.tools.length > 0 ? (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {content.tools.map((tool) => (
                <div
                  key={tool.id}
                  className="rounded-lg border border-white/10 bg-white/5 p-4 transition-transform hover:scale-105"
                >
                  {tool.thumbnailUrl ? (
                    <img
                      src={tool.thumbnailUrl}
                      alt={tool.name}
                      className="mb-2 h-32 w-full rounded object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="mb-2 flex h-32 w-full items-center justify-center rounded bg-white/5 text-white/30">
                      画像なし
                    </div>
                  )}
                  <p className="text-sm font-semibold text-white">{tool.name}</p>
                  <p className="text-xs text-white/60">{tool.itemCode}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/70">工具データがありません</p>
          )}
        </div>
      </div>
    );
  }

  // PDFのみ表示
  if (content.contentType === 'PDF') {
    if (!content.pdf || content.pdf.pages.length === 0) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
          <div className="text-center">
            <p className="text-white/70">PDFが設定されていません</p>
          </div>
        </div>
      );
    }

    if (content.displayMode === 'SLIDESHOW') {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950">
          {pdfPages[currentPdfPage] && (
            <img
              src={pdfPages[currentPdfPage]}
              alt={`PDF Page ${currentPdfPage + 1}`}
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder-pdf.png';
              }}
            />
          )}
        </div>
      );
    } else {
      // 単一表示
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950">
          {pdfPages[0] && (
            <img
              src={pdfPages[0]}
              alt="PDF"
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder-pdf.png';
              }}
            />
          )}
        </div>
      );
    }
  }

  // 分割表示（工具管理データ + PDF）
  if (content.contentType === 'SPLIT') {
    return (
      <div className="flex h-screen bg-slate-950">
        {/* 左側: 工具管理データ */}
        <div className="w-1/2 overflow-auto border-r border-white/10 p-6">
          <h2 className="mb-4 text-2xl font-bold text-white">工具管理データ</h2>
          {content.tools && content.tools.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {content.tools.map((tool) => (
                <div
                  key={tool.id}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 transition-transform hover:scale-105"
                >
                  {tool.thumbnailUrl ? (
                    <img
                      src={tool.thumbnailUrl}
                      alt={tool.name}
                      className="mb-2 h-24 w-full rounded object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="mb-2 flex h-24 w-full items-center justify-center rounded bg-white/5 text-white/30">
                      画像なし
                    </div>
                  )}
                  <p className="text-xs font-semibold text-white">{tool.name}</p>
                  <p className="text-xs text-white/60">{tool.itemCode}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/70">工具データがありません</p>
          )}
        </div>

        {/* 右側: PDF */}
        <div className="w-1/2 overflow-auto p-6">
          <h2 className="mb-4 text-2xl font-bold text-white">PDF</h2>
          {content.pdf && content.pdf.pages.length > 0 ? (
            <div className="flex h-full items-center justify-center">
              {content.displayMode === 'SLIDESHOW' ? (
                pdfPages[currentPdfPage] && (
                  <img
                    src={pdfPages[currentPdfPage]}
                    alt={`PDF Page ${currentPdfPage + 1}`}
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder-pdf.png';
                    }}
                  />
                )
              ) : (
                pdfPages[0] && (
                  <img
                    src={pdfPages[0]}
                    alt="PDF"
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder-pdf.png';
                    }}
                  />
                )
              )}
            </div>
          ) : (
            <p className="text-white/70">PDFが設定されていません</p>
          )}
        </div>
      </div>
    );
  }

  return null;
}

