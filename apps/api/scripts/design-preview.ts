import { promises as fs } from 'fs';
import path from 'path';

import type { TableVisualizationData } from '../src/services/visualization/visualization.types.js';
import { formatLoanInspectionInstrumentLabel } from '../src/services/visualization/data-sources/measuring-instrument-loan-inspection/format-loan-inspection-instrument-label.js';
import {
  createMd3Tokens,
  renderCssVars,
  tokensToCssVars,
} from '../src/services/visualization/renderers/_design-system/index.js';
import { computeSplitPaneGeometry } from '../src/services/signage/signage-layout-math.js';
import { MeasuringInstrumentLoanInspectionRenderer } from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/measuring-instrument-loan-inspection-renderer.js';
import { MI_RETURNED_COUNT_COLUMN } from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/row-priority.js';
import { sortRowsForDisplay } from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/row-priority.js';
import { parseRowInstrumentEntries } from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/row-instrument-entries.js';
import {
  getHeaderBodyGapCssPixels,
  MI_CARD_INNER_PAD_PX,
} from '../src/services/visualization/renderers/measuring-instrument-loan-inspection/mi-instrument-card-metrics.js';

const PREVIEW_WIDTH = 1920;
const PREVIEW_HEIGHT = 1080;

type PreviewConfig = {
  width: number;
  height: number;
};

