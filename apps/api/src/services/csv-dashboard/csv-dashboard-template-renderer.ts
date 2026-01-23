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
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

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
    emptyMessage?: string | null
  ): string {
    if (rows.length === 0) {
      return this.renderEmptyMessage(dashboardName, emptyMessage || 'データがありません');
    }

    const effectiveDisplayColumns = this.getEffectiveDisplayColumnsForSignage(
      dashboardName,
      columnDefinitions,
      config.displayColumns
    );

    // 表示列の定義を取得（順序も反映）
    const displayColumns = effectiveDisplayColumns
      .map((internalName) => columnDefinitions.find((col) => col.internalName === internalName))
      .filter((col): col is RenderableColumnDefinition => col !== undefined);

    const topTitleHeight = 64;
    const tableTop = 80;
    const headerHeight = 56;
    const rowHeight = Math.max(30, config.fontSize + 18);
    const tableWidth = CANVAS_WIDTH;
    const availableHeight = CANVAS_HEIGHT - tableTop - headerHeight - 16;
    const maxRowsByHeight = Math.max(1, Math.floor(availableHeight / rowHeight));
    const rowsPerPage = Math.min(rows.length, config.rowsPerPage, maxRowsByHeight);

    // カラム幅（サイネージでの視認性優先）
    const columnLayout = this.getColumnLayoutForSignage(dashboardName, displayColumns);
    const columnWidths = columnLayout.widths;
    const columnX = columnWidths.reduce<number[]>((acc, w, i) => {
      acc[i] = (i === 0 ? 0 : acc[i - 1] + columnWidths[i - 1]);
      return acc;
    }, []);

    // ヘッダー行を生成
    const headerCells = displayColumns
      .map(
        (col, index) => {
          const headerLabel = this.getHeaderLabelForSignage(dashboardName, col);
          const x = columnX[index] ?? 0;
          const w = columnWidths[index] ?? Math.floor(tableWidth / displayColumns.length);
          return `
      <rect x="${x}" y="0" width="${w}" height="${headerHeight}" fill="#1e293b" stroke="#334155" stroke-width="2"/>
      <text x="${x + w / 2}" y="${headerHeight / 2 + 2}"
            font-family="Arial, sans-serif" font-size="${config.fontSize + 4}" font-weight="bold"
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
            const w = columnWidths[colIndex] ?? Math.floor(tableWidth / displayColumns.length);
            const y = headerHeight + rowIndex * rowHeight;
            const rawValue = row[col.internalName];
            const formattedValue = this.formatCellValueForSignage(
              dashboardName,
              col,
              rawValue
            );
            const cellPaddingX = 12;
            const maxTextWidth = Math.max(0, w - cellPaddingX * 2);
            const textValue = this.truncateForApproxWidth(String(formattedValue ?? ''), maxTextWidth, config.fontSize);
            return `
        <rect x="${x}" y="${y}"
              width="${w}" height="${rowHeight}"
              fill="${rowIndex % 2 === 0 ? '#0f172a' : '#1e293b'}"
              stroke="#334155" stroke-width="1"/>
        <text x="${x + cellPaddingX}" y="${y + rowHeight / 2 + 2}"
              font-family="Arial, sans-serif" font-size="${config.fontSize}"
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
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="#0a0e27"/>
      <text x="${CANVAS_WIDTH / 2}" y="${topTitleHeight / 2 + 6}" font-family="Arial, sans-serif" font-size="36" font-weight="bold"
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
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="#0a0e27"/>
      <text x="${CANVAS_WIDTH / 2}" y="400" font-family="Arial, sans-serif" font-size="32" font-weight="bold"
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      <text x="${CANVAS_WIDTH / 2}" y="500" font-family="Arial, sans-serif" font-size="24"
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

  private getEffectiveDisplayColumnsForSignage(
    dashboardName: string,
    columnDefinitions: RenderableColumnDefinition[],
    configuredColumns: string[]
  ): string[] {
    // サイネージ「MeasuringInstrumentLoans」は必要項目に絞る（見切れ防止＋要求仕様）
    if (dashboardName === 'MeasuringInstrumentLoans') {
      const existing = new Set(columnDefinitions.map((c) => c.internalName));
      const pick = (candidates: string[]): string | null =>
        candidates.find((c) => existing.has(c)) ?? null;

      const managementNumber = pick(['managementNumber']);
      const instrumentName = pick(['name', 'instrumentName', 'measuringInstrumentName']);
      const personName = pick(['borrower', 'employeeName', 'personName', 'userName']);
      const status = pick(['status', 'shiyou_henkyaku']);
      const day = pick(['day', 'borrowedAt', 'eventAt']);

      return [managementNumber, instrumentName, personName, status, day].filter(
        (v): v is string => Boolean(v)
      );
    }

    return configuredColumns;
  }

  private getHeaderLabelForSignage(dashboardName: string, col: RenderableColumnDefinition): string {
    if (dashboardName === 'MeasuringInstrumentLoans') {
      if (col.internalName === 'day' || col.internalName === 'borrowedAt' || col.internalName === 'eventAt') {
        return '日時';
      }
      if (col.internalName === 'status' || col.internalName === 'shiyou_henkyaku') {
        return 'ステータス';
      }
    }
    return col.displayName;
  }

  private formatCellValueForSignage(
    dashboardName: string,
    col: RenderableColumnDefinition,
    rawValue: unknown
  ): string {
    if (rawValue == null) {
      return '';
    }

    const asString = String(rawValue);

    // サイネージ要件: MeasuringInstrumentLoans の日時は JST + 指定フォーマット（秒なし）
    if (dashboardName === 'MeasuringInstrumentLoans') {
      const isDayColumn =
        col.internalName === 'day' || col.internalName === 'borrowedAt' || col.internalName === 'eventAt';
      if (isDayColumn) {
        return this.formatJstTimestampForSignage(asString) ?? asString;
      }
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

  private getColumnLayoutForSignage(
    dashboardName: string,
    displayColumns: RenderableColumnDefinition[]
  ): { widths: number[] } {
    if (displayColumns.length === 0) {
      return { widths: [] };
    }

    // 視認性優先の固定比率（合計=1.0）
    if (dashboardName === 'MeasuringInstrumentLoans') {
      // 管理番号/名称/人名/ステータス/日時
      const ratios = [0.16, 0.30, 0.18, 0.12, 0.24];
      const widths = displayColumns.map((_, i) => Math.round(CANVAS_WIDTH * (ratios[i] ?? 1 / displayColumns.length)));
      // 端数調整
      const sum = widths.reduce((a, b) => a + b, 0);
      widths[widths.length - 1] += CANVAS_WIDTH - sum;
      return { widths };
    }

    const w = Math.floor(CANVAS_WIDTH / displayColumns.length);
    const widths = displayColumns.map((_, i) => (i === displayColumns.length - 1 ? CANVAS_WIDTH - w * (displayColumns.length - 1) : w));
    return { widths };
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
