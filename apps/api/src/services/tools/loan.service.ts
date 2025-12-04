import type { Loan } from '@prisma/client';
import { ItemStatus, TransactionAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { ItemService } from './item.service.js';
import { EmployeeService } from './employee.service.js';
import { CameraService } from '../camera/index.js';
import { PhotoStorage } from '../../lib/photo-storage.js';
import sharp from 'sharp';
import { cameraConfig } from '../../config/camera.config.js';

export interface BorrowInput {
  itemTagUid: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: Date;
  note?: string | null;
}

export interface PhotoBorrowInput {
  employeeTagUid: string;
  photoData: string; // Base64エンコードされたJPEG画像データ
  clientId?: string;
  note?: string | null;
}

export interface ReturnInput {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}

export interface ActiveLoanQuery {
  clientId?: string;
}

interface LoanWithRelations extends Loan {
  item: { id: string; itemCode: string; name: string; nfcTagUid: string | null } | null;
  employee: { id: string; employeeCode: string; displayName: string; nfcTagUid: string | null } | null;
  client?: { id: string; name: string; location: string | null } | null;
}

export class LoanService {
  private itemService: ItemService;
  private employeeService: EmployeeService;
  private cameraService: CameraService;

  constructor() {
    this.itemService = new ItemService();
    this.employeeService = new EmployeeService();
    this.cameraService = new CameraService();
  }

  /**
   * クライアントIDを解決（clientIdまたはx-client-keyヘッダーから）
   */
  async resolveClientId(
    clientId: string | undefined,
    apiKeyHeader: string | string[] | undefined
  ): Promise<string | undefined> {
    if (clientId) {
      const client = await prisma.clientDevice.findUnique({ where: { id: clientId } });
      if (!client) {
        throw new ApiError(404, '指定されたクライアントが存在しません');
      }
      return client.id;
    }
    if (typeof apiKeyHeader === 'string') {
      const client = await prisma.clientDevice.findUnique({ where: { apiKey: apiKeyHeader } });
      if (!client) {
        throw new ApiError(401, 'クライアント API キーが不正です');
      }
      return client.id;
    }
    return undefined;
  }

  /**
   * 持出処理
   */
  async borrow(input: BorrowInput, resolvedClientId?: string): Promise<LoanWithRelations> {
    logger.info(
      {
        itemTagUid: input.itemTagUid,
        employeeTagUid: input.employeeTagUid,
        clientId: resolvedClientId,
      },
      'Borrow request started',
    );

    const item = await this.itemService.findByNfcTagUid(input.itemTagUid);
    if (!item) {
      logger.warn({ itemTagUid: input.itemTagUid }, 'Item not found for borrow');
      throw new ApiError(404, '対象アイテムが登録されていません');
    }
    if (item.status === ItemStatus.RETIRED) {
      logger.warn({ itemId: item.id, status: item.status }, 'Retired item borrow attempt');
      throw new ApiError(400, '廃棄済みアイテムは持出できません');
    }

    const employee = await this.employeeService.findByNfcTagUid(input.employeeTagUid);
    if (!employee) {
      logger.warn({ employeeTagUid: input.employeeTagUid }, 'Employee not found for borrow');
      throw new ApiError(404, '対象従業員が登録されていません');
    }

    const existingLoan = await prisma.loan.findFirst({
      where: { itemId: item.id, returnedAt: null }
    });
    if (existingLoan) {
      logger.warn(
        {
          itemId: item.id,
          existingLoanId: existingLoan.id,
        },
        'Item already on loan',
      );
      throw new ApiError(400, 'このアイテムはすでに貸出中です');
    }

    const itemSnapshot = {
      id: item.id,
      code: item.itemCode,
      name: item.name,
      nfcTagUid: item.nfcTagUid ?? null
    };
    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName,
      nfcTagUid: employee.nfcTagUid ?? null
    };

    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          itemId: item.id,
          employeeId: employee.id,
          clientId: resolvedClientId,
          dueAt: input.dueAt,
          notes: input.note ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      await tx.item.update({ where: { id: item.id }, data: { status: ItemStatus.IN_USE } });

      await tx.transaction.create({
        data: {
          loanId: createdLoan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: resolvedClientId,
          details: {
            note: input.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return createdLoan;
    });

    logger.info(
      {
        loanId: loan.id,
        itemId: item.id,
        itemCode: item.itemCode,
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        clientId: resolvedClientId,
      },
      'Borrow completed successfully',
    );

    return loan as LoanWithRelations;
  }

  /**
   * 返却処理
   */
  async return(
    input: ReturnInput,
    resolvedClientId?: string,
    performedByUserId?: string
  ): Promise<LoanWithRelations> {
    logger.info(
      {
        loanId: input.loanId,
        clientId: resolvedClientId,
        performedByUserId: performedByUserId ?? input.performedByUserId,
      },
      'Return request started',
    );

    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      include: { item: true, employee: true }
    });
    if (!loan) {
      logger.warn({ loanId: input.loanId }, 'Loan not found for return');
      throw new ApiError(404, '貸出レコードが見つかりません');
    }
    if (loan.returnedAt) {
      logger.warn({ loanId: loan.id, returnedAt: loan.returnedAt }, 'Loan already returned');
      throw new ApiError(400, 'すでに返却済みです');
    }

    // 写真撮影持出（itemIdがnull）の場合は、アイテムチェックをスキップ
    if (loan.itemId && !loan.item) {
      throw new ApiError(400, 'この貸出記録に関連するアイテムが見つかりません');
    }
    if (!loan.employee) {
      throw new ApiError(400, 'この貸出記録に関連する従業員が見つかりません');
    }

    const finalPerformedByUserId = performedByUserId ?? input.performedByUserId;
    const itemSnapshot = loan.item
      ? {
          id: loan.item.id,
          code: loan.item.itemCode,
          name: loan.item.name,
          nfcTagUid: loan.item.nfcTagUid ?? null
        }
      : null;
    const employeeSnapshot = {
      id: loan.employee.id,
      code: loan.employee.employeeCode,
      name: loan.employee.displayName,
      nfcTagUid: loan.employee.nfcTagUid ?? null
    };

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const loanResult = await tx.loan.update({
        where: { id: loan.id },
        data: {
          returnedAt: new Date(),
          clientId: resolvedClientId ?? loan.clientId,
          notes: input.note ?? loan.notes ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      // アイテムが関連付けられている場合のみ、ステータスを更新
      if (loan.itemId) {
        await tx.item.update({ where: { id: loan.itemId }, data: { status: ItemStatus.AVAILABLE } });
      }

      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.RETURN,
          actorEmployeeId: loan.employeeId,
          performedByUserId: finalPerformedByUserId,
          clientId: resolvedClientId ?? loan.clientId,
          details: {
            note: input.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return loanResult;
    });

    logger.info(
      {
        loanId: updatedLoan.id,
        itemId: updatedLoan.itemId,
        employeeId: updatedLoan.employeeId,
        clientId: resolvedClientId ?? loan.clientId,
        returnedAt: updatedLoan.returnedAt,
      },
      'Return completed successfully',
    );

    return updatedLoan as LoanWithRelations;
  }

  /**
   * 写真撮影持出処理
   * 
   * 従業員タグのみスキャンで撮影＋持出を記録する。
   * Item情報は保存せず、従業員IDと写真のみを保存する。
   */
  async photoBorrow(input: PhotoBorrowInput, resolvedClientId?: string): Promise<LoanWithRelations> {
    logger.info(
      {
        employeeTagUid: input.employeeTagUid,
        clientId: resolvedClientId,
      },
      'Photo borrow request started',
    );

    // 従業員を特定
    const employee = await this.employeeService.findByNfcTagUid(input.employeeTagUid);
    if (!employee) {
      logger.warn({ employeeTagUid: input.employeeTagUid }, 'Employee not found for photo borrow');
      throw new ApiError(404, '対象従業員が登録されていません');
    }

    // 画像データを処理（Base64エンコードされたJPEG画像データを受け取る）
    let photoPathInfo;
    try {
      // Base64エンコードされた画像データをBufferに変換
      const imageBuffer = Buffer.from(input.photoData, 'base64');
      
      // 画像をリサイズ・圧縮（800x600px、JPEG品質80%、100KB程度に圧縮）
      let originalImage = await sharp(imageBuffer)
        .resize(cameraConfig.resolution.width, cameraConfig.resolution.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: cameraConfig.quality })
        .toBuffer();

      // 100KB程度になるまで品質を下げる（最大5回試行）
      let quality = cameraConfig.quality;
      for (let i = 0; i < 5 && originalImage.length > 100 * 1024; i++) {
        quality = Math.max(50, quality - 10); // 最低50%まで
        originalImage = await sharp(imageBuffer)
          .resize(cameraConfig.resolution.width, cameraConfig.resolution.height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality })
          .toBuffer();
      }

      // フレームの平均輝度を確認し、極端に暗い画像は拒否する
      const stats = await sharp(originalImage).stats();
      const rgbChannels = stats.channels.filter((channel) =>
        ['red', 'green', 'blue'].includes(channel.name ?? channel.channel ?? ''),
      );
      const meanLuma =
        rgbChannels.reduce((sum, channel) => sum + channel.mean, 0) /
        (rgbChannels.length || 1);
      if (meanLuma < cameraConfig.brightness.minMeanLuma) {
        throw new ApiError(
          422,
          '写真が暗すぎます。照明環境を整えてからもう一度撮影してください。',
        );
      }

      // サムネイルを生成（150x150px、JPEG品質70%）
      const thumbnailImage = await sharp(originalImage)
        .resize(cameraConfig.thumbnail.width, cameraConfig.thumbnail.height, {
          fit: 'cover',
        })
        .jpeg({ quality: cameraConfig.thumbnail.quality })
        .toBuffer();
      
      // 写真を保存
      photoPathInfo = await PhotoStorage.savePhoto(
        employee.id,
        originalImage,
        thumbnailImage
      );

      logger.info(
        {
          employeeId: employee.id,
          photoUrl: photoPathInfo.relativePath,
          thumbnailUrl: photoPathInfo.thumbnailRelativePath,
          photoSize: originalImage.length,
          thumbnailSize: thumbnailImage.length,
        },
        'Photo processed and saved successfully',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ err, employeeTagUid: input.employeeTagUid }, 'Photo processing failed');
      throw new ApiError(500, `写真の処理に失敗しました: ${err.message}`);
    }

    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName,
      nfcTagUid: employee.nfcTagUid ?? null
    };

    // Loanレコードを作成（itemIdはNULL、photoUrlとphotoTakenAtを設定）
    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          itemId: null, // Item情報は保存しない
          employeeId: employee.id,
          clientId: resolvedClientId,
          photoUrl: photoPathInfo.relativePath,
          photoTakenAt: new Date(),
          notes: input.note ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      await tx.transaction.create({
        data: {
          loanId: createdLoan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: resolvedClientId,
          details: {
            note: input.note ?? null,
            employeeSnapshot,
            photoUrl: photoPathInfo.relativePath,
            photoTakenAt: createdLoan.photoTakenAt?.toISOString() ?? null
          }
        }
      });

      return createdLoan;
    });

    logger.info(
      {
        loanId: loan.id,
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        photoUrl: photoPathInfo.relativePath,
        clientId: resolvedClientId,
      },
      'Photo borrow completed successfully',
    );

    return loan as LoanWithRelations;
  }

  /**
   * アクティブな貸出一覧を取得
   * 返却済み・取消済みのLoanは除外する
   */
  async findActive(query: ActiveLoanQuery): Promise<LoanWithRelations[]> {
    const where = {
      returnedAt: null,
      cancelledAt: null, // 取消済みも除外（マイグレーション適用後に有効）
      ...(query.clientId ? { clientId: query.clientId } : {})
    };

    const loans = await prisma.loan.findMany({
      where,
      include: { item: true, employee: true, client: true },
      orderBy: { borrowedAt: 'desc' }
    });

    return loans as LoanWithRelations[];
  }

  /**
   * Loanを取消する（誤スキャン時の対処）
   * データは削除せず、cancelledAtフラグを設定してダッシュボードで除外可能にする
   */
  async cancel(
    loanId: string,
    resolvedClientId?: string,
    performedByUserId?: string
  ): Promise<LoanWithRelations> {
    logger.info(
      {
        loanId,
        clientId: resolvedClientId,
        performedByUserId,
      },
      'Loan cancel request started',
    );

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { item: true, employee: true }
    });

    if (!loan) {
      logger.warn({ loanId }, 'Loan not found for cancel');
      throw new ApiError(404, '貸出レコードが見つかりません');
    }

    // 既に返却済みの場合は取消できない
    if (loan.returnedAt) {
      logger.warn({ loanId, returnedAt: loan.returnedAt }, 'Cannot cancel returned loan');
      throw new ApiError(400, '返却済みの貸出記録は取消できません');
    }

    // 既に取消済みの場合はエラー
    if (loan.cancelledAt) {
      logger.warn({ loanId, cancelledAt: loan.cancelledAt }, 'Loan already cancelled');
      throw new ApiError(400, 'すでに取消済みです');
    }

    if (!loan.employee) {
      throw new ApiError(400, 'この貸出記録に関連する従業員が見つかりません');
    }

    const itemSnapshot = loan.item
      ? {
          id: loan.item.id,
          code: loan.item.itemCode,
          name: loan.item.name,
          nfcTagUid: loan.item.nfcTagUid ?? null
        }
      : null;
    const employeeSnapshot = {
      id: loan.employee.id,
      code: loan.employee.employeeCode,
      name: loan.employee.displayName,
      nfcTagUid: loan.employee.nfcTagUid ?? null
    };

    const updatedLoan = await prisma.$transaction(async (tx) => {
      // Loanを取消状態に更新
      const loanResult = await tx.loan.update({
        where: { id: loan.id },
        data: {
          cancelledAt: new Date(),
          clientId: resolvedClientId ?? loan.clientId,
        },
        include: { item: true, employee: true, client: true }
      });

      // アイテムが関連付けられている場合、ステータスをAVAILABLEに戻す
      if (loan.itemId) {
        await tx.item.update({ where: { id: loan.itemId }, data: { status: ItemStatus.AVAILABLE } });
      }

      // Transactionレコードを作成（取消履歴を記録）
      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.CANCEL,
          actorEmployeeId: loan.employeeId,
          performedByUserId: performedByUserId,
          clientId: resolvedClientId ?? loan.clientId,
          details: {
            itemSnapshot,
            employeeSnapshot,
            reason: '誤スキャンによる取消'
          }
        }
      });

      return loanResult;
    });

    logger.info(
      {
        loanId: updatedLoan.id,
        itemId: updatedLoan.itemId,
        employeeId: updatedLoan.employeeId,
        clientId: resolvedClientId ?? loan.clientId,
        cancelledAt: updatedLoan.cancelledAt,
      },
      'Loan cancelled successfully',
    );

    return updatedLoan as LoanWithRelations;
  }

  /**
   * Loanを削除する
   * 写真が関連付けられている場合は、写真ファイルも削除する
   */
  async delete(loanId: string): Promise<void> {
    logger.info({ loanId }, 'Loan delete request started');

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { item: true, employee: true }
    });

    if (!loan) {
      logger.warn({ loanId }, 'Loan not found for delete');
      throw new ApiError(404, '貸出レコードが見つかりません');
    }

    // 返却済みでない場合は削除できない
    if (!loan.returnedAt) {
      logger.warn({ loanId, returnedAt: loan.returnedAt }, 'Cannot delete active loan');
      throw new ApiError(400, '未返却の貸出記録は削除できません。先に返却してください。');
    }

    // 写真が関連付けられている場合は、写真ファイルも削除
    if (loan.photoUrl) {
      try {
        await PhotoStorage.deletePhoto(loan.photoUrl);
        logger.info({ loanId, photoUrl: loan.photoUrl }, 'Photo deleted successfully');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ err, loanId, photoUrl: loan.photoUrl }, 'Photo deletion failed');
        // 写真の削除に失敗してもLoanの削除は続行する（ログに記録）
      }
    }

    // Loanを削除（Transactionも自動的に削除される）
    await prisma.loan.delete({
      where: { id: loanId }
    });

    logger.info({ loanId }, 'Loan deleted successfully');
  }
}

