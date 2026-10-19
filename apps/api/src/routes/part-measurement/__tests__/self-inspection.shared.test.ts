import { describe, expect, it } from 'vitest';

import {
  listSelfInspectionRecordApprovalsQuerySchema,
  selfInspectionRegistrationPolicyBodySchema
} from '../shared.js';

describe('self-inspection route schemas', () => {
  it('accepts the completed-record scope and rejects state with scope', () => {
    expect(
      listSelfInspectionRecordApprovalsQuerySchema.parse({ scope: 'completed_records' })
    ).toEqual({ scope: 'completed_records' });
    expect(() =>
      listSelfInspectionRecordApprovalsQuerySchema.parse({
        scope: 'completed_records',
        state: 'active'
      })
    ).toThrow();
  });

  it('accepts an optional registration policy access password', () => {
    expect(
      selfInspectionRegistrationPolicyBodySchema.parse({
        requireMeasuringInstrumentTag: true,
        accessPassword: 'shared-password'
      })
    ).toEqual({
      requireMeasuringInstrumentTag: true,
      accessPassword: 'shared-password'
    });
    expect(
      selfInspectionRegistrationPolicyBodySchema.parse({
        requireMeasuringInstrumentTag: false
      })
    ).toEqual({ requireMeasuringInstrumentTag: false });
  });
});
