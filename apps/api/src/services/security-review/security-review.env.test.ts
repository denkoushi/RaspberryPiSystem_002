import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { securityReviewEnvShape } from '../../config/env/security-review.js';

describe('Security review settings', () => {
  const schema = z.object(securityReviewEnvShape);
  it('defaults off with the configured morning window and private mount', () => {
    expect(schema.parse({})).toEqual({ SECURITY_REVIEW_NIGHTLY_ENABLED: 'false',
      SECURITY_REVIEW_DATA_DIR: '/app/storage/security-review', SECURITY_REVIEW_NIGHTLY_CRON: '0 6 * * *', SECURITY_REVIEW_RETRY_UNTIL: '06:55',
      SECURITY_REVIEW_QUEUE_ENABLED: 'false', SECURITY_REVIEW_QUEUE_CRON: '*/10 * * * *', SECURITY_REVIEW_QUEUE_QUIET: '05:50-07:00' });
  });
  it('rejects invalid cron, cutoff and empty data paths', () => {
    for (const settings of [{ SECURITY_REVIEW_NIGHTLY_CRON: 'bad' }, { SECURITY_REVIEW_RETRY_UNTIL: '25:01' }, { SECURITY_REVIEW_DATA_DIR: ' ' },
      { SECURITY_REVIEW_QUEUE_ENABLED: 'yes' }, { SECURITY_REVIEW_QUEUE_CRON: 'bad' }, { SECURITY_REVIEW_QUEUE_QUIET: '25:00-07:00' },
      { SECURITY_REVIEW_QUEUE_QUIET: '05:50-07:60' }, { SECURITY_REVIEW_QUEUE_QUIET: '05:50' }]) {
      expect(schema.safeParse(settings).success).toBe(false);
    }
  });
  it('accepts queue settings and a quiet interval crossing midnight', () => {
    expect(schema.parse({ SECURITY_REVIEW_QUEUE_ENABLED: 'true', SECURITY_REVIEW_QUEUE_CRON: '*/5 * * * *',
      SECURITY_REVIEW_QUEUE_QUIET: '23:30-01:00' })).toMatchObject({ SECURITY_REVIEW_QUEUE_ENABLED: 'true',
      SECURITY_REVIEW_QUEUE_CRON: '*/5 * * * *', SECURITY_REVIEW_QUEUE_QUIET: '23:30-01:00' });
  });
});
