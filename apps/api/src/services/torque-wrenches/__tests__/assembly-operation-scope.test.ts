import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyTorqueTraceabilityService } from '../assembly-torque-traceability.service.js';
import { TorqueWrenchConnectionLeaseService } from '../torque-wrench-connection-lease.service.js';
import { TorqueWrenchUsageLeaseCoordinator } from '../torque-wrench-usage-lease.coordinator.js';
import { TorqueWrenchEligibilityPolicy, torqueConditionFingerprint } from '../torque-wrench-eligibility.policy.js';
import { TorqueWrenchConfirmationUsePolicy } from '../torque-wrench-confirmation-use.policy.js';
import { conditionFromBolt } from '../torque-wrench-use-context.js';
import { AssemblyOperatorAccessService } from '../../assembly/assembly-operator-access.service.js';
import type { AssemblyTemplateBolt } from '@prisma/client';
import type { ClientDeviceOperationActor } from '../../clients/client-device-resolution.service.js';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    assemblyWorkSession: { findUnique: vi.fn(), update: vi.fn() },
    assemblyWorkSessionOperatorAccess: { findUnique: vi.fn(), create: vi.fn() },
    assemblyTorqueAgentEvent: { findUnique: vi.fn(), create: vi.fn() },
    assemblyTorqueWrenchConfirmation: { findUnique: vi.fn(), create: vi.fn() },
    assemblyTorqueRecord: { create: vi.fn() },
    assemblyTemplateBolt: { findUnique: vi.fn() },
    torqueWrenchProfile: { findUnique: vi.fn() },
    torqueWrenchCapabilityGroup: { findUnique: vi.fn() },
    torqueWrenchUsageLease: { findUnique: vi.fn() }
  };
  return { tx, transaction: vi.fn() };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: { ...mocks.tx, $transaction: mocks.transaction } }));
vi.mock('../../assembly/assembly-operator-nfc-resolve.service.js', () => ({
  resolveActiveAssemblyOperatorNfcUid: vi.fn(async () => ({ employeeId: 'employee', displayName: 'operator', nfcTagUid: 'tag' }))
}));

const bolt = { id: 'bolt', capabilityGroupId: 'group', sortOrder: 0, lowerLimit: 28, nominalTorque: 30, upperLimit: 32, unit: 'N-m' } as unknown as AssemblyTemplateBolt;
const profile = { id: 'profile', serialNumber: 'SERIAL', serialNumberKey: 'SERIAL', modelId: 'model', model: { settingVerificationMode: 'BOLT_CONDITION_ONLY' },
  settingHistories: [], measuringInstrument: {}, connectionLeaseEnforcedAt: null };
let owner: string;
let traceability: AssemblyTorqueTraceabilityService;
let leases: TorqueWrenchConnectionLeaseService;
const session = () => ({ id: 'session', clientDeviceId: owner, status: 'IN_PROGRESS', currentBoltId: 'bolt', torqueRecords: [],
  template: { traceabilityMode: 'REQUIRED', areas: [{ id: 'area', sortOrder: 0, bolts: [bolt] }] } });