function repoRootFromCwd(cwd: string): string {
  // Expected cwd: .../apps/api
  return path.resolve(cwd, '..', '..');
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function sampleMeasuringInstrumentLoanInspectionTable(): TableVisualizationData {
  return {
    kind: 'table',
    columns: ['従業員名', '点検件数', '貸出中計測機器数', '返却件数', '計測機器名称一覧', '計測機器明細'],
    rows: [
      {
        従業員名: '山田 太郎',
        点検件数: 2,
        貸出中計測機器数: 2,
        返却件数: 1,
        計測機器名称一覧: 'デジタルノギス (MI-001), マイクロメータ (MI-002), トルクレンチ (MI-003)',
        計測機器明細: JSON.stringify([
          { kind: 'active' as const, managementNumber: 'MI-001', name: 'デジタルノギス' },
          { kind: 'active' as const, managementNumber: 'MI-002', name: 'マイクロメータ' },
          { kind: 'returned' as const, managementNumber: 'MI-003', name: 'トルクレンチ' },
        ]),
      },
      { 従業員名: '佐藤 花子', 点検件数: 0, 貸出中計測機器数: 1, 返却件数: 0, 計測機器名称一覧: 'トルクレンチ (MI-003)', 計測機器明細: '' },
      {
        従業員名: '高橋 一郎',
        点検件数: 1,
        貸出中計測機器数: 3,
        返却件数: 0,
        計測機器名称一覧: 'デジタルノギス (MI-004), トルクレンチ (MI-005), ブロックゲージセット (MI-006)',
        計測機器明細: '',
      },
      { 従業員名: '伊藤 晴美', 点検件数: 0, 貸出中計測機器数: 0, 返却件数: 0, 計測機器名称一覧: '', 計測機器明細: '' },
      { 従業員名: '渡辺 直人', 点検件数: 1, 貸出中計測機器数: 1, 返却件数: 0, 計測機器名称一覧: 'マイクロメータ (MI-007)', 計測機器明細: '' },
      {
        従業員名: '中村 美咲',
        点検件数: 0,
        貸出中計測機器数: 2,
        返却件数: 0,
        計測機器名称一覧: 'トルクレンチ (MI-008), 高精度測長器 (MI-009)',
        計測機器明細: '',
      },
      {
        従業員名: '小林 健',
        点検件数: 3,
        貸出中計測機器数: 4,
        返却件数: 0,
        計測機器名称一覧:
          'デジタルノギス (MI-010), トルクレンチ (MI-011), マイクロメータ (MI-012), 高精度測長器 (MI-013)',
        計測機器明細: '',
      },
      { 従業員名: '加藤 亜紀', 点検件数: 0, 貸出中計測機器数: 1, 返却件数: 0, 計測機器名称一覧: 'テーパーゲージ (MI-014)', 計測機器明細: '' },
    ],
    metadata: {
      targetDate: '2026-02-25',
      sectionEquals: '加工担当部署',
      totalUsers: 8,
      inspectedUsers: 4,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toNumberCell(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

type MiLoanCardHtmlOptions = {
  /** `.mi-card__band` に付与（帯色サンプル用の修飾クラス） */
  bandExtraClass?: string;
  /** `<article />` に付与（帯の薄色味 T1〜T4 用・例: `mi-card--band-tint-succ`） */
  cardExtraClass?: string;
};

/**
 * 実装前の見た目合意用: 帯（ヘッダ行）＋帯下〜明細のすき（--mi-header-body-gap）をいじれる HTML。
 * 本文の並びは parseRowInstrumentEntries に寄せ、SVG レンダラーと同じ解釈にする。
 */
function buildMiLoanInspectionCardHtml(row: MiLoanInspectionTableRow, options?: MiLoanCardHtmlOptions): string {
  const activeLoanCount = toNumberCell(row['貸出中計測機器数'], 0);
  const returnedLoanCount = toNumberCell(row[MI_RETURNED_COUNT_COLUMN], 0);
  const hasLoans = activeLoanCount > 0 || returnedLoanCount > 0;
  const employeeName = String(row['従業員名'] ?? '-');
  const entries = parseRowInstrumentEntries(row);
  const bodyLines: string[] = [];
  for (const e of entries) {
    if (e.kind === 'active') {
      const mg = e.managementNumber.trim() || '—';
      const nm = e.name.trim() || '—';
      bodyLines.push(`<div class="mi-line mi-line--mgmt">${escapeHtml(mg)}</div>`);
      bodyLines.push(`<div class="mi-line mi-line--name">${escapeHtml(nm)}</div>`);
    } else {
      const label = formatLoanInspectionInstrumentLabel(e.name, e.managementNumber).trim() || '-';
      bodyLines.push(`<div class="mi-line mi-line--returned">${escapeHtml(label)}</div>`);
    }
  }
  if (bodyLines.length === 0) {
    bodyLines.push('<div class="mi-line mi-line--empty">-</div>');
  }
  const cardClass = hasLoans ? 'mi-card mi-card--loans' : 'mi-card mi-card--empty';
  const cardEx = options?.cardExtraClass?.trim() ? ` ${options.cardExtraClass.trim()}` : '';
  const bandEx = options?.bandExtraClass?.trim() ? ` ${options.bandExtraClass.trim()}` : '';
  return `
  <article class="${cardClass}${cardEx}">
    <div class="mi-card__band${bandEx}">
      <span class="mi-card__name">${escapeHtml(employeeName)}</span>
      <span class="mi-card__counts">貸出中 ${activeLoanCount} ・ 返却 ${returnedLoanCount}</span>
    </div>
    <div class="mi-card__body">
      ${bodyLines.join('')}
    </div>
  </article>`;
}

type LoanBandVariant = { id: string; label: string; bandClass: string };
type LoanBandHueVariant = { id: string; label: string; cardClass: string };
type EmptyBandVariant = { id: string; label: string; bandClass: string };

/**
 * 視認性・カラーバランス優先（帯は本文 info 地より一階調しっかり、表題はトークンでコントラスト確保）
 */
const LOAN_BAND_BALANCED: readonly LoanBandVariant[] = [
  {
    id: 'R1',
    label: 'ニュートラル: surface 最上階の帯＋表題=primary（青本文との境界が最も明瞭）',
    bandClass: 'mi-band--r1',
  },
  {
    id: 'R2',
    label: '青階調: 帯を地より一段濃い青（黒 12% 混ぜ）＋表題=on-info',
    bandClass: 'mi-band--r2',
  },
  {
    id: 'R3',
    label: '推奨（既定）: text-primary 24% 混ぜ（10% より帯の存在感とコントラストが安定）',
    bandClass: 'mi-band--r3',
  },
  {
    id: 'R4',
    label: '青統一: status-info 28% 混ぜ（トーン揃えで帯だけ際立たせる）',
    bandClass: 'mi-band--r4',
  },
  {
    id: 'R5',
    label: 'R3 ＋ 帯下 1px 区切り（outline 系）',
    bandClass: 'mi-band--r5',
  },
];

/** 本文 info 地に馴染む「薄い色味」アクセント（地と帯の喧嘩を避ける）表題は on-info 統一 */
const LOAN_BAND_TINT: readonly LoanBandHueVariant[] = [
  { id: 'T1', label: '薄緑: success 20% を地に重ね＋on-info 表題', cardClass: 'mi-card--band-tint-succ' },
  { id: 'T2', label: '薄赤: error 15% 混ぜ＋on-info 表題', cardClass: 'mi-card--band-tint-err' },
  { id: 'T3', label: '薄青: status-info 34% 混ぜ＋on-info 表題', cardClass: 'mi-card--band-tint-info' },
  { id: 'T4', label: '薄暖: warning 22% 混ぜ＋on-info 表題', cardClass: 'mi-card--band-tint-warn' },
];

const EMPTY_BAND_BALANCED: readonly EmptyBandVariant[] = [
  { id: 'E1', label: '地より一段明るい帯: 10% primary ＋ #020617', bandClass: 'mi-band--e1' },
  { id: 'E2', label: '階調分離: surface-container 帯＋表題=primary', bandClass: 'mi-band--e2' },
  { id: 'E3', label: 'E1 ＋ 帯下 1px（outline 40%）', bandClass: 'mi-band--e3' },
];

/**
 * 帯色だけを複数パターン並べ、選定用にブラウザで比較する専用ページ。
 * 貸出あり・貸出なしを同一レイアウトで並べる。
 */
function buildBandColorSamplesPageHtml(
  tokensCss: string,
  options: { loanRow: MiLoanInspectionTableRow; emptyRow: MiLoanInspectionTableRow; generatedAtIso: string },
): string {
  const headerBodyGapPx = getHeaderBodyGapCssPixels();
  const cardPadX = `${MI_CARD_INNER_PAD_PX}px`;

  const loanBalancedFigures = LOAN_BAND_BALANCED.map(
    (v) => `<figure class="mi-band-fig">
  <figcaption class="mi-band-fig__caption"><strong>${v.id}</strong> — ${escapeHtml(v.label)}</figcaption>
  ${buildMiLoanInspectionCardHtml(options.loanRow, { bandExtraClass: v.bandClass })}
</figure>`,
  ).join('\n');

  const loanTintFigures = LOAN_BAND_TINT.map(
    (v) => `<figure class="mi-band-fig">
  <figcaption class="mi-band-fig__caption"><strong>${v.id}</strong> — ${escapeHtml(v.label)}</figcaption>
  ${buildMiLoanInspectionCardHtml(options.loanRow, { cardExtraClass: v.cardClass })}
</figure>`,
  ).join('\n');

  const emptyFigures = EMPTY_BAND_BALANCED.map(
    (v) => `<figure class="mi-band-fig">
  <figcaption class="mi-band-fig__caption"><strong>${v.id}</strong> — ${escapeHtml(v.label)}</figcaption>
  ${buildMiLoanInspectionCardHtml(options.emptyRow, { bandExtraClass: v.bandClass })}
</figure>`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>帯色サンプル — 計測機器持出カード</title>
  <style>
${tokensCss}

    :root {
      --mi-header-body-gap: ${headerBodyGapPx}px;
      --mi-card-pad-x: ${cardPadX};
      --mi-card-pad-y: 10px;
      --mi-surface: var(--rps-md3-color-surface-background);
    }
    * { box-sizing: border-box; }
    body.mi-band-samples {
      margin: 0;
      min-height: 100vh;
      background: var(--mi-surface);
      color: var(--rps-md3-color-text-primary);
      font-family: system-ui, -apple-system, 'Noto Sans JP', 'Roboto', sans-serif;
      padding: 20px 16px 32px;
    }
    .mi-band-samples h1 {
      font-size: 1.35rem;
      margin: 0 0 8px 0;
    }
    .mi-band-samples .lead {
      margin: 0 0 16px 0;
      font-size: 0.95rem;
      color: var(--rps-md3-color-text-secondary);
      line-height: 1.55;
      max-width: 960px;
    }
    .mi-band-samples h2 {
      font-size: 1.05rem;
      margin: 24px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--rps-md3-color-outline);
    }
    .mi-band-samples__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px 20px;
      align-content: start;
    }
    .mi-band-fig {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mi-band-fig__caption {
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--rps-md3-color-text-secondary);
    }
    .mi-card {
      border-radius: 10px;
      overflow: hidden;
      min-height: 0;
    }
    .mi-card--loans {
      background: var(--rps-md3-color-status-info-container);
    }
    .mi-card--empty {
      background: #020617;
      border: 1px solid var(--rps-md3-color-card-border);
    }
    /* 帯 R1〜R5（本文は info 地。R1 だけ帯=ニュートラル＋表題=primary） */
    .mi-card--loans .mi-card__band.mi-band--r1 {
      background: var(--rps-md3-color-surface-container-highest);
    }
    .mi-card--loans .mi-card__band.mi-band--r1 .mi-card__name,
    .mi-card--loans .mi-card__band.mi-band--r1 .mi-card__counts {
      color: var(--rps-md3-color-text-primary);
    }
    .mi-card--loans .mi-card__band.mi-band--r2 {
      background: color-mix(in srgb, black 12%, var(--rps-md3-color-status-info-container));
    }
    .mi-card--loans .mi-card__band.mi-band--r3 {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-text-primary) 24%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--loans .mi-card__band.mi-band--r4 {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-info) 28%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--loans .mi-card__band.mi-band--r5 {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-text-primary) 24%,
        var(--rps-md3-color-status-info-container)
      );
      border-bottom: 1px solid color-mix(in srgb, var(--rps-md3-color-outline) 50%, transparent);
    }
    .mi-card--loans .mi-card__name,
    .mi-card--loans .mi-card__counts {
      color: var(--rps-md3-color-status-on-info-container);
    }
    /* T1〜T4: 地に馴染む薄い色味、表題は on-info で統一 */
    .mi-card--loans.mi-card--band-tint-succ .mi-card__band {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-success) 20%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--loans.mi-card--band-tint-err .mi-card__band {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-error) 15%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--loans.mi-card--band-tint-info .mi-card__band {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-info) 34%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--loans.mi-card--band-tint-warn .mi-card__band {
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-warning) 22%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--empty .mi-card__name,
    .mi-card--empty .mi-card__counts {
      color: var(--rps-md3-color-text-primary);
    }
    .mi-card__band {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: var(--mi-card-pad-y) var(--mi-card-pad-x);
    }
    .mi-card--empty .mi-card__band.mi-band--e1 {
      background: color-mix(in srgb, var(--rps-md3-color-text-primary) 10%, #020617);
    }
    .mi-card--empty .mi-card__band.mi-band--e2 {
      background: var(--rps-md3-color-surface-container);
    }
    .mi-card--empty .mi-card__band.mi-band--e2 .mi-card__name,
    .mi-card--empty .mi-card__band.mi-band--e2 .mi-card__counts {
      color: var(--rps-md3-color-text-primary);
    }
    .mi-card--empty .mi-card__band.mi-band--e3 {
      background: color-mix(in srgb, var(--rps-md3-color-text-primary) 10%, #020617);
      border-bottom: 1px solid color-mix(in srgb, var(--rps-md3-color-outline) 40%, transparent);
    }
    .mi-card__name {
      font-size: max(16px, calc(19 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mi-card__counts {
      font-size: max(12px, calc(14 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 700;
      flex-shrink: 0;
    }
    .mi-card__body {
      padding: var(--mi-header-body-gap) var(--mi-card-pad-x) 12px;
    }
    .mi-line--mgmt {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-text-secondary);
    }
    .mi-line--name {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-status-on-info-container);
    }
    .mi-card--empty .mi-line--mgmt,
    .mi-card--empty .mi-line--name { color: var(--rps-md3-color-text-secondary); }
    .mi-line--returned {
      margin-top: 4px;
      font-size: max(12px, calc(13 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-outline);
    }
    .mi-line--empty {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-text-secondary);
    }
    .mi-gen-stamp {
      margin: 0 0 12px 0;
      font-size: 0.8rem;
      color: var(--rps-md3-color-text-secondary);
    }
  </style>
</head>
<body class="mi-band-samples">
  <h1>帯色サンプル（視認性・カラーバランス優先）</h1>
  <p class="mi-gen-stamp" data-role="build-stamp">生成: <strong>${escapeHtml(options.generatedAtIso)}</strong>（<code>pnpm design:preview</code> 実行直後の時刻。更新されなければ再実行 or スーパーリロード）</p>
  <p class="lead"><strong>R1〜R5</strong> は帯と本文（<code>infoContainer</code>）の分離を優先したバランス案。<strong>T1〜T4</strong> は同じ青地に馴染む薄い色味アクセント（帯=補色で殴らない）。<strong>E1〜E3</strong> は空カード。採用時は ID を指定。</p>
  <h2>貸出あり（R1〜R5 · 推奨・帯の見え方）</h2>
  <div class="mi-band-samples__grid">
    ${loanBalancedFigures}
  </div>
  <h2>貸出あり（T1〜T4 · 地に馴染む薄色味）</h2>
  <div class="mi-band-samples__grid">
    ${loanTintFigures}
  </div>
  <h2>貸出なし（E1〜E3 · 空カード）</h2>
  <div class="mi-band-samples__grid">
    ${emptyFigures}
  </div>
</body>
</html>`;
}

function buildMeasuringInstrumentLoanInspectionHtmlPreview(
  tokensCss: string,
  options: { title: string; targetDate: string; cardsHtml: string; generatedAtIso: string },
): string {
  const headerBodyGapPx = getHeaderBodyGapCssPixels();
  const cardPadX = `${MI_CARD_INNER_PAD_PX}px`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>計測機器持出状況（HTMLデザイン）</title>
  <style>
${tokensCss}

    :root {
      /* 帯下〜明細: mi-instrument-card-metrics.ts（MI_HEADER_TO_BODY_GAP_YPX）と同期 */
      --mi-header-body-gap: ${headerBodyGapPx}px;
      --mi-card-gap: 12px;
      --mi-card-pad-x: ${cardPadX};
      --mi-card-pad-y: 10px;
      --mi-surface: var(--rps-md3-color-surface-background);
    }

    * { box-sizing: border-box; }
    .mi-preview-root {
      margin: 0;
      width: ${PREVIEW_WIDTH}px;
      height: ${PREVIEW_HEIGHT}px;
      overflow: hidden;
      background: var(--mi-surface);
      color: var(--rps-md3-color-text-primary);
      font-family: system-ui, -apple-system, 'Noto Sans JP', 'Roboto', sans-serif;
      padding: 12px;
    }
    .mi-page-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin: 0 0 8px 0;
      font-size: max(20px, calc(30 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 700;
    }
    .mi-page-title .date { color: var(--rps-md3-color-text-secondary); font-size: 0.85em; }
    .mi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--mi-card-gap);
      align-content: start;
    }
    .mi-card {
      border-radius: 10px;
      overflow: hidden;
      min-height: 0;
    }
    .mi-card--loans {
      background: var(--rps-md3-color-status-info-container);
    }
    .mi-card--empty {
      background: #020617;
      border: 1px solid var(--rps-md3-color-card-border);
    }
    .mi-card__band {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: var(--mi-card-pad-y) var(--mi-card-pad-x);
      /* 帯: 本番 palette T4 — color-mix(warning 22%, info-container) */
      background: color-mix(
        in srgb,
        var(--rps-md3-color-status-warning) 22%,
        var(--rps-md3-color-status-info-container)
      );
    }
    .mi-card--empty .mi-card__band {
      /* 空カード帯: E1 相当（10%） */
      background: color-mix(in srgb, var(--rps-md3-color-text-primary) 10%, #020617);
    }
    .mi-card--loans .mi-card__name,
    .mi-card--loans .mi-card__counts {
      color: var(--rps-md3-color-status-on-info-container);
    }
    .mi-card--empty .mi-card__name,
    .mi-card--empty .mi-card__counts {
      color: var(--rps-md3-color-text-primary);
    }
    .mi-card__name {
      font-size: max(16px, calc(19 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mi-card__counts {
      font-size: max(12px, calc(14 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 700;
      flex-shrink: 0;
    }
    .mi-card__body {
      padding: var(--mi-header-body-gap) var(--mi-card-pad-x) 12px;
    }
    .mi-line--mgmt {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-text-secondary);
    }
    .mi-line--name {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-status-on-info-container);
    }
    .mi-card--empty .mi-line--mgmt,
    .mi-card--empty .mi-line--name { color: var(--rps-md3-color-text-secondary); }
    .mi-line--returned {
      margin-top: 4px;
      font-size: max(12px, calc(13 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-outline);
    }
    .mi-line--empty {
      font-size: max(12px, calc(13 * 1.5 * ${PREVIEW_WIDTH} / 1920 * 1px));
      font-weight: 600;
      color: var(--rps-md3-color-text-secondary);
    }
    p.mi-hint {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: var(--rps-md3-color-text-secondary);
    }
  </style>
</head>
<body class="mi-preview-root">
  <p class="mi-hint">生成: <strong>${escapeHtml(options.generatedAtIso)}</strong> — 実装前のHTMLモック（帯＋帯下の余白は CSS で調整可）。<code>index.html</code> では SVG→JPEG と対照。</p>
  <h1 class="mi-page-title"><span>${escapeHtml(options.title)}</span><span class="date">${escapeHtml(
    options.targetDate,
  )}</span></h1>
  <div class="mi-grid">
    ${options.cardsHtml}
  </div>
</body>
</html>`;
}

async function writeBuffer(filePath: string, buffer: Buffer): Promise<void> {
  await fs.writeFile(filePath, buffer);
}

async function main(): Promise<void> {
  const repoRoot = repoRootFromCwd(process.cwd());
  const outDir = path.join(repoRoot, 'tmp', 'design-preview');
  await ensureDir(outDir);

  const full: PreviewConfig = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
  const g = computeSplitPaneGeometry(full);

  const fullTokens = createMd3Tokens(full);
  const cssVars = tokensToCssVars(fullTokens);
  const tokensCss = renderCssVars(':root', cssVars);

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();
  const cacheBust = String(generatedAt.getTime());

  const table = sampleMeasuringInstrumentLoanInspectionTable();
  const targetDate = String((table.metadata as { targetDate?: string } | undefined)?.targetDate ?? '-');
  const displayTitle = '計測機器持出状況';
  const rows = sortRowsForDisplay((table.rows ?? []) as MiLoanInspectionTableRow[]);
  const cardsHtml = rows.map((r) => buildMiLoanInspectionCardHtml(r)).join('\n');

  const loanSampleRow =
    rows.find((r) => {
      const a = toNumberCell(r['貸出中計測機器数'], 0);
      const ret = toNumberCell(r[MI_RETURNED_COUNT_COLUMN], 0);
      return a > 0 || ret > 0;
    }) ?? rows[0];
  const emptySampleRow =
    rows.find((r) => {
      const a = toNumberCell(r['貸出中計測機器数'], 0);
      const ret = toNumberCell(r[MI_RETURNED_COUNT_COLUMN], 0);
      return a === 0 && ret === 0;
    }) ?? rows[0];

  const htmlPreviewPath = path.join(outDir, 'measuring-loan-inspection-html-preview.html');
  await fs.writeFile(
    htmlPreviewPath,
    buildMeasuringInstrumentLoanInspectionHtmlPreview(tokensCss, {
      title: displayTitle,
      targetDate,
      cardsHtml,
      generatedAtIso,
    }),
    'utf8',
  );

  const bandSamplesPath = path.join(outDir, 'measuring-loan-inspection-band-samples.html');
  await fs.writeFile(
    bandSamplesPath,
    buildBandColorSamplesPageHtml(tokensCss, {
      loanRow: loanSampleRow,
      emptyRow: emptySampleRow,
      generatedAtIso,
    }),
    'utf8',
  );

  const measuringInspectionRenderer = new MeasuringInstrumentLoanInspectionRenderer();
  const miFullOut = await measuringInspectionRenderer.render(table, {
    width: full.width,
    height: full.height,
    title: displayTitle,
  });
  const miFullPath = path.join(outDir, 'measuring-loan-inspection-full.jpg');
  await writeBuffer(miFullPath, miFullOut.buffer);

  const miPaneOut = await measuringInspectionRenderer.render(table, {
    width: g.rightPaneContentWidth,
    height: g.paneContentHeight,
    title: displayTitle,
  });
  const miPanePath = path.join(outDir, 'measuring-loan-inspection-pane.jpg');
  await writeBuffer(miPanePath, miPaneOut.buffer);

  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>計測機器持出状況 — デザインプレビュー</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #e8e8e8; color: #111; }
    .wrap { max-width: 2000px; margin: 0 auto; padding: 16px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px 0; }
    p.note { font-size: 0.9rem; color: #333; margin: 0 0 16px 0; line-height: 1.5; }
    p.stamp { font-size: 0.8rem; color: #666; margin: 0 0 12px 0; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 1200px) { .row { grid-template-columns: 1fr; } }
    .panel { background: #fff; border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
    .panel h2 { font-size: 0.95rem; margin: 0 0 8px 0; }
    .panel p.meta { font-size: 0.8rem; color: #666; margin: 0 0 8px 0; }
    iframe, img { width: 100%; height: auto; border: 0; border-radius: 6px; background: #000; vertical-align: top; }
    iframe { min-height: 480px; aspect-ratio: 16 / 9; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>計測機器持出状況 — デザインプレビュー</h1>
    <p class="stamp">生成: <strong>${generatedAtIso}</strong> &nbsp;|&nbsp; cacheBust=<code>${cacheBust}</code> &nbsp;|&nbsp; 表示が古い場合は <strong>本ページを再読み込み</strong>（iframe は毎回別 URL）または <code>cd apps/api &amp;&amp; pnpm design:preview</code> を再実行。</p>
    <p class="note">目的: 実装前に <strong>帯＋帯下の余白</strong>を HTML で合意し、同じトークン前提の <code>MeasuringInstrumentLoanInspectionRenderer</code>（SVG→JPEG）と対照。帯色の<strong>採用選定</strong>は専用ページを使用。<strong><code>tmp/design-preview</code> は .gitignore のため、clone 直後は未生成。必ず <code>pnpm design:preview</code> を実行。</strong> 出力先: <code>${outDir}</code></p>
    <div class="row">
      <div class="panel">
        <h2>帯色サンプル（複数パターン・採用 ID を決める）</h2>
        <p class="meta"><code>measuring-loan-inspection-band-samples.html</code> — 帯 R1〜R5・T1〜T4・空 E1〜E3（視認性バランス版）。<a href="./measuring-loan-inspection-band-samples.html?cb=${cacheBust}" target="_blank" rel="noopener">別タブで開く</a></p>
        <iframe src="./measuring-loan-inspection-band-samples.html?cb=${cacheBust}" title="帯色サンプル" style="min-height: 640px; aspect-ratio: auto;"></iframe>
      </div>
      <div class="panel">
        <h2>HTML モック（全カード ${full.width}×${full.height}）</h2>
        <p class="meta"><code>measuring-loan-inspection-html-preview.html</code> — 帯下 <code>--mi-header-body-gap</code>。<a href="./measuring-loan-inspection-html-preview.html?cb=${cacheBust}" target="_blank" rel="noopener">別タブ</a></p>
        <iframe src="./measuring-loan-inspection-html-preview.html?cb=${cacheBust}" title="計測機器持出 HTML"></iframe>
      </div>
    </div>
    <div class="row" style="margin-top: 16px;">
      <div class="panel">
        <h2>参照: SVG レンダラー（FULL ${full.width}×${full.height}）</h2>
        <p class="meta">本番に近い JPEG 出力。帯色は <code>mi-instrument-card-palette</code> の定数に追随。</p>
        <img src="./measuring-loan-inspection-full.jpg?cb=${cacheBust}" width="${full.width}" height="${full.height}" alt="計測機器持出 SVG full" />
      </div>
      <div class="panel">
        <h2>参照: SPLIT ペイン相当（${g.rightPaneContentWidth}×${g.paneContentHeight}）</h2>
        <p class="meta">右ペイン等の縮尺感の確認用。</p>
        <img src="./measuring-loan-inspection-pane.jpg?cb=${cacheBust}" width="${g.rightPaneContentWidth}" height="${g.paneContentHeight}" alt="計測機器持出 SVG pane" />
      </div>
    </div>
  </div>
</body>
</html>
`;
  await fs.writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');

  const summary = {
    generatedAtIso,
    outDir,
    purpose: 'measuring_instrument_loan_inspection design preview only',
    full,
    pane: { width: g.rightPaneContentWidth, height: g.paneContentHeight },
    files: {
      index: 'tmp/design-preview/index.html',
      htmlMock: 'tmp/design-preview/measuring-loan-inspection-html-preview.html',
      bandSamples: 'tmp/design-preview/measuring-loan-inspection-band-samples.html',
      rendererFull: 'tmp/design-preview/measuring-loan-inspection-full.jpg',
      rendererPane: 'tmp/design-preview/measuring-loan-inspection-pane.jpg',
    },
  };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Design preview generated: ${path.join(outDir, 'index.html')} (${generatedAtIso})`);
  // eslint-disable-next-line no-console
  console.log(`  HTML mock: ${htmlPreviewPath}`);
  // eslint-disable-next-line no-console
  console.log(`  Band color samples: ${bandSamplesPath}`);
  // eslint-disable-next-line no-console
  console.log(`  Tip: open index.html in browser; tmp/ is gitignored — run this script after clone/pull.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
