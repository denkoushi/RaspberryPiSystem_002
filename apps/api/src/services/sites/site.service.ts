import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { invalidateSiteDirectory } from '../../lib/site-directory.js';

/** 拠点キーに含めると location 由来の推測（`拠点 - 端末`）と紛らわしくなる区切り */
const SITE_KEY_FORBIDDEN_SEGMENT = ' - ';

export type SiteDto = { key: string; displayName: string; sortOrder: number };

export async function listSites(): Promise<SiteDto[]> {
  return prisma.site.findMany({
    orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    select: { key: true, displayName: true, sortOrder: true }
  });
}

export async function createSite(params: { key: string; displayName?: string; sortOrder?: number }): Promise<SiteDto> {
  const key = params.key.trim();
  if (!key) {
    throw new ApiError(400, '拠点名を入力してください', undefined, 'SITE_KEY_REQUIRED');
  }
  if (key.includes(SITE_KEY_FORBIDDEN_SEGMENT)) {
    throw new ApiError(400, '拠点名に「 - 」は使えません', undefined, 'SITE_KEY_INVALID');
  }
  const displayName = params.displayName?.trim() || key;
  try {
    const site = await prisma.site.create({
      data: { key, displayName, sortOrder: params.sortOrder ?? 0 },
      select: { key: true, displayName: true, sortOrder: true }
    });
    invalidateSiteDirectory();
    return site;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'その拠点は既に登録されています', undefined, 'SITE_ALREADY_EXISTS');
    }
    throw error;
  }
}
