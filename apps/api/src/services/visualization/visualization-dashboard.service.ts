import type { Prisma, VisualizationDashboard } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type {
  VisualizationDashboardCreateInput,
  VisualizationDashboardQuery,
  VisualizationDashboardUpdateInput,
} from './visualization-dashboard.types.js';

export class VisualizationDashboardService {
  /**
   * 可視化ダッシュボード一覧を取得
   */
  async findAll(query: VisualizationDashboardQuery = {}): Promise<VisualizationDashboard[]> {
    const where: Prisma.VisualizationDashboardWhereInput = {
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return await prisma.visualizationDashboard.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * IDで可視化ダッシュボードを取得
   */
  async findById(id: string): Promise<VisualizationDashboard> {
    const dashboard = await prisma.visualizationDashboard.findUnique({ where: { id } });
    if (!dashboard) {
      throw new ApiError(404, '可視化ダッシュボードが見つかりません');
    }
    return dashboard;
  }

  /**
   * 可視化ダッシュボードを作成
   */
  async create(input: VisualizationDashboardCreateInput): Promise<VisualizationDashboard> {
    return await prisma.visualizationDashboard.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        dataSourceType: input.dataSourceType,
        rendererType: input.rendererType,
        dataSourceConfig: input.dataSourceConfig as Prisma.JsonObject,
        rendererConfig: input.rendererConfig as Prisma.JsonObject,
        enabled: input.enabled ?? true,
      },
    });
  }

  /**
   * 可視化ダッシュボードを更新
   */
  async update(id: string, input: VisualizationDashboardUpdateInput): Promise<VisualizationDashboard> {
    await this.findById(id);

    const updateData: Prisma.VisualizationDashboardUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.dataSourceType !== undefined) updateData.dataSourceType = input.dataSourceType;
    if (input.rendererType !== undefined) updateData.rendererType = input.rendererType;
    if (input.dataSourceConfig !== undefined)
      updateData.dataSourceConfig = input.dataSourceConfig as Prisma.JsonObject;
    if (input.rendererConfig !== undefined)
      updateData.rendererConfig = input.rendererConfig as Prisma.JsonObject;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;

    return await prisma.visualizationDashboard.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * 可視化ダッシュボードを削除
   */
  async delete(id: string): Promise<void> {
    await this.findById(id);
    await prisma.visualizationDashboard.delete({ where: { id } });
  }
}
