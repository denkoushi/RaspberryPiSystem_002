import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  TorqueTrainingCatalogRegistrationService,
  isTorqueWrenchModelInStandardRange
} from './torque-training-catalog-registration.service.js';

type FakeModel = {
  id: string;
  torqueMinNm: number;
  torqueMaxNm: number;
  isActive: boolean;
};

type FakeProfile = {
  id: string;
  serialNumber: string;
  serialNumberKey: string;
  modelId: string;
  model: FakeModel;
};

type FakeGroup = {
  id: string;
  name: string;
  nominalDiameter: string;
  boltLengthMm: number;
  material: string;
  strengthClass: string;
  isActive: boolean;
};

type FakeVersion = {
  id: string;
  programId: string;
  version: number;
  nominalDiameter: string;
  conditionFingerprint: string;
  wrenches: Array<{ torqueWrenchProfileId: string }>;
};

type FakeProgram = {
  id: string;
  code: string;
  currentVersion: number;
  isActive: boolean;
  versions: FakeVersion[];
};

type FakeState = {
  nextId: number;
  groups: FakeGroup[];
  programs: FakeProgram[];
  profiles: FakeProfile[];
  capabilityLinks: Array<{ capabilityGroupId: string; modelId: string }>;
};

function cloneState(state: FakeState): FakeState {
  return {
    nextId: state.nextId,
    groups: state.groups.map((group) => ({ ...group })),
    programs: state.programs.map((program) => ({
      ...program,
      versions: program.versions.map((version) => ({
        ...version,
        wrenches: version.wrenches.map((wrench) => ({ ...wrench }))
      }))
    })),
    profiles: state.profiles.map((profile) => ({ ...profile, model: { ...profile.model } })),
    capabilityLinks: state.capabilityLinks.map((link) => ({ ...link }))
  };
}

function createState(): FakeState {
  return { nextId: 1, groups: [], programs: [], profiles: [], capabilityLinks: [] };
}

class FakeCatalogDatabase {
  state: FakeState;

  constructor(state = createState()) {
    this.state = state;
  }

  private id(prefix: string): string {
    const value = `${prefix}-${this.state.nextId}`;
    this.state.nextId += 1;
    return value;
  }

