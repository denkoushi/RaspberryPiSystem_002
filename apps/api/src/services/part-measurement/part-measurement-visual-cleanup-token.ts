import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';

const CLEANUP_TOKEN_PURPOSE = 'part_measurement_visual_cleanup';
const CLEANUP_TOKEN_TTL = '30m';

type VisualCleanupTokenPayload = {
  purpose: string;
  visualTemplateId: string;
};

export function signVisualCleanupToken(visualTemplateId: string): string {
  return jwt.sign(
    { purpose: CLEANUP_TOKEN_PURPOSE, visualTemplateId } satisfies VisualCleanupTokenPayload,
    env.JWT_ACCESS_SECRET,
    { expiresIn: CLEANUP_TOKEN_TTL, subject: visualTemplateId }
  );
}

export function assertVisualCleanupToken(token: string, visualTemplateId: string): void {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as VisualCleanupTokenPayload & {
      sub?: string;
    };
    if (payload.purpose !== CLEANUP_TOKEN_PURPOSE) {
      throw new Error('invalid purpose');
    }
    if (payload.visualTemplateId !== visualTemplateId || payload.sub !== visualTemplateId) {
      throw new Error('id mismatch');
    }
  } catch {
    throw new ApiError(
      403,
      '図面回収トークンが無効です。',
      undefined,
      'VISUAL_CLEANUP_TOKEN_INVALID'
    );
  }
}
