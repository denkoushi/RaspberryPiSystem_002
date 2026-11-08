import { beforeEach, describe, expect, it, vi } from 'vitest';

import { approveAssemblyWorkSessionRecordApproval, verifyKioskAssemblyRecordApprovalAccessPassword } from './assembly/work-sessions';
import { approveSelfInspectionRecordApproval, verifyKioskSelfInspectionRecordApprovalAccessPassword } from './part-measurement';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../http', () => ({ api: mocks }));
beforeEach(() => { vi.clearAllMocks(); });
describe.each([
  { name: 'assembly', verify: verifyKioskAssemblyRecordApprovalAccessPassword, approve: approveAssemblyWorkSessionRecordApproval,
    verifyUrl: '/kiosk/assembly/record-approvals/verify-access-password', approveUrl: '/assembly/work-sessions/session/record-approval/approve' },
  { name: 'self-inspection', verify: verifyKioskSelfInspectionRecordApprovalAccessPassword, approve: approveSelfInspectionRecordApproval,
    verifyUrl: '/kiosk/part-measurement/self-inspection/record-approvals/verify-access-password', approveUrl: '/part-measurement/self-inspection/sessions/session/record-approval/approve' }
])('$name approval access contract', ({ verify, approve, verifyUrl, approveUrl }) => {
  it('returns the password confirmation token', async () => {
    mocks.post.mockResolvedValue({ data: { success: true, token: 'confirmation' } });
    expect(await verify({ password: '2520' })).toEqual({ success: true, token: 'confirmation' });
    expect(mocks.post).toHaveBeenCalledWith(verifyUrl, { password: '2520' });
  });
  it('sends the token in the approval body', async () => {
    mocks.post.mockResolvedValue({ data: { session: { id: 'session' } } });
    await approve('session', { approverEmployeeTagUid: 'employee', accessToken: 'confirmation' });
    expect(mocks.post).toHaveBeenCalledWith(approveUrl, { approverEmployeeTagUid: 'employee', accessToken: 'confirmation' });
  });
});
