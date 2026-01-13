import type {
  NormalizedRowData,
  TableTemplateConfig,
  CardGridTemplateConfig,
} from './csv-dashboard.types.js';

/**
 * 描画時に最低限必要な列定義プロパティ（完全なColumnDefinitionは不要）
 */
interface RenderableColumnDefinition {
  internalName: string;
  displayName: string;
  dataType?: string;
}

/**
 * CSVダッシュボードテンプレートレンダラー
 * SVG形式でダッシュボードをレンダリングする
 */
export class CsvDashboardTemplateRenderer {
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

    // 表示列の定義を取得（順序も反映）
    const displayColumns = config.displayColumns
      .map((internalName) => columnDefinitions.find((col) => col.internalName === internalName))
      .filter((col): col is RenderableColumnDefinition => col !== undefined);

    const headerHeight = 60;
    const rowHeight = config.fontSize + 20;
    const tableWidth = 1920; // デフォルト幅
    const tableHeight = headerHeight + Math.min(rows.length, config.rowsPerPage) * rowHeight;
    const columnWidth = tableWidth / displayColumns.length;

    // ヘッダー行を生成
    const headerCells = displayColumns
      .map(
        (col, index) => `
      <rect x="${index * columnWidth}" y="0" width="${columnWidth}" height="${headerHeight}" fill="#1e293b" stroke="#334155" stroke-width="2"/>
      <text x="${index * columnWidth + columnWidth / 2}" y="${headerHeight / 2 + 5}" 
            font-family="Arial, sans-serif" font-size="${config.fontSize + 4}" font-weight="bold" 
            fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
        ${this.escapeXml(col.displayName)}
      </text>
    `
      )
      .join('');

    // データ行を生成
    const dataRows = rows
      .slice(0, config.rowsPerPage)
      .map((row, rowIndex) => {
        const cells = displayColumns
          .map(
            (col, colIndex) => `
        <rect x="${colIndex * columnWidth}" y="${headerHeight + rowIndex * rowHeight}" 
              width="${columnWidth}" height="${rowHeight}" 
              fill="${rowIndex % 2 === 0 ? '#0f172a' : '#1e293b'}" 
              stroke="#334155" stroke-width="1"/>
        <text x="${colIndex * columnWidth + 10}" y="${headerHeight + rowIndex * rowHeight + rowHeight / 2 + 5}" 
              font-family="Arial, sans-serif" font-size="${config.fontSize}" 
              fill="#ffffff" dominant-baseline="middle">
          ${this.escapeXml(String(row[col.internalName] ?? ''))}
        </text>
      `
          )
          .join('');
        return cells;
      })
      .join('');

    return `
    <svg width="${tableWidth}" height="${tableHeight + 80}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${tableWidth}" height="${tableHeight + 80}" fill="#0a0e27"/>
      <text x="${tableWidth / 2}" y="30" font-family="Arial, sans-serif" font-size="28" font-weight="bold" 
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      <g transform="translate(0, 50)">
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
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <rect width="1920" height="1080" fill="#0a0e27"/>
      <text x="960" y="400" font-family="Arial, sans-serif" font-size="32" font-weight="bold" 
            fill="#ffffff" text-anchor="middle">${this.escapeXml(dashboardName)}</text>
      <text x="960" y="500" font-family="Arial, sans-serif" font-size="24" 
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
}