const input = { sessionId: 'session', clientDeviceId: 'device', clientDeviceName: 'terminal', expectedTemplateBoltId: 'bolt',
  torqueWrenchProfileId: 'profile', physicalDisplayConfirmed: true, confirmationId: 'confirmation', requestId: 'request',
  sourceEventKey: 'event', serialNumber: 'SERIAL', value: 30, unit: 'N-m', connectionLeaseId: 'lease', connectionLeaseGeneration: 1 };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  owner = 'device';
  mocks.transaction.mockImplementation((fn) => fn(mocks.tx));
  mocks.tx.$queryRaw.mockResolvedValue([{ id: 'session' }]);
  mocks.tx.assemblyWorkSession.findUnique.mockImplementation(async () => session());
  mocks.tx.assemblyWorkSession.update.mockImplementation(async ({ data }) => { if (data.clientDeviceId) owner = data.clientDeviceId; return session(); });
  mocks.tx.assemblyWorkSessionOperatorAccess.create.mockResolvedValue({ employeeId: 'employee', employeeNameSnapshot: 'operator' });
  mocks.tx.torqueWrenchProfile.findUnique.mockResolvedValue(profile);
  mocks.tx.torqueWrenchCapabilityGroup.findUnique.mockResolvedValue({ id: 'group', models: [] });
  mocks.tx.assemblyTemplateBolt.findUnique.mockResolvedValue(bolt);
  mocks.tx.assemblyTorqueWrenchConfirmation.findUnique.mockResolvedValue({ id: 'confirmation', sessionId: 'session', clientDeviceId: 'device', torqueWrenchProfileId: 'profile',
    settingVerificationMode: 'BOLT_CONDITION_ONLY', conditionFingerprint: torqueConditionFingerprint(conditionFromBolt(bolt)) });
  mocks.tx.assemblyTorqueWrenchConfirmation.create.mockResolvedValue({ id: 'confirmation', settingHistoryId: null });
  mocks.tx.assemblyTorqueRecord.create.mockResolvedValue({ id: 'record' });
  const eligibility = new TorqueWrenchEligibilityPolicy();
  vi.spyOn(eligibility, 'evaluate').mockReturnValue({ eligible: true, conditionFingerprint: 'fingerprint' });
  const policy = new TorqueWrenchConfirmationUsePolicy();
  vi.spyOn(policy, 'evaluateLeaseAdoption').mockReturnValue({ allowed: true, mode: 'current_session' });
  vi.spyOn(policy, 'evaluateAgentLease').mockReturnValue({ allowed: true, mode: 'lease' });
  traceability = new AssemblyTorqueTraceabilityService(eligibility, policy);
  leases = new TorqueWrenchConnectionLeaseService(policy, undefined, eligibility);
  vi.spyOn(TorqueWrenchUsageLeaseCoordinator.prototype, 'acquire').mockImplementation(async (tx, value, adapter) => {
    await adapter.validateAcquire(tx, value, new Date());
    return { leaseId: 'lease' } as never;
  });
});
const actions = ['confirm', 'acquire', 'takeover', 'recordAgent'] as const;
function run(action: typeof actions[number], actorDevice?: ClientDeviceOperationActor | null) {
  const args = { ...input, actorDevice, physicalWrenchPresent: true, reason: 'handoff' };
  if (action === 'confirm' || action === 'recordAgent') return traceability[action](args);
  return leases[action](args);
}
describe.each(actions)('%s assigned terminal', (action) => {
  it('accepts the assigned terminal', async () => {
    const result = await run(action);
    expect(result).toBeDefined();
    if (action === 'recordAgent') expect(result).toMatchObject({ outcome: { kind: 'accepted_ok' } });
  });
  it('rejects another terminal before recording or adopting a confirmation', async () => {
    owner = 'other';
    await expect(run(action)).rejects.toMatchObject({ statusCode: 403, code: 'CLIENT_DEVICE_SCOPE_MISMATCH' });
    expect(mocks.tx.assemblyTorqueRecord.create).not.toHaveBeenCalled();
    expect(mocks.tx.assemblyTorqueWrenchConfirmation.create).not.toHaveBeenCalled();
  });
  it.each([{ id: 'device', canProxyOtherDevices: true }, null])('accepts the existing actor exception: %j', async (actor) => {
    owner = 'other';
    await expect(run(action, actor)).resolves.toBeDefined();
  });
  it('accepts the resumed terminal after a formal handoff', async () => {
    owner = 'other';
    await new AssemblyOperatorAccessService().recordResume({ sessionId: 'session', operatorNfcTagUid: 'tag', requestId: 'resume',
      actor: { clientDeviceId: 'device', clientDeviceNameSnapshot: 'terminal' } });
    expect(owner).toBe('device');
    const result = await run(action);
    expect(result).toBeDefined();
    if (action === 'recordAgent') expect(result).toMatchObject({ outcome: { kind: 'accepted_ok' } });
  });
});
