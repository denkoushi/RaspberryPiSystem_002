import type { PrismaClient, RiggingGear } from '@prisma/client';

export type RiggingGearResolveInput = {
  managementNumber?: string | null;
  idNum?: string | null;
};

export class RiggingGearResolver {
  constructor(private readonly client: PrismaClient) {}

  async resolve(input: RiggingGearResolveInput): Promise<RiggingGear | null> {
    const managementNumber = String(input.managementNumber ?? '').trim();
    if (managementNumber) {
      const byManagementNumber = await this.client.riggingGear.findUnique({
        where: { managementNumber },
      });
      if (byManagementNumber) {
        return byManagementNumber;
      }
    }

    const idNum = String(input.idNum ?? '').trim();
    if (!idNum) {
      return null;
    }

    return this.client.riggingGear.findFirst({
      where: { idNum },
    });
  }
}
