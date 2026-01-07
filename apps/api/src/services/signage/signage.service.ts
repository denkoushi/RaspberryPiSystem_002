import { SignageContentType, SignageDisplayMode } from '@prisma/client';
import type { SignageSchedule } from '@prisma/client';

type ScheduleSummary = Pick<
  SignageSchedule,
  'id' | 'name' | 'contentType' | 'pdfId' | 'layoutConfig' | 'dayOfWeek' | 'startTime' | 'endTime' | 'priority' | 'enabled'
>;
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { PdfStorage } from '../../lib/pdf-storage.js';
import type {
  SignageLayoutConfig,
  SignageLayoutConfigJson,
  SignageSlot,
  PdfSlotConfig,
  LoansSlotConfig,
} from './signage-layout.types.js';

export interface SignageScheduleInput {
  name: string;
  contentType: SignageContentType;
  pdfId?: string | null;
  layoutConfig?: SignageLayoutConfigJson;
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
  layoutConfig?: SignageLayoutConfigJson;
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
  layoutConfig?: SignageLayoutConfig; // 新形式のレイアウト設定（優先）
  tools?: Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl?: string | null;
    employeeName?: string | null;
    borrowedAt?: string | null;
    isInstrument?: boolean;
    isRigging?: boolean;
    managementNumber?: string | null;
  }>;
  measuringInstruments?: Array<{
    id: string;
    managementNumber: string;
    name: string;
    storageLocation?: string | null;
    calibrationExpiryDate?: string | null;
    status: string;
    isOverdue?: boolean;
    isDueSoon?: boolean;
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
  async getSchedules(): Promise<ScheduleSummary[]> {
    const schedules = await prisma.signageSchedule.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
      select: {
        id: true,
        name: true,
        contentType: true,
        pdfId: true,
        layoutConfig: true,
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
   * 旧形式（contentType/pdfId）から新形式（layoutConfig）への変換
   */
  private convertLegacyToLayoutConfig(
    contentType: SignageContentType,
    pdfId: string | null,
    pdf?: { id: string; displayMode: SignageDisplayMode; slideInterval: number | null } | null
  ): SignageLayoutConfig {
    if (contentType === SignageContentType.TOOLS) {
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'loans',
            config: {} as LoansSlotConfig,
          },
        ],
      };
    }

    if (contentType === SignageContentType.PDF && pdfId && pdf) {
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'pdf',
            config: {
              pdfId,
              displayMode: pdf.displayMode === SignageDisplayMode.SLIDESHOW ? 'SLIDESHOW' : 'SINGLE',
              slideInterval: pdf.slideInterval,
            } as PdfSlotConfig,
          },
        ],
      };
    }

    if (contentType === SignageContentType.SPLIT) {
      const slots: SignageSlot[] = [
        {
          position: 'LEFT',
          kind: 'loans',
          config: {} as LoansSlotConfig,
        },
      ];

      if (pdfId && pdf) {
        slots.push({
          position: 'RIGHT',
          kind: 'pdf',
          config: {
            pdfId,
            displayMode: pdf.displayMode === SignageDisplayMode.SLIDESHOW ? 'SLIDESHOW' : 'SINGLE',
            slideInterval: pdf.slideInterval,
          } as PdfSlotConfig,
        });
      }

      return {
        layout: 'SPLIT',
        slots,
      };
    }

    // フォールバック: TOOLS
    return {
      layout: 'FULL',
      slots: [
        {
          position: 'FULL',
          kind: 'loans',
          config: {} as LoansSlotConfig,
        },
      ],
    };
  }

  /**
   * 現在時刻に基づいて表示すべきコンテンツを取得
   */
  async getContent(): Promise<SignageContentResponse> {
    const now = new Date();
    const { currentDayOfWeek, currentTime } = this.getCurrentTimeInfo(now);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:197',message:'getContent called',data:{currentDayOfWeek,currentTime:currentTime,now:now.toISOString()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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
      
      // layoutConfigを優先し、nullの場合は旧形式から変換
      let layoutConfig: SignageLayoutConfig;
      if (emergency.layoutConfig && typeof emergency.layoutConfig === 'object') {
        layoutConfig = emergency.layoutConfig as unknown as SignageLayoutConfig;
      } else {
        // 旧形式から変換
        const contentType = emergency.contentType || SignageContentType.TOOLS;
        const pdf = emergency.pdf
          ? {
              id: emergency.pdf.id,
              displayMode: emergency.pdf.displayMode,
              slideInterval: emergency.pdf.slideInterval,
            }
          : null;
        layoutConfig = this.convertLegacyToLayoutConfig(contentType, emergency.pdfId, pdf);
      }

      // layoutConfigに基づいてレスポンスを構築
      const [tools, measuringInstruments] = await Promise.all([this.getToolsData(), this.getMeasuringInstrumentData()]);
      
      // PDFスロットの情報を収集
      const pdfSlots = layoutConfig.slots.filter((slot) => slot.kind === 'pdf') as Array<SignageSlot & { config: PdfSlotConfig }>;
      const pdfDataMap = new Map<string, { id: string; name: string; pages: string[]; slideInterval: number | null }>();

      for (const slot of pdfSlots) {
        const pdfId = slot.config.pdfId;
        if (!pdfDataMap.has(pdfId)) {
          const pdfRecord = await prisma.signagePdf.findUnique({
            where: { id: pdfId },
          });
          if (pdfRecord && pdfRecord.enabled) {
            const pages = await this.getPdfPages(pdfId);
            pdfDataMap.set(pdfId, {
              id: pdfRecord.id,
              name: pdfRecord.name,
              pages,
              slideInterval: pdfRecord.slideInterval,
            });
          }
        }
      }

      // 後方互換のため、contentTypeとdisplayModeを決定
      let contentType: SignageContentType;
      let displayMode: SignageDisplayMode = SignageDisplayMode.SINGLE;

      if (layoutConfig.layout === 'FULL') {
        if (layoutConfig.slots.some((s) => s.kind === 'pdf')) {
          contentType = SignageContentType.PDF;
          const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig };
          if (pdfSlot) {
            displayMode = pdfSlot.config.displayMode === 'SLIDESHOW' ? SignageDisplayMode.SLIDESHOW : SignageDisplayMode.SINGLE;
          }
        } else {
          contentType = SignageContentType.TOOLS;
        }
      } else {
        contentType = SignageContentType.SPLIT;
        const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig } | undefined;
        if (pdfSlot) {
          displayMode = pdfSlot.config.displayMode === 'SLIDESHOW' ? SignageDisplayMode.SLIDESHOW : SignageDisplayMode.SINGLE;
        }
      }

      // PDF情報を取得（後方互換のため）
      let pdfPayload: SignageContentResponse['pdf'] = null;
      if (contentType === SignageContentType.PDF || contentType === SignageContentType.SPLIT) {
        const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig } | undefined;
        if (pdfSlot) {
          pdfPayload = pdfDataMap.get(pdfSlot.config.pdfId) || null;
        }
      }

      return {
        contentType,
        displayMode,
        layoutConfig, // 新形式を追加
        tools: layoutConfig.slots.some((s) => s.kind === 'loans') ? tools : undefined,
        measuringInstruments: layoutConfig.slots.some((s) => s.kind === 'loans') ? measuringInstruments : undefined,
        pdf: pdfPayload,
      };
    }

    // スケジュールから適切なコンテンツを取得
    const schedules = await this.getSchedules();
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:303',message:'Checking schedules',data:{scheduleCount:schedules.length,schedules:schedules.map(s=>({id:s.id,name:s.name,priority:s.priority,enabled:s.enabled,dayOfWeek:s.dayOfWeek,startTime:s.startTime,endTime:s.endTime,hasLayoutConfig:s.layoutConfig!=null}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    for (const schedule of schedules) {
      const matches = this.matchesScheduleWindow(schedule, currentDayOfWeek, currentTime);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:306',message:'Schedule window check',data:{scheduleId:schedule.id,scheduleName:schedule.name,matches,currentDayOfWeek,currentTime,dayOfWeek:schedule.dayOfWeek,startTime:schedule.startTime,endTime:schedule.endTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (!matches) {
        continue;
      }

      const response = await this.buildScheduleResponse(schedule);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:310',message:'Schedule response built',data:{scheduleId:schedule.id,scheduleName:schedule.name,responseContentType:response?.contentType,responseLayoutConfig:response?.layoutConfig},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (response) {
        return response;
      }
    }

    const fallbackSchedule =
      schedules.find((schedule) => schedule.contentType === SignageContentType.SPLIT) ?? schedules[0];
    if (fallbackSchedule) {
      const fallbackResponse = await this.buildScheduleResponse(fallbackSchedule);
      if (fallbackResponse) {
        logger.warn(
          {
            scheduleId: fallbackSchedule.id,
            contentType: fallbackSchedule.contentType,
          },
          'No signage schedule matched current window; falling back to highest-priority schedule',
        );
        return fallbackResponse;
      }
    }

    // デフォルト: 工具管理データを表示
    const [tools, measuringInstruments] = await Promise.all([this.getToolsData(), this.getMeasuringInstrumentData()]);
    return {
      contentType: SignageContentType.TOOLS,
      displayMode: SignageDisplayMode.SINGLE,
      tools,
      measuringInstruments,
    };
  }

  /**
   * 工具管理データを取得（計測機器の持出も含む）
   */
  private async getToolsData(): Promise<
    Array<{
      id: string;
      itemCode: string;
      name: string;
      thumbnailUrl: string | null;
      employeeName?: string | null;
      borrowedAt?: string | null;
      isInstrument?: boolean;
      isRigging?: boolean;
      managementNumber?: string | null;
    }>
  > {
    // まずは現在貸出中（returnedAt / cancelledAt が null）の工具・計測機器・吊具を取得
    const activeLoans = await prisma.loan.findMany({
      where: {
        returnedAt: null,
        cancelledAt: null,
      },
      include: {
        item: true,
        employee: true,
        measuringInstrument: true,
        riggingGear: true,
      },
      orderBy: {
        borrowedAt: 'desc',
      },
      take: 100,
    });

    const loanTools = activeLoans
      .map((loan) => {
        const isInstrument = Boolean(loan.measuringInstrument);
        const isRigging = Boolean(loan.riggingGear);
        const itemCode = isInstrument
          ? (loan.measuringInstrument?.managementNumber ?? '')
          : isRigging
            ? (loan.riggingGear?.managementNumber ?? '')
          : (loan.item?.itemCode ?? loan.itemId ?? '');
        const borrowedAt = loan.borrowedAt?.toISOString() ?? null;
        const now = new Date();
        const borrowedDate = loan.borrowedAt ? new Date(loan.borrowedAt) : null;
        const diffMs = borrowedDate ? now.getTime() - borrowedDate.getTime() : 0;
        const diffHours = diffMs / (1000 * 60 * 60);
        const isOver12Hours = diffHours > 12;
        
        const name = isInstrument
          ? (loan.measuringInstrument?.name ?? '計測機器')
          : isRigging
            ? (loan.riggingGear?.name ?? '吊具')
          : (loan.item?.name ?? (loan.photoUrl ? '写真撮影モード' : '持出中アイテム'));
        
        return {
          id: loan.id,
          itemCode: itemCode || loan.id.slice(0, 8),
          name,
          thumbnailUrl: this.buildThumbnailUrl(loan.photoUrl),
          employeeName: loan.employee?.displayName ?? null,
          borrowedAt: borrowedAt,
          isOver12Hours: isOver12Hours,
          isInstrument,
          isRigging,
          managementNumber: isInstrument
            ? loan.measuringInstrument?.managementNumber
            : isRigging
              ? loan.riggingGear?.managementNumber
              : null,
        };
      })
      .filter((tool) => Boolean(tool.itemCode) || tool.isInstrument || tool.isRigging)
      // 12時間超のアイテムを最上位にソート
      .sort((a, b) => {
        if (a.isOver12Hours && !b.isOver12Hours) return -1;
        if (!a.isOver12Hours && b.isOver12Hours) return 1;
        if (a.borrowedAt && b.borrowedAt) {
          return new Date(b.borrowedAt).getTime() - new Date(a.borrowedAt).getTime();
        }
        return 0;
      });

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
      isInstrument: false,
      managementNumber: null,
    }));
  }

  /**
   * 計測機器データを取得（校正期限アラート含む）
   */
  private async getMeasuringInstrumentData(): Promise<
    Array<{
      id: string;
      managementNumber: string;
      name: string;
      storageLocation: string | null;
      calibrationExpiryDate: string | null;
      status: string;
      isOverdue: boolean;
      isDueSoon: boolean;
    }>
  > {
    const instruments = await prisma.measuringInstrument.findMany({
      select: {
        id: true,
        managementNumber: true,
        name: true,
        storageLocation: true,
        calibrationExpiryDate: true,
        status: true,
      },
      orderBy: { managementNumber: 'asc' },
      take: 100,
    });

    const now = new Date();
    const soonThresholdMs = 30 * 24 * 60 * 60 * 1000; // 30日

    return instruments.map((inst) => {
      const expiry = inst.calibrationExpiryDate ? new Date(inst.calibrationExpiryDate) : null;
      const isOverdue = expiry ? expiry.getTime() < now.getTime() : false;
      const isDueSoon = expiry ? !isOverdue && expiry.getTime() - now.getTime() <= soonThresholdMs : false;
      return {
        id: inst.id,
        managementNumber: inst.managementNumber,
        name: inst.name,
        storageLocation: inst.storageLocation ?? null,
        calibrationExpiryDate: inst.calibrationExpiryDate?.toISOString() ?? null,
        status: inst.status,
        isOverdue,
        isDueSoon,
      };
    });
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

  private matchesScheduleWindow(schedule: ScheduleSummary, currentDayOfWeek: number, currentTime: string): boolean {
    if (!schedule.dayOfWeek.includes(currentDayOfWeek)) {
      return false;
    }
    if (currentTime < schedule.startTime || currentTime >= schedule.endTime) {
      return false;
    }
    return true;
  }

  private async buildScheduleResponse(schedule: ScheduleSummary): Promise<SignageContentResponse | null> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:554',message:'buildScheduleResponse called',data:{scheduleId:schedule.id,scheduleName:schedule.name,hasLayoutConfig:schedule.layoutConfig!=null,layoutConfigType:typeof schedule.layoutConfig,contentType:schedule.contentType},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // layoutConfigを優先し、nullの場合は旧形式から変換
    let layoutConfig: SignageLayoutConfig;
    let pdf: { id: string; displayMode: SignageDisplayMode; slideInterval: number | null } | null = null;

    if (schedule.layoutConfig && typeof schedule.layoutConfig === 'object') {
      // 新形式（layoutConfig）を使用
      layoutConfig = schedule.layoutConfig as unknown as SignageLayoutConfig;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:561',message:'Using new layoutConfig format',data:{scheduleId:schedule.id,layoutConfig},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } else {
      // 旧形式から変換（PDF情報が必要な場合は取得）
      if (schedule.pdfId) {
        pdf = await prisma.signagePdf.findUnique({
          where: { id: schedule.pdfId },
          select: {
            id: true,
            displayMode: true,
            slideInterval: true,
          },
        });
      }
      layoutConfig = this.convertLegacyToLayoutConfig(schedule.contentType, schedule.pdfId, pdf);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.service.ts:574',message:'Converted from legacy format',data:{scheduleId:schedule.id,layoutConfig},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    }

    // layoutConfigに基づいてレスポンスを構築
    const [tools, measuringInstruments] = await Promise.all([this.getToolsData(), this.getMeasuringInstrumentData()]);
    
    // PDFスロットの情報を収集
    const pdfSlots = layoutConfig.slots.filter((slot) => slot.kind === 'pdf') as Array<SignageSlot & { config: PdfSlotConfig }>;
    const pdfDataMap = new Map<string, { id: string; name: string; pages: string[]; slideInterval: number | null }>();

    for (const slot of pdfSlots) {
      const pdfId = slot.config.pdfId;
      if (!pdfDataMap.has(pdfId)) {
        const pdfRecord = await prisma.signagePdf.findUnique({
          where: { id: pdfId },
        });
        if (pdfRecord && pdfRecord.enabled) {
          const pages = await this.getPdfPages(pdfId);
          pdfDataMap.set(pdfId, {
            id: pdfRecord.id,
            name: pdfRecord.name,
            pages,
            slideInterval: pdfRecord.slideInterval,
          });
        }
      }
    }

    // 後方互換のため、contentTypeとdisplayModeを決定
    let contentType: SignageContentType;
    let displayMode: SignageDisplayMode = SignageDisplayMode.SINGLE;

    if (layoutConfig.layout === 'FULL') {
      if (layoutConfig.slots.some((s) => s.kind === 'pdf')) {
        contentType = SignageContentType.PDF;
        const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig };
        if (pdfSlot) {
          displayMode = pdfSlot.config.displayMode === 'SLIDESHOW' ? SignageDisplayMode.SLIDESHOW : SignageDisplayMode.SINGLE;
        }
      } else {
        contentType = SignageContentType.TOOLS;
      }
    } else {
      contentType = SignageContentType.SPLIT;
      const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig } | undefined;
      if (pdfSlot) {
        displayMode = pdfSlot.config.displayMode === 'SLIDESHOW' ? SignageDisplayMode.SLIDESHOW : SignageDisplayMode.SINGLE;
      }
    }

    // PDF情報を取得（後方互換のため）
    let pdfPayload: SignageContentResponse['pdf'] = null;
    if (contentType === SignageContentType.PDF || contentType === SignageContentType.SPLIT) {
      const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf') as SignageSlot & { config: PdfSlotConfig } | undefined;
      if (pdfSlot) {
        pdfPayload = pdfDataMap.get(pdfSlot.config.pdfId) || null;
      }
    }

    return {
      contentType,
      displayMode,
      layoutConfig, // 新形式を追加
      tools: layoutConfig.slots.some((s) => s.kind === 'loans') ? tools : undefined,
      measuringInstruments: layoutConfig.slots.some((s) => s.kind === 'loans') ? measuringInstruments : undefined,
      pdf: pdfPayload,
    };
  }

  /**
   * スケジュールを作成
   */
  async createSchedule(input: SignageScheduleInput): Promise<{
    id: string;
    name: string;
    contentType: SignageContentType;
    pdfId: string | null;
    layoutConfig: SignageLayoutConfigJson;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layoutConfig: (input.layoutConfig ?? null) as any,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        priority: input.priority,
        enabled: input.enabled ?? true,
      },
    });
    return {
      ...schedule,
      layoutConfig: schedule.layoutConfig as SignageLayoutConfigJson,
    };
  }

  /**
   * スケジュールを更新
   */
  async updateSchedule(id: string, input: Partial<SignageScheduleInput>): Promise<{
    id: string;
    name: string;
    contentType: SignageContentType;
    pdfId: string | null;
    layoutConfig: SignageLayoutConfigJson;
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
        ...(input.layoutConfig !== undefined && {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layoutConfig: (input.layoutConfig ?? null) as any,
        }),
        ...(input.dayOfWeek !== undefined && { dayOfWeek: input.dayOfWeek }),
        ...(input.startTime !== undefined && { startTime: input.startTime }),
        ...(input.endTime !== undefined && { endTime: input.endTime }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });
    return {
      ...schedule,
      layoutConfig: schedule.layoutConfig as SignageLayoutConfigJson,
    };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layoutConfig: (input.layoutConfig ?? null) as any,
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
// Test deployment - Sat Dec  6 17:16:56 JST 2025
// Real deployment test - Sat Dec  6 17:18:27 JST 2025
