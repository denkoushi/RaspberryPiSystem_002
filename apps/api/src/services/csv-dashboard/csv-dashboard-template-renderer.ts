import type {
  NormalizedRowData,
  TableTemplateConfig,
  CardGridTemplateConfig,
} from './csv-dashboard.types.js';
import { env } from '../../config/env.js';

/**
 * 描画時に最低限必要な列定義プロパティ（完全なColumnDefinitionは不要）
 */
interface RenderableColumnDefinition {
  internalName: string;
  displayName: string;
  dataType?: string;
  order?: number;
}

export interface CsvDashboardRenderContext {
  canvasWidth: number;
  canvasHeight: number;
}

const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;

/**
 * CSVダッシュボードテンプレートレンダラー
 * SVG形式でダッシュボードをレンダリングする
 */
export class CsvDashboardTemplateRenderer {
  private readonly weekdayJa = ['日', '月', '火', '水', '木', '金', '土'] as const;

  /**
   * テーブル形式でレンダリング
   */
  renderTable(
    rows: NormalizedRowData[],
    columnDefinitions: RenderableColumnDefinition[],
    config: TableTemplateConfig,
    dashboardName: string,
    emptyMessage?: string | null,
    context?: Partial<CsvDashboardRenderContext>
  ): string {
    if (rows.length === 0) {
      return this.renderEmptyMessage(dashboardName, emptyMessage || 'データがありません');
    }

    // 表示列の定義を取得（順序も反映）
    const canvasWidth = context?.canvasWidth ?? DEFAULT_CANVAS_WIDTH;
    const canvasHeight = context?.canvasHeight ?? DEFAULT_CANVAS_HEIGHT;
    const scale = canvasWidth / DEFAULT_CANVAS_WIDTH;

    const selectedColumnDefs = config.displayColumns
      .map((internalName) => columnDefinitions.find((col) => col.internalName === internalName))
      .filter((col): col is RenderableColumnDefinition => col !== undefined);

    // displayColumns が不正/空の場合は、列定義の順序で全列表示にフォールバック
    const displayColumns =
      selectedColumnDefs.length > 0
        ? selectedColumnDefs
        : [...columnDefinitions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const topTitleHeight = Math.round(64 * scale);
    const tableTop = Math.round(80 * scale);
    const headerHeight = Math.round(56 * scale);
    const rowHeight = Math.max(Math.round(30 * scale), Math.round((config.fontSize + 18) * scale));
    const availableHeight = canvasHeight - tableTop - headerHeight - Math.round(16 * scale);
    const maxRowsByHeight = Math.max(1, Math.floor(availableHeight / rowHeight));
    const rowsPerPage = Math.min(rows.length, config.rowsPerPage, maxRowsByHeight);

    // カラム幅（サイネージでの視認性優先）
    const columnWidths = this.computeColumnWidths(displayColumns, rows, rowsPerPage, config, canvasWidth);
    const columnX = columnWidths.reduce<number[]>((acc, w, i) => {
      acc[i] = (i === 0 ? 0 : acc[i - 1] + columnWidths[i - 1]);
      return acc;
    }, []);

    // ヘッダー行を生成
    const headerCells = displayColumns
      .map(
        (col, index) => {
          const headerLabel = col.displayName;
          const x = columnX[index] ?? 0;
          const w = columnWidths[index] ?? Math.floor(canvasWidth / displayColumns.length);
          return `
      <rect x="${x}" y="0" width="${w}" height="${headerHeight}" fill="#1e293b" stroke="#334155" stroke-width="2"/>
      <text x="${x + w / 2}" y="${headerHeight / 2 + 2}"
            font-family="Arial, sans-serif" font-size="${Math.max(10, Math.round((config.fontSize + 4) * scale))}" font-weight="bold"
            fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
        ${this.escapeXml(headerLabel)}
      </text>
    `;
        }
      )
      .join('');

    // データ行を生成
    const dataRows = rows
      .slice(0, rowsPerPage)
      .map((row, rowIndex) => {
        const cells = displayColumns
          .map((col, colIndex) => {
            const x = columnX[colIndex] ?? 0;
            const w = columnWidths[colIndex] ?? Math.floor(canvasWidth / displayColumns.length);
            const y = headerHeight + rowIndex * rowHeight;
            const rawValue = row[col.internalName];
            const formattedValue = this.formatCellValueForSignage(col, rawValue);
            const cellPaddingX = this.computeCellPaddingX(w, scale);
            const maxTextWidth = Math.max(0, w - cellPaddingX * 2);
            const effectiveFontSize = Math.max(10, Math.round(config.fontSize * scale));
            const textValue = this.truncateForApproxWidth(
              String(formattedValue ?? ''),
              maxTextWidth,
              effectiveFontSize
            );
            return `
        <rect x="${x}" y="${y}"
              width="${w}" height="${rowHeight}"
              fill="${rowIndex % 2 === 0 ? '#0f172a' : '#1e293b'}"
              stroke="#334155" stroke-width="1"/>
        <text x="${x + cellPaddingX}" y="${y + rowHeight / 2 + 2}"
              font-family="Arial, sans-serif" font-size="${effectiveFontSize}"
              fill="#ffffff" dominant-baseline="middle">
          ${this.escapeXml(textValue)}
        </text>
      `;
          })
          .join('');
        return cells;
      })
      .join('');

    return `
    <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${canvasWidth}" height="${canvasHeight}" fill="#0a0e27"/>
      <text x="${canvasWidth / 2}" y="${topTitleHeight / 2 + Math.round(6 * scale)}" font-family="Arial, sans-serif" font-size="${Math.max(18, Math.round(36 * scale))}" font-weight="bold"
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      <g transform="translate(0, ${tableTop})">
        ${headerCells}
        ${dataRows}
      </g>
    </svg>
    `;
  }

  /**
   * カードグリッド形式でレンダリング
   */
  renderCardGrid(
    rows: NormalizedRowData[],
    columnDefinitions: RenderableColumnDefinition[],
    config: CardGridTemplateConfig,
    dashboardName: string,
    emptyMessage?: string | null
  ): string {
    if (rows.length === 0) {
      return this.renderEmptyMessage(dashboardName, emptyMessage || 'データがありません');
    }

    const gridColumns = config.gridColumns || 3;
    const gridRows = config.gridRows || 3;
    const cardsPerPage = Math.min(config.cardsPerPage, gridColumns * gridRows);
    const cardWidth = 600;
    const cardHeight = 300;
    const cardGap = 20;
    const totalWidth = gridColumns * cardWidth + (gridColumns - 1) * cardGap;
    const totalHeight = gridRows * cardHeight + (gridRows - 1) * cardGap + 80;

    // 表示項目の定義を取得
    const displayFields = config.displayFields
      .map((internalName) => columnDefinitions.find((col) => col.internalName === internalName))
      .filter((col): col is RenderableColumnDefinition => col !== undefined);

    // カードを生成
    const cards = rows
      .slice(0, cardsPerPage)
      .map((row, index) => {
        const col = index % gridColumns;
        const rowPos = Math.floor(index / gridColumns);
        const x = col * (cardWidth + cardGap);
        const y = 80 + rowPos * (cardHeight + cardGap);

        const cardContent = displayFields
          .map(
            (field, fieldIndex) => `
          <text x="${x + 20}" y="${y + 40 + fieldIndex * (config.fontSize + 10)}" 
                font-family="Arial, sans-serif" font-size="${config.fontSize}" 
                fill="#ffffff">
            <tspan font-weight="bold">${this.escapeXml(field.displayName)}:</tspan>
            <tspan x="${x + 200}">${this.escapeXml(String(row[field.internalName] ?? ''))}</tspan>
          </text>
        `
          )
          .join('');

        return `
        <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" 
              fill="#1e293b" stroke="#334155" stroke-width="2" rx="8"/>
        ${cardContent}
      `;
      })
      .join('');

    return `
    <svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${totalWidth}" height="${totalHeight}" fill="#0a0e27"/>
      <text x="${totalWidth / 2}" y="30" font-family="Arial, sans-serif" font-size="28" font-weight="bold" 
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      ${cards}
    </svg>
    `;
  }

  /**
   * 空メッセージをレンダリング
   */
  private renderEmptyMessage(dashboardName: string, message: string): string {
    return `
    <svg width="${DEFAULT_CANVAS_WIDTH}" height="${DEFAULT_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${DEFAULT_CANVAS_WIDTH}" height="${DEFAULT_CANVAS_HEIGHT}" fill="#0a0e27"/>
      <text x="${DEFAULT_CANVAS_WIDTH / 2}" y="400" font-family="Arial, sans-serif" font-size="32" font-weight="bold"
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      <text x="${DEFAULT_CANVAS_WIDTH / 2}" y="500" font-family="Arial, sans-serif" font-size="24"
            fill="#94a3b8" text-anchor="middle">${this.escapeXml(message)}</text>
    </svg>
    `;
  }

  /**
   * XMLエスケープ
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private formatCellValueForSignage(col: RenderableColumnDefinition, rawValue: unknown): string {
    if (rawValue == null) {
      return '';
    }

    const asString = String(rawValue);

    // date列はサイネージ用フォーマットで表示（DBはUTC保持、表示のみJST）
    if (col.dataType === 'date') {
      return this.formatJstTimestampForSignage(asString) ?? asString;
    }

    return asString;
  }

  private formatJstTimestampForSignage(isoLike: string): string | null {
    const date = new Date(isoLike);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: env.SIGNAGE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const weekdayRaw = parts.find((p) => p.type === 'weekday')?.value ?? '';
    // ja-JP short weekday is usually "木" etc, but guard just in case
    const weekday = weekdayRaw.length >= 1 ? weekdayRaw.slice(0, 1) : this.weekdayJa[date.getDay()];
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
    const ampm = dayPeriod === '午後' ? 'PM' : 'AM';

    // 例: 2025/01/22（木）AM8:03
    return `${year}/${month}/${day}（${weekday}）${ampm}${hour}:${minute}`;
  }

  private computeColumnWidths(
    displayColumns: RenderableColumnDefinition[],
    rows: NormalizedRowData[],
    rowsPerPage: number,
    config: TableTemplateConfig,
    canvasWidth: number
  ): number[] {
    if (displayColumns.length === 0) {
      return [];
    }

    const fixed: Array<number | null> = displayColumns.map((col) => {
      const px = config.columnWidths?.[col.internalName];
      return typeof px === 'number' && Number.isFinite(px) && px > 0 ? px : null;
    });

    const fixedSum = fixed.reduce((sum, v) => sum + (v ?? 0), 0);
    const autoIndices = fixed
      .map((v, i) => ({ v, i }))
      .filter((x) => x.v == null)
      .map((x) => x.i);

    // fixedが幅を食い潰す場合は、全体をスケールして収める
    if (fixedSum >= canvasWidth) {
      const scale = canvasWidth / fixedSum;
      const widths = fixed.map((v) => Math.max(20, Math.floor((v ?? 1) * scale)));
      const sum = widths.reduce((a, b) => a + b, 0);
      widths[widths.length - 1] += canvasWidth - sum;
      return widths;
    }

    if (autoIndices.length === 0) {
      const widths = fixed.map((v) => Math.round(v ?? 0));
      const sum = widths.reduce((a, b) => a + b, 0);
      widths[widths.length - 1] += canvasWidth - sum;
      return widths;
    }

    const remaining = Math.max(0, canvasWidth - fixedSum);
    const minWidth = 80;
    const maxWidth = Math.max(120, Math.floor(canvasWidth * 0.55));

    // データ長（最大文字幅の近似）から重みを作る
    const sampleRows = rows.slice(0, rowsPerPage);
    const weights = autoIndices.map((i) => {
      const col = displayColumns[i];
      let maxEm = col.displayName.length; // ヘッダーも考慮
      for (const row of sampleRows) {
        const v = row[col.internalName];
        const s = v == null ? '' : String(v);
        maxEm = Math.max(maxEm, this.approxTextEm(s));
      }
      return Math.max(1, maxEm);
    });
    const weightSum = weights.reduce((a, b) => a + b, 0);

    const widths: number[] = displayColumns.map((_, i) => Math.round(fixed[i] ?? 0));

    // まずminを確保
    const minTotal = minWidth * autoIndices.length;
    const remainingAfterMin = Math.max(0, remaining - minTotal);
    autoIndices.forEach((idx, k) => {
      const extra = weightSum > 0 ? Math.floor((remainingAfterMin * weights[k]) / weightSum) : 0;
      widths[idx] = Math.min(maxWidth, minWidth + extra);
    });

    // 合計調整（端数/上限によりズレるため）
    const sum = widths.reduce((a, b) => a + b, 0);
    const delta = canvasWidth - sum;
    widths[widths.length - 1] += delta;
    return widths;
  }

  private computeCellPaddingX(columnWidth: number, scale: number): number {
    // 狭い列はpaddingを削って有効領域を確保する
    const base = Math.round(12 * scale);
    const min = Math.round(4 * scale);
    const max = Math.round(12 * scale);
    const byWidth = Math.round(columnWidth * 0.03);
    return Math.max(min, Math.min(max, Math.min(base, byWidth)));
  }

  private approxTextEm(text: string): number {
    let used = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0);
      used += code != null && code <= 0xff ? 0.6 : 1.0;
    }
    return used;
  }

  private truncateForApproxWidth(text: string, maxWidthPx: number, fontSizePx: number): string {
    if (!text) return '';
    // ざっくり: 半角=0.6em, 全角=1.0em として近似
    // ESLint no-control-regex 回避のため、コードポイントで判定する
    const approxCharWidth = (ch: string) => {
      const code = ch.codePointAt(0);
      return code != null && code <= 0xff ? 0.6 : 1.0;
    };
    const maxEm = maxWidthPx / Math.max(1, fontSizePx);
    let used = 0;
    let out = '';
    for (const ch of text) {
      const next = used + approxCharWidth(ch);
      if (next > maxEm) {
        return out.length > 0 ? `${out}…` : '…';
      }
      used = next;
      out += ch;
    }
    return out;
  }
}