  private transactionClient(state: FakeState) {
    const id = (prefix: string) => {
      const value = `${prefix}-${state.nextId}`;
      state.nextId += 1;
      return value;
    };
    const findProgram = (code: string) => state.programs.find((program) => program.code === code) ?? null;
    const findVersion = (programId: string, version: number) =>
      state.programs.find((program) => program.id === programId)?.versions.find((entry) => entry.version === version) ?? null;
    const profileWithModel = (profile: FakeProfile) => ({
      id: profile.id,
      serialNumber: profile.serialNumber,
      serialNumberKey: profile.serialNumberKey,
      modelId: profile.modelId,
      model: { ...profile.model }
    });

    return {
      torqueWrenchProfile: {
        findMany: async ({ where }: { where: { serialNumberKey: { in: string[] } } }) =>
          state.profiles.filter((profile) => where.serialNumberKey.in.includes(profile.serialNumberKey)).map(profileWithModel)
      },
      torqueWrenchCapabilityGroup: {
        findUnique: async ({ where }: { where: { name: string } }) =>
          state.groups.find((group) => group.name === where.name) ?? null,
        create: async ({ data }: { data: Omit<FakeGroup, 'id'> }) => {
          const group = { ...data, id: id('group') };
          state.groups.push(group);
          return group;
        }
      },
      torqueWrenchCapabilityGroupModel: {
        findUnique: async ({ where }: { where: { capabilityGroupId_modelId: { capabilityGroupId: string; modelId: string } } }) =>
          state.capabilityLinks.find(
            (link) =>
              link.capabilityGroupId === where.capabilityGroupId_modelId.capabilityGroupId &&
              link.modelId === where.capabilityGroupId_modelId.modelId
          ) ?? null,
        create: async ({ data }: { data: { capabilityGroupId: string; modelId: string } }) => {
          state.capabilityLinks.push(data);
          return data;
        }
      },
      torqueTrainingProgram: {
        findUnique: async ({ where }: { where: { code?: string; id?: string }; select?: unknown }) =>
          state.programs.find((program) => (where.code ? program.code === where.code : program.id === where.id))
            ? {
                id: (state.programs.find((program) => (where.code ? program.code === where.code : program.id === where.id)) as FakeProgram).id,
                currentVersion: (state.programs.find((program) => (where.code ? program.code === where.code : program.id === where.id)) as FakeProgram).currentVersion,
                isActive: (state.programs.find((program) => (where.code ? program.code === where.code : program.id === where.id)) as FakeProgram).isActive
              }
            : null,
        create: async ({ data }: { data: { code: string; currentVersion: number; versions: { create: FakeVersion & { displayName?: string } } }; select?: unknown }) => {
          const program: FakeProgram = {
            id: id('program'),
            code: data.code,
            currentVersion: data.currentVersion,
            isActive: true,
            versions: [
              {
                id: id('version'),
                programId: '',
                version: data.versions.create.version,
                nominalDiameter: data.versions.create.nominalDiameter,
                conditionFingerprint: data.versions.create.conditionFingerprint,
                wrenches: data.versions.create.wrenches.create
              }
            ]
          };
          program.versions[0]!.programId = program.id;
          state.programs.push(program);
          return { id: program.id };
        },
        update: async ({ where, data }: { where: { id: string }; data: { currentVersion?: number; isActive?: boolean } }) => {
          const program = state.programs.find((entry) => entry.id === where.id)!;
          Object.assign(program, data);
          return program;
        }
      },
      torqueTrainingProgramVersion: {
        findUnique: async ({ where }: { where: { programId_version: { programId: string; version: number } } }) => {
          const version = findVersion(where.programId_version.programId, where.programId_version.version);
          if (!version) return null;
          return {
            ...version,
            wrenches: version.wrenches.map((wrench) => ({
              torqueWrenchProfileId: wrench.torqueWrenchProfileId,
              torqueWrenchProfile: profileWithModel(state.profiles.find((profile) => profile.id === wrench.torqueWrenchProfileId)!)
            }))
          };
        },
        create: async ({ data }: { data: FakeVersion & { programId: string; wrenches: { create: Array<{ torqueWrenchProfileId: string }> } } }) => {
          const version: FakeVersion = {
            id: id('version'),
            programId: data.programId,
            version: data.version,
            nominalDiameter: data.nominalDiameter,
            conditionFingerprint: data.conditionFingerprint,
            wrenches: data.wrenches.create
          };
          state.programs.find((program) => program.id === data.programId)!.versions.push(version);
          return { id: version.id };
        }
      }
    };
  }

  async $transaction<T>(work: (tx: never) => Promise<T>): Promise<T> {
    const next = cloneState(this.state);
    const result = await work(this.transactionClient(next) as never);
    this.state = next;
    return result;
  }

  addProfile(profile: Omit<FakeProfile, 'id'>): string {
    const id = this.id('profile');
    this.state.profiles.push({ ...profile, id });
    return id;
  }

  addLegacyProgram(code: string, nominalDiameter = 'M5'): void {
    const programId = this.id('legacy-program');
    this.state.programs.push({
      id: programId,
      code,
      currentVersion: 1,
      isActive: true,
      versions: [
        {
          id: this.id('legacy-version'),
          programId,
          version: 1,
          nominalDiameter,
          conditionFingerprint: 'legacy-fingerprint',
          wrenches: []
        }
      ]
    });
  }
}

const wideModel = (id: string): FakeModel => ({ id, torqueMinNm: 0, torqueMaxNm: 100, isActive: true });

