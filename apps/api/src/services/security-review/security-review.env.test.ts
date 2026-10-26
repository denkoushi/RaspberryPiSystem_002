import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { securityReviewEnvShape } from '../../config/env/security-review.js';

describe('Security review settings', () => {
  const schema = z.object(securityReviewEnvShape);
  it('defaults off with the configured morning window and private mount', () => {
    expect(schema.parse({})).toEqual({ SECURITY_REVIEW_NIGHTLY_ENABLED: 'false',
      SECURITY_REVIEW_DATA_DIR: '/app/storage/security-review', SECURITY_REVIEW_NIGHTLY_CRON: '0 6 * * *', SECURITY_REVIEW_RETRY_UNTIL: '06:55' });
  });
  it('rejects invalid cron, cutoff and empty data paths', () => {
    for (const settings of [{ SECURITY_REVIEW_NIGHTLY_CRON: 'bad' }, { SECURITY_REVIEW_RETRY_UNTIL: '25:01' }, { SECURITY_REVIEW_DATA_DIR: ' ' }]) {
      expect(schema.safeParse(settings).success).toBe(false);
    }
  });
});
