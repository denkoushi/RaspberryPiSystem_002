import { useEffect, useMemo, useState } from 'react';

import { useSignageContent } from '../../api/hooks';

import type { SignageContentResponse } from '../../api/client';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number];

const screenClass =
  'min-h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white';
const glassPanelClass =
  'rounded-[32px] border border-white/5 bg-white/5 px-6 py-6 shadow-[0_25px_90px_rgba(2,6,23,0.6)] backdrop-blur-xl';
const accentTextClass = 'text-[0.65rem] uppercase tracking-[0.4em] text-emerald-300/80';

const renderPdfImage = (src?: string, alt?: string) => {
  if (!src) {
    return null;
  }
  return (
    <img
      src={src}
      alt={alt ?? 'PDF'}
      className="max-h-full max-w-full object-contain drop-shadow-[0_25px_80px_rgba(0,0,0,0.55)]"
      onError={(e) => {
        (e.target as HTMLImageElement).src = '/placeholder-pdf.png';
      }}
    />
  );
};

function ToolCard({ tool, compact = false }: { tool: ToolItem; compact?: boolean }) {
  return (
    <div
      className={`group flex flex-col ${compact ? 'gap-2' : 'gap-3'} rounded-2xl border border-white/5 bg-white/5 p-4 shadow-[0_15px_45px_rgba(3,10,24,0.35)] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/40`}
    >
      <div
        className="relative overflow-hidden rounded-2xl bg-slate-900/40"
        style={{ aspectRatio: '4 / 3' }}
      >
        {tool.thumbnailUrl ? (
          <img
            src={tool.thumbnailUrl}
            alt={tool.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/30">画像なし</div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>
      <div>
        <p className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white/90`}>
          {tool.name}
        </p>
        <p className={`${compact ? 'text-[0.6rem]' : 'text-xs'} uppercase tracking-[0.3em] text-white/50`}>
          {tool.itemCode}
        </p>
      </div>
    </div>
  );
}

export function SignageDisplayPage() {
  const { data: content, error, isLoading } = useSignageContent();
  const [currentPdfPage, setCurrentPdfPage] = useState(0);
  const [pdfPages, setPdfPages] = useState<string[]>([]);

  const pdfIntervalMs = useMemo(() => {
    if (!content?.pdf || content.displayMode !== 'SLIDESHOW') {
      return null;
    }
    return (content.pdf.slideInterval ?? 5) * 1000;
  }, [content?.pdf, content?.displayMode]);

  useEffect(() => {
    if (pdfIntervalMs && content?.pdf?.pages?.length) {
      const interval = setInterval(() => {
        setCurrentPdfPage((prev) => (prev + 1) % content.pdf!.pages.length);
      }, pdfIntervalMs);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [content?.pdf, pdfIntervalMs]);

  useEffect(() => {
    if (content?.pdf?.pages) {
      setPdfPages(content.pdf.pages);
      setCurrentPdfPage(0);
    }
  }, [content?.pdf?.pages]);

  const renderStateScreen = (title: string, description?: string) => (
    <div className={`${screenClass} flex items-center justify-center p-10`}>
      <div className="text-center">
        <p className="text-2xl font-semibold text-white">{title}</p>
        {description ? <p className="mt-2 text-base text-white/70">{description}</p> : null}
      </div>
    </div>
  );

  if (error) {
    return renderStateScreen('コンテンツを取得できません', 'ネットワーク状態を確認してください');
  }

  if (isLoading) {
    return (
      <div className={`${screenClass} flex flex-col items-center justify-center gap-4`}>
        <div className="flex items-center gap-3 text-white/70">
          <span className="inline-flex h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          読み込み中...
        </div>
      </div>
    );
  }

  if (!content) {
    return renderStateScreen('表示できるコンテンツがありません');
  }

  if (content.contentType === 'TOOLS') {
    return (
      <div className={`${screenClass} px-6 py-8`}>
        <div className="mx-auto flex h-full max-w-[1920px] flex-col gap-6">
          <header>
            <p className={accentTextClass}>TOOLS OVERVIEW</p>
            <h1 className="text-4xl font-semibold text-white">工具在庫状況</h1>
          </header>
          <div className="flex-1 overflow-hidden rounded-[36px] border border-white/5 bg-slate-950/30 p-1">
            {content.tools && content.tools.length > 0 ? (
              <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 overflow-y-auto rounded-[30px] p-4">
                {content.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xl text-white/60">
                工具データがありません
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (content.contentType === 'PDF') {
    if (!content.pdf || content.pdf.pages.length === 0) {
      return renderStateScreen('PDFが設定されていません');
    }

    if (content.displayMode === 'SLIDESHOW') {
      return (
        <div className={`${screenClass} flex items-center justify-center p-8`}>
          <div className={`${glassPanelClass} flex h-full w-full items-center justify-center`}>
            {renderPdfImage(pdfPages[currentPdfPage], `PDF Page ${currentPdfPage + 1}`)}
          </div>
        </div>
      );
    }

    return (
      <div className={`${screenClass} flex items-center justify-center p-8`}>
        <div className={`${glassPanelClass} flex h-full w-full items-center justify-center`}>
          {renderPdfImage(pdfPages[0], 'PDF')}
        </div>
      </div>
    );
  }

  if (content.contentType === 'SPLIT') {
    return (
      <div className={`${screenClass} px-6 py-8`}>
        <div className="mx-auto grid h-full max-w-[1920px] grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <section className={`flex min-h-0 flex-col gap-4 ${glassPanelClass}`}>
            <div>
              <p className={accentTextClass}>TOOLS</p>
              <h2 className="text-3xl font-semibold text-white">工具管理データ</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {content.tools && content.tools.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                  {content.tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} compact />
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-white/60">
                  工具データがありません
                </div>
              )}
            </div>
          </section>

          <section className={`flex min-h-0 flex-col gap-4 ${glassPanelClass}`}>
            <div>
              <p className={accentTextClass}>DOCUMENT</p>
              <h2 className="text-3xl font-semibold text-white">PDF表示</h2>
            </div>
            <div className="flex flex-1 items-center justify-center">
              {content.pdf && content.pdf.pages.length > 0 ? (
                content.displayMode === 'SLIDESHOW'
                  ? renderPdfImage(pdfPages[currentPdfPage], `PDF Page ${currentPdfPage + 1}`)
                  : renderPdfImage(pdfPages[0], 'PDF')
              ) : (
                <p className="text-white/60">PDFが設定されていません</p>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return null;
}

