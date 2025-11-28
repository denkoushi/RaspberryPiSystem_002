import { SignageContentType, SignageDisplayMode } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

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

export interface SignageContentResponse {
  contentType: SignageContentType;
  displayMode: SignageDisplayMode;
  tools?: Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl?: string | null;
  }>;
  pdf?: {
    id: string;
    name: string;
    pages: string[];
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
    const currentDayOfWeek = now.getDay(); // 0=日曜日, 1=月曜日, ..., 6=土曜日
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
            },
          };
        }
      } else if (schedule.contentType === SignageContentType.SPLIT) {
        const tools = await this.getToolsData();
        const pdf = schedule.pdfId ? await prisma.signagePdf.findUnique({
          where: { id: schedule.pdfId },
        }) : null;
        
        return {
          contentType: SignageContentType.SPLIT,
          displayMode: SignageDisplayMode.SINGLE,
          tools,
          pdf: pdf && pdf.enabled ? {
            id: pdf.id,
            name: pdf.name,
            pages: await this.getPdfPages(pdf.id),
          } : null,
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
  private async getToolsData(): Promise<Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl: string | null;
  }>> {
    const items = await prisma.item.findMany({
      where: { status: 'AVAILABLE' },
      select: {
        id: true,
        itemCode: true,
        name: true,
      },
      orderBy: { itemCode: 'asc' },
      take: 100, // 最大100件
    });

    // サムネイルURLを取得（LoanのphotoUrlから）
    const itemsWithThumbnails = await Promise.all(
      items.map(async (item) => {
        const loan = await prisma.loan.findFirst({
          where: {
            itemId: item.id,
            photoUrl: { not: null },
          },
          orderBy: { photoTakenAt: 'desc' },
          select: { photoUrl: true },
        });

        let thumbnailUrl: string | null = null;
        if (loan?.photoUrl) {
          // photoUrlからサムネイルURLを生成
          // 例: /api/storage/photos/2025/11/xxx.jpg → /storage/thumbnails/2025/11/xxx_thumb.jpg
          const photoPath = loan.photoUrl.replace('/api/storage/photos/', '');
          const pathParts = photoPath.split('/');
          const filename = pathParts[pathParts.length - 1];
          const dir = pathParts.slice(0, -1).join('/');
          thumbnailUrl = `/storage/thumbnails/${dir}/${filename.replace('.jpg', '_thumb.jpg')}`;
        }

        return {
          id: item.id,
          itemCode: item.itemCode,
          name: item.name,
          thumbnailUrl,
        };
      })
    );

    return itemsWithThumbnails;
  }

  /**
   * PDFのページURL一覧を取得
   */
  private async getPdfPages(pdfId: string): Promise<string[]> {
    // TODO: PDFを画像に変換してページURLを生成
    // 現時点では空配列を返す
    return [];
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
}

