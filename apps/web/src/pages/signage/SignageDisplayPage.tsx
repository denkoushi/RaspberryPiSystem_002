import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSignageContent } from '../../api/hooks';

import type { SignageContentResponse } from '../../api/client';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number];
type InstrumentItem = NonNullable<SignageContentResponse['measuringInstruments']>[number];

// 仕様: 表示領域の最大化が最重要のため、余白を最小化（outerPadding=0、innerPadding約10px相当）
// モニター仕様: 1920x1080（Full HD、16:9アスペクト比）を基準に設計
const screenClass = 'h-screen w-screen bg-slate-800 text-white overflow-hidden';
const panelClass = 'rounded-lg border border-white/10 bg-slate-900/60 p-2';

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
  const isRigging = Boolean(tool.isRigging);
  const isOverdue = Boolean(tool.isOver12Hours);
  
  // 仕様: 計測機器は藍系背景、吊具はオレンジ系背景、工具は従来の背景
  const borderClass = isInstrument
    ? 'border-indigo-400/40'
    : isRigging
      ? 'border-orange-400/40'
      : isOverdue
        ? 'border-red-600'
        : 'border-white/5';
  const bgClass = isInstrument 
    ? 'bg-indigo-900/30' 
    : isRigging
      ? 'bg-orange-900/30'
      : 'bg-white/5';
  
  // 仕様: 期限超過アイテムは赤い太枠（4px以上）
  const borderWidth = isOverdue ? 'border-4' : 'border';
  
  // 借出日時をフォーマット（signage rendererと同じ形式: "MM/DD HH:mm"）
  const formatBorrowedDateTime = (borrowedAt: string | null | undefined) => {
    if (!borrowedAt) return { date: null, time: null };
    const date = new Date(borrowedAt);
    if (Number.isNaN(date.getTime())) return { date: null, time: null };
    // 日本時間（JST）でフォーマット（signage rendererと同じ）
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find(p => p.type === 'month')?.value ?? '';
    const day = parts.find(p => p.type === 'day')?.value ?? '';
    const hour = parts.find(p => p.type === 'hour')?.value ?? '';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '';
    return { date: `${month}/${day}`, time: `${hour}:${minute}` };
  };
  
  const { date, time } = formatBorrowedDateTime(tool.borrowedAt);
  
  // 管理番号/アイテムコード（右下隅に表示）
  const codeDisplay = isInstrument 
    ? (tool.managementNumber ?? tool.itemCode)
    : isRigging
      ? (tool.managementNumber ?? tool.itemCode)
      : tool.itemCode;
  
  return (
    <div
      className={`relative flex flex-col ${compact ? 'gap-2' : 'gap-3'} rounded-2xl ${borderWidth} ${borderClass} ${bgClass} p-4 shadow-[0_15px_45px_rgba(3,10,24,0.35)]`}
    >
      <div
        className="relative overflow-hidden rounded-2xl bg-slate-900/40"
        style={{ aspectRatio: '4 / 3' }}
      >
        {tool.thumbnailUrl ? (
          <img
            src={tool.thumbnailUrl}
            alt={tool.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/30 text-sm">
            {isInstrument ? '計測機器' : isRigging ? '吊具' : '画像なし'}
          </div>
        )}
      </div>
      <div className="space-y-0">
        {/* 1. アイテム名（9px、太字、白）+ 管理番号/アイテムコード（右横、14px、等幅フォント、白） */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-semibold text-white">
            {tool.name}
          </p>
          <p className="text-sm font-mono text-white">
            {codeDisplay}
          </p>
        </div>
        
        {/* 2. 従業員名（16px、白、左揃え）+ 日付 + 時刻（右揃え、スペース区切り、14px、白） */}
        <div className="flex items-center justify-between gap-2">
          {tool.employeeName && (
            <p className="text-base text-white">
              {tool.employeeName}
            </p>
          )}
          {(date || time) && (
            <p className="text-sm text-white">
              {date && <span>{date}</span>}
              {date && time && <span> {time}</span>}
              {!date && time && <span>{time}</span>}
            </p>
          )}
        </div>
        
        {/* 3. 警告（期限超過の場合、「⚠ 期限超過」、14px、白） */}
        {isOverdue && (
          <p className="text-sm text-white">
            ⚠ 期限超過
          </p>
        )}
      </div>
    </div>
  );
}

function InstrumentCard({ instrument }: { instrument: InstrumentItem }) {
  // 仕様: バッジの色分け（WCAG AAA準拠のコントラスト比を維持）
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
  const [searchParams] = useSearchParams();
  const forceMockSplit = searchParams.get('mock') === 'split';
  const [currentPdfPage, setCurrentPdfPage] = useState(0);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  
  // デザイン確認用: SPLITモードを強制表示（URLパラメータで強制表示: ?mock=split）
  const mockSplitContent: SignageContentResponse | null = 
    forceMockSplit
      ? {
          contentType: 'SPLIT',
          displayMode: 'SINGLE',
          tools: [
            {
              id: '1',
              name: 'ドライバーセット',
              itemCode: 'T00001',
              thumbnailUrl: null,
              borrowedAt: new Date().toISOString(),
              employeeName: '山田太郎',
              isInstrument: false,
              isRigging: false,
              isOver12Hours: false,
            },
            {
              id: '2',
              name: 'メジャー',
              itemCode: 'T00002',
              thumbnailUrl: null,
              borrowedAt: new Date().toISOString(),
              employeeName: '佐藤花子',
              isInstrument: false,
              isRigging: false,
              isOver12Hours: false,
            },
            {
              id: '3',
              name: 'ハンマー',
              itemCode: 'T00003',
              thumbnailUrl: null,
              borrowedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
              employeeName: '鈴木一郎',
              isInstrument: false,
              isRigging: false,
              isOver12Hours: true,
            },
            {
              id: '4',
              name: 'トルクレンチ',
              itemCode: 'T00004',
              thumbnailUrl: null,
              borrowedAt: new Date().toISOString(),
              employeeName: '田中次郎',
              isInstrument: false,
              isRigging: false,
              isOver12Hours: false,
            },
            {
              id: '5',
              name: '計測機器1',
              itemCode: 'M00001',
              thumbnailUrl: null,
              borrowedAt: new Date().toISOString(),
              employeeName: '山本三郎',
              isInstrument: true,
              isRigging: false,
              isOver12Hours: false,
            },
            {
              id: '6',
              name: '計測機器2',
              itemCode: 'M00002',
              thumbnailUrl: null,
              borrowedAt: new Date().toISOString(),
              employeeName: '中村四郎',
              isInstrument: true,
              isRigging: false,
              isOver12Hours: false,
            },
          ],
          pdf: {
            id: 'pdf1',
            name: 'サンプルPDF.pdf',
            pages: ['/api/signage/pdfs/pdf1/page/1'],
          },
          measuringInstruments: [],
        }
      : null;
  
  // モックデータがある場合はAPIを呼ばない
  const { data: content, error, isLoading } = useSignageContent();
  
  // モックデータを優先（デザイン確認用）
  const displayContent = mockSplitContent || content;

  const pdfIntervalMs = useMemo(() => {
    const pdfContent = displayContent?.pdf;
    if (!pdfContent || displayContent?.displayMode !== 'SLIDESHOW') {
      return null;
    }
    return (pdfContent.slideInterval ?? 5) * 1000;
  }, [displayContent?.pdf, displayContent?.displayMode]);

  useEffect(() => {
    if (pdfIntervalMs && displayContent?.pdf?.pages?.length) {
      const interval = setInterval(() => {
        setCurrentPdfPage((prev) => (prev + 1) % displayContent.pdf!.pages.length);
      }, pdfIntervalMs);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [displayContent?.pdf, pdfIntervalMs]);

  useEffect(() => {
    if (displayContent?.pdf?.pages) {
      setPdfPages(displayContent.pdf.pages);
      setCurrentPdfPage(0);
    }
  }, [displayContent?.pdf?.pages]);

  const renderStateScreen = (title: string, description?: string) => (
    <div className={`${screenClass} flex items-center justify-center`}>
      <div className="text-center">
        <p className="text-xl font-semibold text-white">{title}</p>
        {description ? <p className="mt-2 text-sm text-white/70">{description}</p> : null}
      </div>
    </div>
  );

  // エラー時でもモックデータがあれば表示
  // モックデータがある場合はエラーでも表示
  if (error && !mockSplitContent) {
    return renderStateScreen('コンテンツを取得できません', 'ネットワーク状態を確認してください');
  }

  // モックデータがある場合はローディング中でも表示
  if (isLoading && !mockSplitContent) {
    return (
      <div className={`${screenClass} flex flex-col items-center justify-center`}>
        <div className="flex items-center gap-3 text-white/70">
          <span className="inline-flex h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <span className="text-sm">読み込み中...</span>
        </div>
      </div>
    );
  }

  if (!displayContent) {
    return renderStateScreen('表示できるコンテンツがありません');
  }

  // SPLITモードを優先表示（デザイン確認用）
  if (displayContent.contentType === 'SPLIT') {
    return (
      <div className={screenClass}>
        {/* 仕様: 左右分割表示（工具管理データとPDFを同時表示）、余白を最小化 */}
        {/* モニター仕様: 1920x1080（16:9）にフィットするレイアウト */}
        <div className="grid h-full w-full grid-cols-1 gap-2 p-1 lg:grid-cols-[3fr_2fr]">
          <section className={`flex min-h-0 flex-col gap-1 ${panelClass}`}>
            {/* 仕様: タイトルは1行表示、フォントサイズ20px、フォントウェイト600 */}
            <div className="flex-shrink-0">
              <h2 className="text-xl font-semibold text-white" style={{ fontSize: '20px', fontWeight: 600 }}>持出中アイテム</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {displayContent.tools && displayContent.tools.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {displayContent.tools.map((tool: ToolItem) => (
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

          <section className={`flex min-h-0 flex-col gap-1 ${panelClass}`}>
            {/* 仕様: 右ペインはタイトル直下からPDFを始めるため、ヘッダー高さを最小化 */}
            {/* 仕様: タイトルは1行表示、フォントサイズ20px、フォントウェイト600 */}
            <div className="flex-shrink-0 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white" style={{ fontSize: '20px', fontWeight: 600 }}>ドキュメント</h2>
              {displayContent.pdf?.name ? (
                <span className="text-[10px] text-white/60">{displayContent.pdf.name}</span>
              ) : null}
            </div>
            {/* 仕様: 黒地（PDFエリア）を最優先で拡大 */}
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {displayContent.pdf && displayContent.pdf.pages.length > 0 ? (
                displayContent.displayMode === 'SLIDESHOW'
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

  if (displayContent.contentType === 'TOOLS') {
    return (
      <div className={screenClass}>
        <div className="flex h-full w-full flex-col gap-2 p-1">
          {/* 仕様: タイトルは1行表示、ヘッダー高さを縮小 */}
          <header className="flex-shrink-0">
            <h1 className="text-xl font-semibold text-white">工具在庫状況</h1>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/5 bg-slate-950/40">
            {displayContent.tools && displayContent.tools.length > 0 ? (
              <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 overflow-y-auto p-2">
                {displayContent.tools.map((tool: ToolItem) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-lg text-white/60">
                工具データがありません
              </div>
            )}
          </div>
          {displayContent.measuringInstruments && displayContent.measuringInstruments.length > 0 ? (
            <section className={`${panelClass} flex-shrink-0`}>
              <div className="mb-1">
                <h2 className="text-lg font-semibold text-white">計測機器ステータス</h2>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
                {displayContent.measuringInstruments.map((inst: InstrumentItem) => (
                  <InstrumentCard key={inst.id} instrument={inst} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  if (displayContent.contentType === 'PDF') {
    if (!displayContent.pdf || displayContent.pdf.pages.length === 0) {
      return renderStateScreen('PDFが設定されていません');
    }

    if (displayContent.displayMode === 'SLIDESHOW') {
      return (
        <div className={screenClass}>
          {/* 仕様: 余白を最小化、表示領域最大化 */}
          <div className="flex h-full w-full items-center justify-center p-1">
            {renderPdfImage(pdfPages[currentPdfPage], `PDF Page ${currentPdfPage + 1}`)}
          </div>
        </div>
      );
    }

    return (
      <div className={screenClass}>
        {/* 仕様: 余白を最小化、表示領域最大化 */}
        <div className="flex h-full w-full items-center justify-center p-1">
          {renderPdfImage(pdfPages[0], 'PDF')}
        </div>
      </div>
    );
  }

  if (displayContent.contentType === 'SPLIT') {
    return (
      <div className={screenClass}>
        {/* 仕様: 左右分割表示（工具管理データとPDFを同時表示）、余白を最小化 */}
        {/* モニター仕様: 1920x1080（16:9）にフィットするレイアウト */}
        <div className="grid h-full w-full grid-cols-1 gap-2 p-1 lg:grid-cols-[3fr_2fr]">
          <section className={`flex min-h-0 flex-col gap-1 ${panelClass}`}>
            {/* 仕様: タイトルは1行表示、フォントサイズ20px、フォントウェイト600 */}
            <div className="flex-shrink-0">
              <h2 className="text-xl font-semibold text-white" style={{ fontSize: '20px', fontWeight: 600 }}>持出中アイテム</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {displayContent.tools && displayContent.tools.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {displayContent.tools.map((tool: ToolItem) => (
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

          <section className={`flex min-h-0 flex-col gap-1 ${panelClass}`}>
            {/* 仕様: 右ペインはタイトル直下からPDFを始めるため、ヘッダー高さを最小化 */}
            {/* 仕様: タイトルは1行表示、フォントサイズ20px、フォントウェイト600 */}
            <div className="flex-shrink-0 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white" style={{ fontSize: '20px', fontWeight: 600 }}>ドキュメント</h2>
              {displayContent.pdf?.name ? (
                <span className="text-[10px] text-white/60">{displayContent.pdf.name}</span>
              ) : null}
            </div>
            {/* 仕様: 黒地（PDFエリア）を最優先で拡大 */}
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {displayContent.pdf && displayContent.pdf.pages.length > 0 ? (
                displayContent.displayMode === 'SLIDESHOW'
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

