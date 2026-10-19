import bcrypt from 'bcryptjs';

import { prisma } from '../lib/prisma.js';
import { SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION } from '../services/production-schedule/production-schedule-settings.service.js';

export const configureTestDueManagementAccessPassword = async (
  password = '2520'
): Promise<void> => {
  const dueManagementPasswordHash = await bcrypt.hash(password, 4);
  await prisma.productionScheduleAccessPasswordConfig.upsert({
    where: { location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION },
    create: {
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      dueManagementPasswordHash,
    },
    update: { dueManagementPasswordHash },
  });
};
