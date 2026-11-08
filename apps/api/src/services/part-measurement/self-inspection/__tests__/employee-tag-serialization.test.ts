import { describe, expect, it } from 'vitest';

import { serializeAssemblyWorkSessionApproval } from '../../../assembly/assembly-work-session-record-approval.service.js';
import {
  recordApprovalSessionInclude,
  serializeInspectorEntryMeta,
  serializeRecordApproval,
  serializeRecordApprovalEntryDetail,
  type RecordApprovalSessionSource
} from '../serialization.js';

const now = new Date('2026-01-01T00:00:00Z');
const approval = {
  id: 'approval-1', sessionId: 'session-1', approvedAt: now,
  approverEmployeeId: 'employee-1', approverEmployeeCodeSnapshot: '1001',
  approverEmployeeNameSnapshot: '承認者', approverNfcTagUidSnapshot: 'employee-tag-1',
  approverEmployeeNfcTagUidSnapshot: 'employee-tag-1', comment: null,
  clientDeviceId: null, clientDeviceNameSnapshot: null, createdAt: now, updatedAt: now
};
const inspectorEntry = {
  id: 'entry-1', entryIndex: 0, entrySlotKind: 'SINGLE' as const,
  inspectorEmployeeId: 'employee-2', inspectorEmployeeCodeSnapshot: '1002',
  inspectorEmployeeNameSnapshot: '検査員', inspectorEmployeeNfcTagUidSnapshot: 'employee-tag-2',
  measuringInstrumentId: null, measuringInstrumentManagementNumberSnapshot: null,
  measuringInstrumentNameSnapshot: null, measuringInstrumentTagUidSnapshot: null,
  clientDeviceId: null, clientDeviceNameSnapshot: null, instrumentUsages: [], values: [],
  createdAt: now, updatedAt: now
};

describe('employee tag response serialization', () => {
  it('omits the employee tag UID from assembly approval', () => {
    const result = serializeAssemblyWorkSessionApproval(approval);
    expect(result).toMatchObject({ approverEmployeeNameSnapshot: '承認者', approvedAt: now.toISOString() });
    expect(result).not.toHaveProperty('approverNfcTagUidSnapshot');
    expect(JSON.stringify(result)).not.toContain('employee-tag-1');
  });

  it('omits the employee tag UID from self-inspection approval', () => {
    const result = serializeRecordApproval(approval);
    expect(result).toMatchObject({ approverEmployeeNameSnapshot: '承認者', approvedAt: now.toISOString() });
    expect(result).not.toHaveProperty('approverEmployeeNfcTagUidSnapshot');
    expect(JSON.stringify(result)).not.toContain('employee-tag-1');
  });

  it('omits the employee tag UID from inspector entry metadata', () => {
    const result = serializeInspectorEntryMeta(inspectorEntry);
    expect(result).toMatchObject({ inspectorEmployeeNameSnapshot: '検査員', id: 'entry-1' });
    expect(result).not.toHaveProperty('inspectorEmployeeNfcTagUidSnapshot');
    expect(JSON.stringify(result)).not.toContain('employee-tag-2');
  });

  it('omits the employee tag UID from record approval entry detail', () => {
    const session = {
      template: { items: [] }, entries: [], inspectorEntries: [inspectorEntry]
    } as unknown as RecordApprovalSessionSource;
    const result = serializeRecordApprovalEntryDetail(
      session, { entryIndex: 0, entrySlotKind: 'single', entrySlotLabel: '1' },
      { requireMeasuringInstrumentTag: false }
    );
    expect(result.inspectorEntry).toMatchObject({ inspectorEmployeeNameSnapshot: '検査員', id: 'entry-1' });
    expect(result.inspectorEntry).not.toHaveProperty('inspectorEmployeeNfcTagUidSnapshot');
    expect(JSON.stringify(result)).not.toContain('employee-tag-2');
    expect(recordApprovalSessionInclude.inspectorEntries.select).not.toHaveProperty('inspectorEmployeeNfcTagUidSnapshot');
  });

  it('keeps absent approvals null', () => {
    expect(serializeAssemblyWorkSessionApproval(null)).toBeNull();
    expect(serializeRecordApproval(null)).toBeNull();
  });
});
