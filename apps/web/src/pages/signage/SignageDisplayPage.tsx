import { useEffect, useMemo, useState } from 'react';

import { useSignageContent } from '../../api/hooks';

import type { SignageContentResponse } from '../../api/client';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number];
type InstrumentItem = NonNullable<SignageContentResponse['measuringInstruments']>[number];

const screenClass = 'min-h-screen w-screen bg-slate-800 text-white';
const panelClass = 'rounded-xl border border-white/5 bg-slate-900/40 p-3';

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
  const isInstrument = Boolean(tool.isInstrument);
  
  // 計測機器は藍系背景、工具は従来の背景
  const borderClass = isInstrument
    ? 'border-indigo-400/40 hover:border-indigo-300/60'
    : 'border-white/5 hover:border-emerald-400/40';
  const bgClass = isInstrument ? 'bg-indigo-900/30' : 'bg-white/5';
  
  return (
    <div
      className={`group flex flex-col ${compact ? 'gap-2' : 'gap-3'} rounded-2xl border ${borderClass} ${bgClass} p-4 shadow-[0_15px_45px_rgba(3,10,24,0.35)] transition-all duration-300 hover:-translate-y-1`}
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
          <div className="flex h-full w-full items-center justify-center text-white/30">
            {isInstrument ? '計測機器' : '画像なし'}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>
      <div>
        {isInstrument ? (
          <>
            <p className={`${compact ? 'text-[0.6rem]' : 'text-xs'} font-semibold uppercase tracking-[0.2em] text-indigo-200/80`}>
              {tool.managementNumber ?? tool.itemCode}
            </p>
            <p className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white/90`}>
              {tool.name}
            </p>
          </>
        ) : (
          <>
            <p className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white/90`}>
              {tool.name}
            </p>
            <p className={`${compact ? 'text-[0.6rem]' : 'text-xs'} uppercase tracking-[0.3em] text-white/50`}>
              {tool.itemCode}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function InstrumentCard({ instrument }: { instrument: InstrumentItem }) {
  const badgeClass = instrument.isOverdue
    ? 'bg-red-500/20 text-red-200'
    : instrument.isDueSoon
      ? 'bg-yellow-500/20 text-yellow-200'
      : 'bg-emerald-500/20 text-emerald-200';
  const badgeText = instrument.isOverdue ? '校正期限切れ' : instrument.isDueSoon ? '校正期限間近' : '正常';
  return (
    <div className="rounded-2xl border border-white/5 bg-white/5 p-4 shadow-[0_15px_45px_rgba(3,10,24,0.35)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-white/90">{instrument.name}</p>
          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/50">{instrument.managementNumber}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass}`}>{badgeText}</span>
      </div>
      <p className="mt-2 text-sm text-white/80">
        保管: {instrument.storageLocation ?? '-'} / 状態: {instrument.status}
      </p>
      <p className="text-sm text-white/70">
        校正期限: {instrument.calibrationExpiryDate ? instrument.calibrationExpiryDate.slice(0, 10) : '未設定'}
      </p>
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
  <div className={`${screenClass} flex items-center justify-center p-6`}>
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
      <div className={`${screenClass} px-2 py-2`}>
        <div className="mx-auto flex h-full w-full flex-col gap-3">
          <header>
            <h1 className="text-3xl font-semibold text-white">工具在庫状況</h1>
          </header>
          <div className="flex-1 overflow-hidden rounded-xl border border-white/5 bg-slate-950/40 p-1">
            {content.tools && content.tools.length > 0 ? (
              <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 overflow-y-auto rounded-xl p-3">
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
          {content.measuringInstruments && content.measuringInstruments.length > 0 ? (
            <section className={`${panelClass} mt-2`}>
              <div className="mb-2">
                <h2 className="text-xl font-semibold text-white">計測機器ステータス</h2>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
                {content.measuringInstruments.map((inst) => (
                  <InstrumentCard key={inst.id} instrument={inst} />
                ))}
              </div>
            </section>
          ) : null}
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
        <div className={`${screenClass} flex items-center justify-center p-4`}>
          <div className={`${panelClass} flex h-full w-full items-center justify-center`}>
            {renderPdfImage(pdfPages[currentPdfPage], `PDF Page ${currentPdfPage + 1}`)}
          </div>
        </div>
      );
    }

    return (
      <div className={`${screenClass} flex items-center justify-center p-4`}>
        <div className={`${panelClass} flex h-full w-full items-center justify-center`}>
          {renderPdfImage(pdfPages[0], 'PDF')}
        </div>
      </div>
    );
  }

  if (content.contentType === 'SPLIT') {
    return (
      <div className={`${screenClass} px-2 py-2`}>
        <div className="mx-auto grid h-full w-full grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
          <section className={`flex min-h-0 flex-col gap-2 ${panelClass}`}>
            <div>
              <h2 className="text-2xl font-semibold text-white">工具管理データ</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {content.tools && content.tools.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
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

          <section className={`flex min-h-0 flex-col gap-2 ${panelClass}`}>
            <div>
              <h2 className="text-2xl font-semibold text-white">計測機器ステータス</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {content.measuringInstruments && content.measuringInstruments.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
                  {content.measuringInstruments.map((inst) => (
                    <InstrumentCard key={inst.id} instrument={inst} />
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-white/60">
                  計測機器データがありません
                </div>
              )}
            </div>
          </section>

          <section className={`flex min-h-0 flex-col gap-2 ${panelClass}`}>
            <div className="flex flex-col">
              <h2 className="text-2xl font-semibold text-white">PDF表示</h2>
              {content.pdf?.name ? (
                <span className="text-xs text-white/60">{content.pdf.name}</span>
              ) : null}
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

