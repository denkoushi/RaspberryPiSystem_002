import { PHOTO_LOAN_CARD_PRIMARY_LABEL } from '@raspi-system/shared-types';
import type { SignageContentResponse } from '../signage.service.js';
import { formatBorrowedCompactLine } from '../loan-card/loan-card-text.js';
import type { LoanCardCompactKioskLines, LoanCardViewModel } from './loan-card-grid.dto.js';
import type { ToolGridConfig } from './tool-grid-config.js';
import type { SvgLoanGridDependencies } from './svg-loan-grid-dependencies.js';

export type ToolItemInput = NonNullable<SignageContentResponse['tools']>[number] & {
  isOver12Hours?: boolean;
  isOverdue?: boolean;
};

export async function buildLoanCardViewModels(
  tools: ToolItemInput[],
  config: ToolGridConfig,
  canvasWidth: number,
  formatBorrowedAt: (isoDate?: string | null) => string | null,
  deps: SvgLoanGridDependencies
): Promise<LoanCardViewModel[]> {
  const scale = canvasWidth / 1920;
  const thumbnailSize = Math.round(96 * scale);
  const thumbnailWidth = thumbnailSize;
  const thumbnailHeight = thumbnailSize;

  const models: LoanCardViewModel[] = [];

  for (const tool of tools) {
    const primaryText = tool.name || PHOTO_LOAN_CARD_PRIMARY_LABEL;
    const clientLocationText = tool.clientLocation?.trim() ? tool.clientLocation.trim() : '-';
    const isInstrument = Boolean(tool.isInstrument);
    const isRigging = Boolean(tool.isRigging);
    const managementText = isInstrument || isRigging
      ? (tool.managementNumber || tool.itemCode || '')
      : (tool.itemCode || '');
    const riggingIdNumText =
      isRigging && tool.idNum && tool.idNum.trim().length > 0 ? `旧:${tool.idNum.trim()}` : '';
    const isExceeded = Boolean(tool.isOver12Hours) || Boolean(tool.isOverdue);

    let thumbnailDataUrl: string | null = null;
    if (config.showThumbnails && tool.thumbnailUrl) {
      const thumbnailPath = deps.resolveThumbnailLocalPath(tool.thumbnailUrl);
      if (thumbnailPath) {
        thumbnailDataUrl = await deps.encodeLocalImageAsBase64(
          thumbnailPath,
          thumbnailWidth,
          thumbnailHeight,
          'cover'
        );
      }
    }

    const borrowedFormatted = formatBorrowedAt(tool.borrowedAt);
    const borrowedText = borrowedFormatted ?? '';
    const [borrowedDatePart, borrowedTimePart = ''] = borrowedText.split(' ');
    const borrowedCompact = formatBorrowedCompactLine(borrowedFormatted);

    let compactKioskLines: LoanCardCompactKioskLines | undefined;
    if (isInstrument) {
      compactKioskLines = {
        headLine: tool.managementNumber?.trim() || tool.itemCode?.trim() || '管理番号なし',
        nameLine: tool.name?.trim() || '計測機器',
      };
    } else if (isRigging) {
      const idRaw = tool.idNum?.trim();
      compactKioskLines = {
        headLine: tool.managementNumber?.trim() || tool.itemCode?.trim() || '管理番号なし',
        nameLine: tool.name?.trim() || '吊具',
        idNumValue: idRaw && idRaw.length > 0 ? idRaw : '-',
      };
    }

    models.push({
      primaryText,
      employeeName: tool.employeeName ?? null,
      clientLocation: clientLocationText,
      borrowedDatePart: borrowedDatePart ?? '',
      borrowedTimePart,
      borrowedCompact,
      isInstrument,
      isRigging,
      managementText,
      riggingIdNumText,
      isExceeded,
      thumbnailDataUrl,
      compactKioskLines,
    });
  }

  return models;
}
