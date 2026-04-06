import {
  formatBorrowedCompactLine,
  splitLocationTwoLines,
  splitPrimaryTwoLines,
  trimEmployeeNameOneLine,
} from '../loan-card/loan-card-text.js';
import { buildCompact24KioskSvgBody } from '../loan-card/compact24-kiosk-svg-text.js';
import { compactLayoutHasThumbnail, resolveCompactThumbPlan } from './compact-thumb-plan.js';
import { computeSplitCompact24Layout } from '../loan-card/loan-card-layout.js';
import type { LoanGridRenderRequest, LoanGridLayerResult, LoanGridRasterizerPort } from './loan-grid-rasterizer.port.js';
import type { SvgLoanGridDependencies } from './svg-loan-grid-dependencies.js';
/**
 * Previous hand-placed SVG implementation. Kept as rollback / low-deps path.
 */
export class SvgLegacyLoanGridRasterizer implements LoanGridRasterizerPort {
  constructor(private readonly deps: SvgLoanGridDependencies) {}

  async render(request: LoanGridRenderRequest): Promise<LoanGridLayerResult> {
    const { layout, config } = request;
    const scale = layout.scale;
    const cardRadius = Math.round(12 * scale);
    const cardPadding = Math.round(12 * scale);
    const thumbnailSize = Math.round(96 * scale);
    const thumbnailWidth = thumbnailSize;
    const thumbnailHeight = thumbnailSize;
    const thumbnailGap = Math.round(12 * scale);

    const cards = await Promise.all(
      layout.placed.map(async (placed, index) => {
        const { x, y, width: cardWidth, height: cardHeight, view: tool } = placed;
        const primaryText = tool.primaryText;
        const clientLocationText = tool.clientLocation;
        const isInstrument = tool.isInstrument;
        const isRigging = tool.isRigging;
        const managementText = tool.managementText;
        const riggingIdNumText = tool.riggingIdNumText;
        const cardFill = isInstrument
          ? 'rgba(147,51,234,1.0)'
          : isRigging
            ? 'rgba(249,115,22,1.0)'
            : 'rgba(59,130,246,1.0)';
        const isExceeded = tool.isExceeded;
        const cardStroke = isExceeded
          ? 'rgba(220,38,38,1.0)'
          : isInstrument
            ? 'rgba(107,33,168,1.0)'
            : isRigging
              ? 'rgba(194,65,12,1.0)'
              : 'rgba(29,78,216,1.0)';
        const strokeWidth = isExceeded
          ? Math.max(4, Math.round(4 * scale))
          : Math.max(2, Math.round(2 * scale));
        const clipId = this.deps.generateId(`thumb-${index}`);
        let thumbnailElement = '';
        const thumbBase64 = tool.thumbnailDataUrl;
        const thumbPlanForCompact = resolveCompactThumbPlan(tool);
        const hasThumbnailCompact = compactLayoutHasThumbnail(thumbPlanForCompact);
        const hasThumbnail = Boolean(thumbBase64);

        if (config.cardLayout === 'splitCompact24') {
          const layoutGeom = computeSplitCompact24Layout({
            x,
            y,
            cardWidth,
            cardHeight,
            scale,
            cardPadding,
            thumbnailWidth,
            thumbnailHeight,
            thumbnailGap,
            hasThumbnail: hasThumbnailCompact,
            hasWarning: isExceeded,
          });
          if (thumbBase64) {
            const tx = layoutGeom.thumbnailX;
            const ty = layoutGeom.thumbnailY;
            thumbnailElement = `
                <clipPath id="${clipId}">
                  <rect x="${tx}" y="${ty}"
                    width="${thumbnailWidth}" height="${thumbnailHeight}" rx="${Math.round(8 * scale)}" ry="${Math.round(8 * scale)}" />
                </clipPath>
                <image x="${tx}" y="${ty}"
                  width="${thumbnailWidth}" height="${thumbnailHeight}"
                  href="${thumbBase64}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />
              `;
          }
          const borrowedCompact = formatBorrowedCompactLine(tool.borrowedCompact || null);
          const employeeLine = trimEmployeeNameOneLine(tool.employeeName, layoutGeom.maxEmployeeUnitsPerLine);
          const warnSvg =
            layoutGeom.warningX != null && layoutGeom.warningY != null
              ? `<text x="${layoutGeom.warningX}" y="${layoutGeom.warningY}"
              font-size="${layoutGeom.fontWarning}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                ⚠ 期限超過
              </text>`
              : '';

          if (tool.compactKioskLines) {
            const body = buildCompact24KioskSvgBody(
              tool.compactKioskLines,
              clientLocationText,
              layoutGeom.maxPrimaryUnitsPerLine,
              layoutGeom.maxLocationUnitsPerLine,
              10
            );
            const fontId = Math.max(11, Math.round(12 * scale));
            const idSvg =
              body.headRight != null
                ? `<text x="${layoutGeom.textMaxX}" y="${layoutGeom.primary1Y}"
                  text-anchor="end" font-size="${fontId}" font-weight="600" fill="#ffffff" font-family="sans-serif">
                  ${this.deps.escapeXml(body.headRight)}
                </text>`
                : '';
            const loc1Content = body.nameLine2.length > 0 ? body.nameLine2 : body.locLine1;
            const loc2Content = body.nameLine2.length > 0 ? body.locLine1 : body.locLine2;
            const loc2Svg =
              loc2Content.length > 0
                ? `<text x="${layoutGeom.textX}" y="${layoutGeom.loc2Y}"
              font-size="${layoutGeom.fontLoc}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
              ${this.deps.escapeXml(loc2Content)}
            </text>`
                : '';
            return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="${cardFill}" stroke="${cardStroke}" stroke-width="${strokeWidth}" />
            <text x="${layoutGeom.nameX}" y="${layoutGeom.nameY}"
              font-size="${layoutGeom.fontName}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(employeeLine)}
            </text>
            ${thumbnailElement}
            <text x="${layoutGeom.textX}" y="${layoutGeom.primary1Y}"
              font-size="${layoutGeom.fontPrimary}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(body.headLeft)}
            </text>
            ${idSvg}
            <text x="${layoutGeom.textX}" y="${layoutGeom.primary2Y}"
              font-size="${layoutGeom.fontPrimary}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(body.nameLine1)}
            </text>
            <text x="${layoutGeom.textX}" y="${layoutGeom.loc1Y}"
              font-size="${layoutGeom.fontLoc}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
              ${this.deps.escapeXml(loc1Content)}
            </text>
            ${loc2Svg}
            <text x="${layoutGeom.dateX}" y="${layoutGeom.dateY}"
              font-size="${layoutGeom.fontDate}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedCompact ? this.deps.escapeXml(borrowedCompact) : ''}
            </text>
            ${warnSvg}
          </g>
        `;
          }

          const pLines = splitPrimaryTwoLines(primaryText, layoutGeom.maxPrimaryUnitsPerLine);
          const { line1: loc1, line2: loc2 } = splitLocationTwoLines(
            clientLocationText,
            layoutGeom.maxLocationUnitsPerLine
          );
          const primary2Svg =
            pLines.line2.length > 0
              ? `<text x="${layoutGeom.textX}" y="${layoutGeom.primary2Y}"
              font-size="${layoutGeom.fontPrimary}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(pLines.line2)}
            </text>`
              : '';
          const loc2Svg =
            loc2.length > 0
              ? `<text x="${layoutGeom.textX}" y="${layoutGeom.loc2Y}"
              font-size="${layoutGeom.fontLoc}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
              ${this.deps.escapeXml(loc2)}
            </text>`
              : '';
          return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="${cardFill}" stroke="${cardStroke}" stroke-width="${strokeWidth}" />
            <text x="${layoutGeom.nameX}" y="${layoutGeom.nameY}"
              font-size="${layoutGeom.fontName}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(employeeLine)}
            </text>
            ${thumbnailElement}
            <text x="${layoutGeom.textX}" y="${layoutGeom.primary1Y}"
              font-size="${layoutGeom.fontPrimary}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(pLines.line1)}
            </text>
            ${primary2Svg}
            <text x="${layoutGeom.textX}" y="${layoutGeom.loc1Y}"
              font-size="${layoutGeom.fontLoc}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
              ${this.deps.escapeXml(loc1)}
            </text>
            ${loc2Svg}
            <text x="${layoutGeom.dateX}" y="${layoutGeom.dateY}"
              font-size="${layoutGeom.fontDate}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedCompact ? this.deps.escapeXml(borrowedCompact) : ''}
            </text>
            ${warnSvg}
            ${riggingIdNumText
              ? `<text x="${layoutGeom.textMaxX}" y="${y + cardHeight - cardPadding - Math.round(18 * scale)}"
                  text-anchor="end" font-size="${Math.max(12, Math.round(12 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
                  ${this.deps.escapeXml(riggingIdNumText)}
                </text>`
              : ''
            }
            <text x="${layoutGeom.textMaxX}" y="${y + cardHeight - cardPadding}"
              text-anchor="end" font-size="${Math.max(12, Math.round(13 * scale))}" font-weight="600" fill="#ffffff" font-family="monospace">
              ${this.deps.escapeXml(managementText || '')}
            </text>
          </g>
        `;
        }

        if (thumbBase64) {
          const thumbX = x + cardPadding;
          const thumbY = y + Math.round((cardHeight - thumbnailHeight) / 2);
          thumbnailElement = `
                <clipPath id="${clipId}">
                  <rect x="${thumbX}" y="${thumbY}"
                    width="${thumbnailWidth}" height="${thumbnailHeight}" rx="${Math.round(8 * scale)}" ry="${Math.round(8 * scale)}" />
                </clipPath>
                <image x="${thumbX}" y="${thumbY}"
                  width="${thumbnailWidth}" height="${thumbnailHeight}"
                  href="${thumbBase64}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />
              `;
        }

        const borrowedDate = tool.borrowedDatePart;
        const borrowedTime = tool.borrowedTimePart;
        const secondary = tool.employeeName ? `${tool.employeeName} さん` : '未割当';
        const textAreaX = hasThumbnail ? cardPadding + thumbnailSize + thumbnailGap : cardPadding;

        const textStartY = y + cardPadding;
        const textX = x + textAreaX;
        const primaryY = textStartY + Math.round(20 * scale);
        const nameY = primaryY + Math.round(24 * scale);
        const locationY = nameY + Math.round(20 * scale);
        const dateTimeY = locationY + Math.round(20 * scale);
        const dateX = textX;
        const timeX = textX + (borrowedDate ? Math.round(80 * scale) : 0);
        const warningY = dateTimeY + Math.round(18 * scale);
        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="${cardFill}" stroke="${cardStroke}" stroke-width="${strokeWidth}" />
            ${thumbnailElement}
            <text x="${textX}" y="${primaryY}"
              font-size="${Math.max(16, Math.round(18 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(primaryText)}
            </text>
            <text x="${textX}" y="${nameY}"
              font-size="${Math.max(14, Math.round(16 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.deps.escapeXml(secondary)}
            </text>
            <text x="${textX}" y="${locationY}"
              font-size="${Math.max(12, Math.round(13 * scale))}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
              ${this.deps.escapeXml(clientLocationText)}
            </text>
            <text x="${dateX}" y="${dateTimeY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedDate ? this.deps.escapeXml(borrowedDate) : ''}
            </text>
            <text x="${timeX}" y="${dateTimeY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedTime ? this.deps.escapeXml(borrowedTime) : ''}
            </text>
            ${isExceeded
              ? `<text x="${textX}" y="${warningY}"
                  font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                  ⚠ 期限超過
                </text>`
              : ''
            }
            ${riggingIdNumText
              ? `<text x="${x + cardWidth - cardPadding}" y="${y + cardHeight - cardPadding - Math.round(18 * scale)}"
                  text-anchor="end" font-size="${Math.max(12, Math.round(12 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
                  ${this.deps.escapeXml(riggingIdNumText)}
                </text>`
              : ''
            }
            <text x="${x + cardWidth - cardPadding}" y="${y + cardHeight - cardPadding}"
              text-anchor="end" font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="monospace">
              ${this.deps.escapeXml(managementText || '')}
            </text>
          </g>
        `;
      })
    );

    const fragments: string[] = [...cards];

    if (layout.isEmpty) {
      fragments.push(`
        <text x="${config.x}" y="${config.y + Math.round(40 * scale)}"
          font-size="${Math.round(28 * scale)}" fill="#ffffff" font-family="sans-serif">
          表示するアイテムがありません
        </text>
      `);
    }

    return {
      kind: 'svg_fragment',
      fragment: fragments.join('\n'),
      overflowCount: layout.overflowCount,
    };
  }
}
