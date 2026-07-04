import type { RiggingGearTag } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export class RiggingGearTagService {
  async replaceTagForGear(riggingGearId: string, rfidTagUid: string): Promise<RiggingGearTag> {
    await prisma.riggingGearTag.deleteMany({ where: { riggingGearId } });
    return prisma.riggingGearTag.create({
      data: { riggingGearId, rfidTagUid }
    });
  }

  async deleteTag(tagId: string): Promise<RiggingGearTag> {
    return prisma.riggingGearTag.delete({ where: { id: tagId } });
  }
}
