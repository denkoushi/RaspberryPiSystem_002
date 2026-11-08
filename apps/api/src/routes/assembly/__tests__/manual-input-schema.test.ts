import { describe, expect, it } from 'vitest';
import { recordTorqueBodySchema } from '../schemas.js';

describe('manual torque input', () => {
  it('defaults the input source to manual', () => {
    expect(recordTorqueBodySchema.parse({ value: 12 })).toEqual({ value: 12, source: 'manual' });
  });
  it.each(['manual', 'mock'])('keeps a source the kiosk screen offers (%s)', source => {
    expect(recordTorqueBodySchema.parse({ value: 12, source })).toEqual({ value: 12, source });
  });
  it('rejects the agent source on the manual route', () => {
    expect(recordTorqueBodySchema.safeParse({ value: 12, source: 'agent' }).success).toBe(false);
  });
});