describe('torque training catalogue registration', () => {
  it('keeps dry-run read-only and plans all 14 menus', async () => {
    const db = new FakeCatalogDatabase();
    const result = await new TorqueTrainingCatalogRegistrationService(db).register({ dryRun: true });

    expect(result.summary).toMatchObject({ totalMenus: 14, created: 14, revised: 0, skipped: 0 });
    expect(db.state.groups).toHaveLength(0);
    expect(db.state.programs).toHaveLength(0);
  });

  it('creates 14 menus once and skips the same condition on rerun', async () => {
    const db = new FakeCatalogDatabase();
    const service = new TorqueTrainingCatalogRegistrationService(db);

    const first = await service.register();
    const second = await service.register();

    expect(first.summary).toMatchObject({ totalMenus: 14, created: 14, revised: 0, skipped: 0 });
    expect(second.summary).toMatchObject({ totalMenus: 14, created: 0, revised: 0, skipped: 14 });
    expect(db.state.groups).toHaveLength(14);
    expect(db.state.programs).toHaveLength(14);
    expect(db.state.programs.flatMap((program) => program.versions)).toHaveLength(14);
  });

  it('assigns only models whose full range contains the menu limits', async () => {
    const db = new FakeCatalogDatabase();
    db.addProfile({
      serialNumber: 'WIDE',
      serialNumberKey: 'WIDE',
      modelId: 'wide-model',
      model: wideModel('wide-model')
    });
    db.addProfile({
      serialNumber: 'NARROW',
      serialNumberKey: 'NARROW',
      modelId: 'narrow-model',
      model: { id: 'narrow-model', torqueMinNm: 0, torqueMaxNm: 1, isActive: true }
    });

    const result = await new TorqueTrainingCatalogRegistrationService(db).register({
      wrenchSerialNumbers: ['WIDE', 'NARROW']
    });

    const m2 = result.menus.find((menu) => menu.code === 'TT-020-CS-2D')!;
    const m8 = result.menus.find((menu) => menu.code === 'TT-080-CS-2D')!;
    expect(m2.assignedSerialNumbers).toEqual(['WIDE', 'NARROW']);
    expect(m8.assignedSerialNumbers).toEqual(['WIDE']);
    expect(m8.unassignedSerialNumbers).toEqual([
      { serialNumber: 'NARROW', reason: 'MODEL_TORQUE_RANGE_OUT_OF_BOUNDS' }
    ]);
    expect(isTorqueWrenchModelInStandardRange({ torqueMinNm: 0, torqueMaxNm: 1 }, { lowerLimit: '0.43', upperLimit: '0.58' })).toBe(true);
    expect(isTorqueWrenchModelInStandardRange({ torqueMinNm: 0, torqueMaxNm: 1 }, { lowerLimit: '25', upperLimit: '33' })).toBe(false);
  });

  it('creates a new immutable version when explicit assignment changes', async () => {
    const db = new FakeCatalogDatabase();
    db.addProfile({ serialNumber: 'WIDE', serialNumberKey: 'WIDE', modelId: 'wide-model', model: wideModel('wide-model') });
    db.addProfile({ serialNumber: 'SECOND', serialNumberKey: 'SECOND', modelId: 'second-model', model: wideModel('second-model') });
    const service = new TorqueTrainingCatalogRegistrationService(db);

    await service.register({ wrenchSerialNumbers: ['WIDE'] });
    const changed = await service.register({ wrenchSerialNumbers: ['SECOND'] });

    expect(changed.summary).toMatchObject({ created: 0, revised: 14, skipped: 0 });
    expect(db.state.programs.flatMap((program) => program.versions)).toHaveLength(28);
    const m2 = changed.menus.find((menu) => menu.code === 'TT-020-CS-2D')!;
    expect(m2.assignedSerialNumbers).toEqual(['SECOND']);
  });

  it('deactivates only the explicitly named legacy code and keeps its history', async () => {
    const db = new FakeCatalogDatabase();
    db.addLegacyProgram('OLD-M5-CODE');
    const result = await new TorqueTrainingCatalogRegistrationService(db).register({
      legacyM5Codes: ['OLD-M5-CODE']
    });
    const legacy = db.state.programs.find((program) => program.code === 'OLD-M5-CODE')!;

    expect(result.legacyM5).toEqual([
      { code: 'OLD-M5-CODE', action: 'deactivated', programId: legacy.id }
    ]);
    expect(legacy.isActive).toBe(false);
    expect(legacy.versions).toHaveLength(1);
    expect(result.summary.legacyDeactivated).toBe(1);
  });

  it('rolls back all writes when an explicit legacy code is missing', async () => {
    const db = new FakeCatalogDatabase();
    await expect(
      new TorqueTrainingCatalogRegistrationService(db).register({ legacyM5Codes: ['MISSING'] })
    ).rejects.toThrow('legacy M5 code was not found');
    expect(db.state.groups).toHaveLength(0);
    expect(db.state.programs).toHaveLength(0);
  });

  it('does not deactivate an explicitly supplied non-M5 program code', async () => {
    const db = new FakeCatalogDatabase();
    db.addLegacyProgram('OLD-M4-CODE', 'M4');

    await expect(
      new TorqueTrainingCatalogRegistrationService(db).register({ legacyM5Codes: ['OLD-M4-CODE'] })
    ).rejects.toThrow('legacy code is not an M5 program');
    const nonM5 = db.state.programs.find((program) => program.code === 'OLD-M4-CODE')!;
    expect(nonM5.isActive).toBe(true);
    expect(nonM5.versions).toHaveLength(1);
  });
});
