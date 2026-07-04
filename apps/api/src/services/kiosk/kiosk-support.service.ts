import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { findClientDeviceByApiKey } from '../clients/client-device-auth.service.js';

export { findClientDeviceByApiKey };

export type RecordKioskSupportMessageParams = {
  clientId: string;
  userMessage: string;
  page: string;
  clientDeviceId: string;
  clientName: string;
  location: string;
};

export async function recordKioskSupportMessage(
  params: RecordKioskSupportMessageParams
): Promise<void> {
  const logMessage = `[SUPPORT] ${params.userMessage}`;
  await prisma.clientLog.create({
    data: {
      clientId: params.clientId,
      level: 'INFO',
      message: logMessage.slice(0, 1000),
      context: {
        kind: 'kiosk-support',
        page: params.page,
        clientId: params.clientId,
        clientDeviceId: params.clientDeviceId,
        clientName: params.clientName,
        location: params.location,
        userMessage: params.userMessage
      } as Prisma.InputJsonValue
    }
  });
}
