import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { env } from '../../config/env.js';
import {
  assertVisualCleanupToken,
  signVisualCleanupToken
} from './part-measurement-visual-cleanup-token.js';

describe('part-measurement-visual-cleanup-token', () => {
  it('accepts a token issued for the same visual template id', () => {
    const token = signVisualCleanupToken('11111111-1111-4111-8111-111111111111');
    expect(() =>
      assertVisualCleanupToken(token, '11111111-1111-4111-8111-111111111111')
    ).not.toThrow();
  });

  it('rejects token for a different visual template id', () => {
    const token = signVisualCleanupToken('11111111-1111-4111-8111-111111111111');
    expect(() =>
      assertVisualCleanupToken(token, '22222222-2222-4222-8222-222222222222')
    ).toThrow();
  });

  it('rejects expired token', () => {
    const token = jwt.sign(
      {
        purpose: 'part_measurement_visual_cleanup',
        visualTemplateId: '11111111-1111-4111-8111-111111111111'
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -1, subject: '11111111-1111-4111-8111-111111111111' }
    );
    expect(() =>
      assertVisualCleanupToken(token, '11111111-1111-4111-8111-111111111111')
    ).toThrow();
  });
});
