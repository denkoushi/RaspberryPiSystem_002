import { SignageContentType, SignageDisplayMode } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { PdfStorage } from '../../lib/pdf-storage.js';

export interface SignageScheduleInput {
  name: string;
  contentType: SignageContentType;
  pdfId?: string | null;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  enabled?: boolean;
}

export interface SignagePdfInput {
  name: string;
  filename: string;
  filePath: string;
  displayMode: SignageDisplayMode;
  slideInterval?: number | null;
  enabled?: boolean;
}

export interface SignageEmergencyInput {
  message?: string | null;
  contentType?: SignageContentType | null;
  pdfId?: string | null;
  enabled?: boolean;
  expiresAt?: Date | null;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface SignageContentResponse {
  contentType: SignageContentType;
  displayMode: SignageDisplayMode;
  tools?: Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl?: string | null;
    employeeName?: string | null;
    borrowedAt?: string | null;
  }>;
  pdf?: {
    id: string;
    name: string;
    pages: string[];
    slideInterval?: number | null;
  } | null;
}

export class SignageService {
  /**
   * 有効なスケジュール一覧を取得（優先順位順）
   */
  async getSchedules(): Promise<Array<{
    id: string;
    name: string;
    contentType: SignageContentType;
    pdfId: string | null;
    dayOfWeek: number[];
    startTime: string;
    endTime: string;
    priority: number;
    enabled: boolean;
  }>> {
    const schedules = await prisma.signageSchedule.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
      select: {
        id: true,
        name: true,
        contentType: true,
        pdfId: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        priority: true,
        enabled: true,
      },
    });
    return schedules;
  }

  /**
   * 現在時刻に基づいて表示すべきコンテンツを取得
   */
  async getContent(): Promise<SignageContentResponse> {
    const now = new Date();
    const { currentDayOfWeek, currentTime } = this.getCurrentTimeInfo(now);

    // 緊急表示を最優先で確認
    const emergency = await prisma.signageEmergency.findFirst({
      where: {
        enabled: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      include: {
        pdf: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (emergency) {
      logger.info({ emergencyId: emergency.id }, 'Emergency display active');
      
      if (emergency.contentType === SignageContentType.TOOLS) {
        const tools = await this.getToolsData();
        return {
          contentType: SignageContentType.TOOLS,
          displayMode: SignageDisplayMode.SINGLE,
          tools,
        };
      } else if (emergency.contentType === SignageContentType.PDF && emergency.pdf) {
        return {
          contentType: SignageContentType.PDF,
          displayMode: emergency.pdf.displayMode,
          pdf: {
            id: emergency.pdf.id,
            name: emergency.pdf.name,
            pages: await this.getPdfPages(emergency.pdf.id),
          },
        };
      } else if (emergency.message) {
        // メッセージのみの緊急表示（将来的に実装）
        return {
          contentType: SignageContentType.TOOLS,
          displayMode: SignageDisplayMode.SINGLE,
          tools: [],
        };
      }
    }

    // スケジュールから適切なコンテンツを取得
    const schedules = await this.getSchedules();
    
    for (const schedule of schedules) {
      // 曜日チェック
      if (!schedule.dayOfWeek.includes(currentDayOfWeek)) {
        continue;
      }

      // 時間帯チェック
      if (currentTime < schedule.startTime || currentTime >= schedule.endTime) {
        continue;
      }

      // スケジュールに一致した場合、コンテンツを返す
      if (schedule.contentType === SignageContentType.TOOLS) {
        const tools = await this.getToolsData();
        return {
          contentType: SignageContentType.TOOLS,
          displayMode: SignageDisplayMode.SINGLE,
          tools,
        };
      } else if (schedule.contentType === SignageContentType.PDF && schedule.pdfId) {
        const pdf = await prisma.signagePdf.findUnique({
          where: { id: schedule.pdfId },
        });
        if (pdf && pdf.enabled) {
          return {
            contentType: SignageContentType.PDF,
            displayMode: pdf.displayMode,
            pdf: {
              id: pdf.id,
              name: pdf.name,
              pages: await this.getPdfPages(pdf.id),
              slideInterval: pdf.slideInterval,
            },
          };
        }
      } else if (schedule.contentType === SignageContentType.SPLIT) {
        const tools = await this.getToolsData();
        const pdf = schedule.pdfId
          ? await prisma.signagePdf.findUnique({
              where: { id: schedule.pdfId },
            })
          : null;

        const hasEnabledPdf = !!(pdf && pdf.enabled);

        return {
          contentType: SignageContentType.SPLIT,
          displayMode: hasEnabledPdf ? pdf.displayMode : SignageDisplayMode.SINGLE,
          tools,
          pdf: hasEnabledPdf
            ? {
                id: pdf.id,
                name: pdf.name,
                pages: await this.getPdfPages(pdf.id),
                slideInterval: pdf.slideInterval,
              }
            : null,
        };
      }
    }

    // デフォルト: 工具管理データを表示
    const tools = await this.getToolsData();
    return {
      contentType: SignageContentType.TOOLS,
      displayMode: SignageDisplayMode.SINGLE,
      tools,
    };
  }

  /**
   * 工具管理データを取得
   */
  private async getToolsData(): Promise<
    Array<{
      id: string;
      itemCode: string;
      name: string;
      thumbnailUrl: string | null;
    }>
  > {
    // まずは現在貸出中（returnedAt / cancelledAt が null）の工具を取得
    const activeLoans = await prisma.loan.findMany({
      where: {
        returnedAt: null,
        cancelledAt: null,
      },
      include: {
        item: true,
        employee: true,
      },
      orderBy: {
        borrowedAt: 'desc',
      },
      take: 100,
    });

    const loanTools = activeLoans
      .map((loan) => {
        const itemCode = loan.item?.itemCode ?? loan.itemId ?? '';
        return {
          id: loan.id,
          itemCode: itemCode || loan.id.slice(0, 8),
          name: loan.item?.name ?? '貸出中の工具',
          thumbnailUrl: this.buildThumbnailUrl(loan.photoUrl),
          employeeName: loan.employee?.displayName ?? null,
          borrowedAt: loan.borrowedAt?.toISOString() ?? null,
        };
      })
      .filter((tool) => Boolean(tool.itemCode));

    if (loanTools.length > 0) {
      return loanTools;
    }

    // 貸出中がない場合は、従来どおり利用可能な工具一覧を表示
    const items = await prisma.item.findMany({
      where: { status: 'AVAILABLE' },
      select: {
        id: true,
        itemCode: true,
        name: true,
      },
      orderBy: { itemCode: 'asc' },
      take: 100,
    });

    return items.map((item) => ({
      id: item.id,
      itemCode: item.itemCode,
      name: item.name,
      thumbnailUrl: null,
      employeeName: null,
      borrowedAt: null,
    }));
  }

  private buildThumbnailUrl(photoUrl?: string | null): string | null {
    if (!photoUrl) {
      return null;
    }

    if (!photoUrl.startsWith('/api/storage/photos/')) {
      return null;
    }

    const photoPath = photoUrl.replace('/api/storage/photos/', '');
    const pathParts = photoPath.split('/');
    const filename = pathParts.pop();
    const dir = pathParts.join('/');

    if (!filename) {
      return null;
    }

    return `/storage/thumbnails/${dir}/${filename.replace('.jpg', '_thumb.jpg')}`;
  }

  /**
   * PDFのページURL一覧を取得
   */
  private async getPdfPages(pdfId: string): Promise<string[]> {
    const pdf = await prisma.signagePdf.findUnique({
      where: { id: pdfId },
    });

    if (!pdf) {
      return [];
    }

    // PDFファイルのパスを取得
    const pdfFilePath = pdf.filePath;
    
    // PDFを画像に変換してページURL一覧を取得
    const pageUrls = await PdfStorage.convertPdfToPages(pdfId, pdfFilePath);
    
    return pageUrls;
  }

  /**
   * スケジュールを作成
   */
  async createSchedule(input: SignageScheduleInput): Promise<{
    id: string;
    name: string;
    contentType: SignageContentType;
    pdfId: string | null;
    dayOfWeek: number[];
    startTime: string;
    endTime: string;
    priority: number;
    enabled: boolean;
  }> {
    const schedule = await prisma.signageSchedule.create({
      data: {
        name: input.name,
        contentType: input.contentType,
        pdfId: input.pdfId ?? null,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        priority: input.priority,
        enabled: input.enabled ?? true,
      },
    });
    return schedule;
  }

  /**
   * スケジュールを更新
   */
  async updateSchedule(id: string, input: Partial<SignageScheduleInput>): Promise<{
    id: string;
    name: string;
    contentType: SignageContentType;
    pdfId: string | null;
    dayOfWeek: number[];
    startTime: string;
    endTime: string;
    priority: number;
    enabled: boolean;
  }> {
    const schedule = await prisma.signageSchedule.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.contentType !== undefined && { contentType: input.contentType }),
        ...(input.pdfId !== undefined && { pdfId: input.pdfId ?? null }),
        ...(input.dayOfWeek !== undefined && { dayOfWeek: input.dayOfWeek }),
        ...(input.startTime !== undefined && { startTime: input.startTime }),
        ...(input.endTime !== undefined && { endTime: input.endTime }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });
    return schedule;
  }

  /**
   * スケジュールを削除
   */
  async deleteSchedule(id: string): Promise<void> {
    await prisma.signageSchedule.delete({
      where: { id },
    });
  }

  /**
   * PDF一覧を取得
   */
  async getPdfs(): Promise<Array<{
    id: string;
    name: string;
    filename: string;
    displayMode: SignageDisplayMode;
    slideInterval: number | null;
    enabled: boolean;
    createdAt: Date;
  }>> {
    const pdfs = await prisma.signagePdf.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        filename: true,
        displayMode: true,
        slideInterval: true,
        enabled: true,
        createdAt: true,
      },
    });
    return pdfs;
  }

  /**
   * PDFを作成
   */
  async createPdf(input: SignagePdfInput): Promise<{
    id: string;
    name: string;
    filename: string;
    filePath: string;
    displayMode: SignageDisplayMode;
    slideInterval: number | null;
    enabled: boolean;
  }> {
    const pdf = await prisma.signagePdf.create({
      data: {
        name: input.name,
        filename: input.filename,
        filePath: input.filePath,
        displayMode: input.displayMode,
        slideInterval: input.slideInterval ?? null,
        enabled: input.enabled ?? true,
      },
    });
    return pdf;
  }

  /**
   * PDFを更新
   */
  async updatePdf(id: string, input: Partial<SignagePdfInput>): Promise<{
    id: string;
    name: string;
    filename: string;
    filePath: string;
    displayMode: SignageDisplayMode;
    slideInterval: number | null;
    enabled: boolean;
  }> {
    const pdf = await prisma.signagePdf.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.filename !== undefined && { filename: input.filename }),
        ...(input.filePath !== undefined && { filePath: input.filePath }),
        ...(input.displayMode !== undefined && { displayMode: input.displayMode }),
        ...(input.slideInterval !== undefined && { slideInterval: input.slideInterval ?? null }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });
    return pdf;
  }

  /**
   * PDFを削除
   */
  async deletePdf(id: string): Promise<void> {
    // PDFページ画像も削除
    await PdfStorage.deletePdfPages(id);
    
    await prisma.signagePdf.delete({
      where: { id },
    });
  }

  /**
   * 緊急表示情報を取得
   */
  async getEmergency(): Promise<{
    enabled: boolean;
    message: string | null;
    contentType: SignageContentType | null;
    pdfId: string | null;
    expiresAt: Date | null;
  } | null> {
    const now = new Date();
    const emergency = await prisma.signageEmergency.findFirst({
      where: {
        enabled: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!emergency) {
      return null;
    }

    return {
      enabled: emergency.enabled,
      message: emergency.message,
      contentType: emergency.contentType,
      pdfId: emergency.pdfId,
      expiresAt: emergency.expiresAt,
    };
  }

  /**
   * 緊急表示を設定
   */
  async setEmergency(input: SignageEmergencyInput): Promise<{
    id: string;
    enabled: boolean;
    message: string | null;
    contentType: SignageContentType | null;
    pdfId: string | null;
    expiresAt: Date | null;
  }> {
    // 既存の緊急表示を無効化
    await prisma.signageEmergency.updateMany({
      where: { enabled: true },
      data: { enabled: false },
    });

    // 新しい緊急表示を作成
    const emergency = await prisma.signageEmergency.create({
      data: {
        message: input.message ?? null,
        contentType: input.contentType ?? null,
        pdfId: input.pdfId ?? null,
        enabled: input.enabled ?? true,
        expiresAt: input.expiresAt ?? null,
      },
    });

    return emergency;
  }

  private getCurrentTimeInfo(baseDate: Date): { currentDayOfWeek: number; currentTime: string } {
    const timezone = process.env.SIGNAGE_TIMEZONE || 'Asia/Tokyo';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(baseDate);
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    const currentDayOfWeek = WEEKDAY_MAP[weekday] ?? 0;
    const currentTime = `${hour}:${minute}`;
    return { currentDayOfWeek, currentTime };
  }
}
