import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import {
  assertSelfInspectionResetConfirmation,
  buildRestartPayloadFromSessionSnapshot,
  resolveExpectedEntryCountForReset,
  templateConfigFromTemplateForReset
} from '../self-inspection-reset-preflight.js';

describe('assertSelfInspectionResetConfirmation', () => {
  it('requires destructive confirmation', () => {
    expect(() =>
      assertSelfInspectionResetConfirmation({
        confirmDestructiveReset: false,
        confirmCompletedSessionReset: false,
        completedAt: null
      })
    ).toThrow(ApiError);
  });

  it('requires completed confirmation when session was completed', () => {
    expect(() =>
      assertSelfInspectionResetConfirmation({
        confirmDestructiveReset: true,
        confirmCompletedSessionReset: false,
        completedAt: new Date()
      })
    ).toThrow(ApiError);
  });

  it('allows in-progress reset with destructive confirmation only', () => {
    expect(() =>
      assertSelfInspectionResetConfirmation({
        confirmDestructiveReset: true,
        confirmCompletedSessionReset: false,
        completedAt: null
      })
    ).not.toThrow();
  });
});

describe('buildRestartPayloadFromSessionSnapshot', () => {
  it('builds restart payload with latest template id', () => {
    const payload = buildRestartPayloadFromSessionSnapshot({
      session: {
        productNo: ' PO-1 ',
        processGroup: 'CUTTING',
        resourceCd: ' R1 ',
        scheduleRowId: 'row-1',
        fseiban: ' S1 ',
        fhincd: ' H1 ',
        fhinmei: ' Name ',
        machineName: ' MC-1 '
      },
      activeTemplateId: 'template-new',
      plannedQuantity: 10,
      expectedEntryCount: 10
    });
    expect(payload).toMatchObject({
      templateId: 'template-new',
      productNo: 'PO-1',
      resourceCd: 'R1',
      scheduleRowId: 'row-1',
      fseiban: 'S1',
      fhincd: 'H1',
      fhinmei: 'Name',
      machineName: 'MC-1',
      plannedQuantity: 10,
      expectedEntryCount: 10
    });
  });
});

describe('resolveExpectedEntryCountForReset', () => {
  it('throws when expected entry count cannot be resolved', () => {
    expect(() =>
      resolveExpectedEntryCountForReset(
        templateConfigFromTemplateForReset({
          selfInspectionMode: 'FIRST_LAST',
          selfInspectionFixedCount: null
        }),
        1
      )
    ).toThrow(ApiError);
  });
});
