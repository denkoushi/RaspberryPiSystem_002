import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { normalizeTorqueWrenchKey } from '../torque-wrenches/torque-wrench-normalization.js';
import { trainingConditionFingerprint } from './torque-training.policy.js';
import {
  STANDARD_TORQUE_TRAINING_CATALOG,
  STANDARD_TORQUE_TRAINING_M5_CODES,
  type StandardTorqueTrainingMenu
} from './standard-torque-training-catalog.js';

export type TorqueTrainingCatalogRegistrationOptions = {
  dryRun?: boolean;
  wrenchSerialNumbers?: readonly string[];
  legacyM5Codes?: readonly string[];
};

export type TorqueTrainingCatalogMenuAction = 'created' | 'revised' | 'skipped';

export type TorqueTrainingCatalogMenuResult = {
  code: string;
  action: TorqueTrainingCatalogMenuAction;
  programId: string | null;
  version: number;
  capabilityGroupId: string | null;
  assignedSerialNumbers: string[];
  unassignedSerialNumbers: Array<{ serialNumber: string; reason: string }>;
  capabilityLinksAdded: number;
};

export type TorqueTrainingCatalogLegacyResult = {
  code: string;
  action: 'deactivated' | 'would-deactivate' | 'skipped';
  programId: string | null;
};

export type TorqueTrainingCatalogRegistrationResult = {
  dryRun: boolean;
  menus: TorqueTrainingCatalogMenuResult[];
  legacyM5: TorqueTrainingCatalogLegacyResult[];
  summary: {
    totalMenus: number;
    created: number;
    revised: number;
    skipped: number;
    capabilityLinksAdded: number;
    legacyDeactivated: number;
  };
};

export type TorqueWrenchCapabilityRange = {
  torqueMinNm: Prisma.Decimal.Value;
  torqueMaxNm: Prisma.Decimal.Value;
  isActive?: boolean;
};

/**
 * A model is usable for a catalogue entry only when its complete supported
 * range contains the configured lower and upper limits.  Checking the whole
 * interval prevents a wrench that can reach the target but not one of the
 * accepted boundaries from being assigned accidentally.
 */
export function isTorqueWrenchModelInStandardRange(
  model: TorqueWrenchCapabilityRange,
  menu: Pick<StandardTorqueTrainingMenu, 'lowerLimit' | 'upperLimit'>
): boolean {
  if (model.isActive === false) return false;
  return new Prisma.Decimal(model.torqueMinNm).lte(menu.lowerLimit) && new Prisma.Decimal(model.torqueMaxNm).gte(menu.upperLimit);
}

export class TorqueTrainingCatalogRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorqueTrainingCatalogRegistrationError';
  }
}

type CatalogTransaction = Prisma.TransactionClient;

type CatalogDatabase = {
  $transaction<T>(work: (tx: CatalogTransaction) => Promise<T>): Promise<T>;
};

type ProfileRow = {
  id: string;
  serialNumber: string;
  serialNumberKey: string;
  modelId: string;
  model: TorqueWrenchCapabilityRange;
};

type Assignment = {
  profileId: string;
  serialNumber: string;
  modelId: string;
  model: TorqueWrenchCapabilityRange;
};

type ExistingVersion = {
  id: string;
  version: number;
  nominalDiameter: string;
  conditionFingerprint: string;
  wrenches: Array<{
    torqueWrenchProfileId: string;
    torqueWrenchProfile: {
      id: string;
      serialNumber: string;
      modelId: string;
      model: TorqueWrenchCapabilityRange;
    };
  }>;
};

function uniqueTrimmed(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function decimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.every((id, index) => id === b[index]);
}

function normalizeNominalDiameter(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}

function conditionFingerprint(menu: StandardTorqueTrainingMenu, capabilityGroupId: string): string {
  return trainingConditionFingerprint({
    nominalDiameter: menu.nominalDiameter,
    boltLengthMm: decimal(menu.boltLengthMm),
    material: menu.material,
    strengthClass: menu.strengthClass,
    capabilityGroupId,
    lowerLimit: decimal(menu.lowerLimit),
    nominalTorque: decimal(menu.nominalTorque),
    upperLimit: decimal(menu.upperLimit),
    unit: menu.unit,
    jigConditionCode: menu.jigConditionCode
  });
}

function assertCapabilityGroupMatches(
  group: {
    id: string;
    nominalDiameter: string;
    boltLengthMm: Prisma.Decimal;
    material: string;
    strengthClass: string;
    isActive: boolean;
  },
  menu: StandardTorqueTrainingMenu
): void {
  const matches =
    group.nominalDiameter === menu.nominalDiameter &&
    decimal(group.boltLengthMm).eq(menu.boltLengthMm) &&
    group.material === menu.material &&
    group.strengthClass === menu.strengthClass;
  if (!matches) {
    throw new TorqueTrainingCatalogRegistrationError(
      `capability group ${menu.capabilityGroupName} already exists with a different condition`
    );
  }
  if (!group.isActive) {
    throw new TorqueTrainingCatalogRegistrationError(
      `capability group ${menu.capabilityGroupName} is inactive`
    );
  }
}

async function findProfiles(
  tx: CatalogTransaction,
  serialNumbers: readonly string[]
): Promise<ProfileRow[]> {
  const serialNumberKeys = uniqueTrimmed(serialNumbers).map(normalizeTorqueWrenchKey);
  if (serialNumberKeys.length === 0) return [];
  const profiles = await tx.torqueWrenchProfile.findMany({
    where: { serialNumberKey: { in: serialNumberKeys } },
    select: {
      id: true,
      serialNumber: true,
      serialNumberKey: true,
      modelId: true,
      model: { select: { torqueMinNm: true, torqueMaxNm: true, isActive: true } }
    }
  });
  const foundKeys = new Set(profiles.map((profile) => profile.serialNumberKey));
  const missing = serialNumberKeys.filter((key) => !foundKeys.has(key));
  if (missing.length > 0) {
    throw new TorqueTrainingCatalogRegistrationError(
      `wrench serial number was not found: ${missing.join(', ')}`
    );
  }
  return profiles;
}

async function ensureCapabilityGroup(
  tx: CatalogTransaction,
  menu: StandardTorqueTrainingMenu,
  dryRun: boolean
): Promise<{ id: string | null; created: boolean }> {
  const existing = await tx.torqueWrenchCapabilityGroup.findUnique({
    where: { name: menu.capabilityGroupName }
  });
  if (existing) {
    assertCapabilityGroupMatches(existing, menu);
    return { id: existing.id, created: false };
  }
  if (dryRun) return { id: null, created: true };
  const created = await tx.torqueWrenchCapabilityGroup.create({
    data: {
      name: menu.capabilityGroupName,
      nominalDiameter: menu.nominalDiameter,
      boltLengthMm: menu.boltLengthMm,
      material: menu.material,
      strengthClass: menu.strengthClass,
      isActive: true
    }
  });
  return { id: created.id, created: true };
}

async function findCurrentVersion(
  tx: CatalogTransaction,
  programId: string,
  currentVersion: number
): Promise<ExistingVersion | null> {
  return tx.torqueTrainingProgramVersion.findUnique({
    where: { programId_version: { programId, version: currentVersion } },
    select: {
      id: true,
      version: true,
      nominalDiameter: true,
      conditionFingerprint: true,
      wrenches: {
        select: {
          torqueWrenchProfileId: true,
          torqueWrenchProfile: {
            select: {
              id: true,
              serialNumber: true,
              modelId: true,
              model: { select: { torqueMinNm: true, torqueMaxNm: true, isActive: true } }
            }
          }
        }
      }
    }
  }) as Promise<ExistingVersion | null>;
}

function assignmentFromProfile(profile: ProfileRow): Assignment {
  return {
    profileId: profile.id,
    serialNumber: profile.serialNumber,
    modelId: profile.modelId,
    model: profile.model
  };
}

function assignmentFromExisting(profile: ExistingVersion['wrenches'][number]): Assignment {
  return {
    profileId: profile.torqueWrenchProfileId,
    serialNumber: profile.torqueWrenchProfile.serialNumber,
    modelId: profile.torqueWrenchProfile.modelId,
    model: profile.torqueWrenchProfile.model
  };
}

function compatibleAssignments(
  menu: StandardTorqueTrainingMenu,
  profiles: readonly Assignment[]
): { compatible: Assignment[]; incompatible: Array<{ serialNumber: string; reason: string }> } {
  const compatible: Assignment[] = [];
  const incompatible: Array<{ serialNumber: string; reason: string }> = [];
  for (const profile of profiles) {
    if (profile.model.isActive === false) {
      incompatible.push({ serialNumber: profile.serialNumber, reason: 'MODEL_INACTIVE' });
    } else if (!isTorqueWrenchModelInStandardRange(profile.model, menu)) {
      incompatible.push({ serialNumber: profile.serialNumber, reason: 'MODEL_TORQUE_RANGE_OUT_OF_BOUNDS' });
    } else {
      compatible.push(profile);
    }
  }
  return { compatible, incompatible };
}

async function ensureCapabilityLinks(
  tx: CatalogTransaction,
  groupId: string | null,
  menu: StandardTorqueTrainingMenu,
  assignments: readonly Assignment[],
  dryRun: boolean
): Promise<number> {
  let created = 0;
  for (const assignment of assignments) {
    if (!isTorqueWrenchModelInStandardRange(assignment.model, menu)) continue;
    if (dryRun && !groupId) {
      created += 1;
      continue;
    }
    if (!groupId) continue;
    const existing = await tx.torqueWrenchCapabilityGroupModel.findUnique({
      where: {
        capabilityGroupId_modelId: {
          capabilityGroupId: groupId,
          modelId: assignment.modelId
        }
      }
    });
    if (existing) continue;
    if (!dryRun) {
      await tx.torqueWrenchCapabilityGroupModel.create({
        data: { capabilityGroupId: groupId, modelId: assignment.modelId }
      });
    }
    created += 1;
  }
  return created;
}

function canonicalProgramData(
  menu: StandardTorqueTrainingMenu,
  capabilityGroupId: string,
  fingerprint: string,
  version: number,
  assignments: readonly Assignment[]
) {
  return {
    version,
    displayName: menu.displayName,
    nominalDiameter: menu.nominalDiameter,
    boltLengthMm: menu.boltLengthMm,
    material: menu.material,
    strengthClass: menu.strengthClass,
    capabilityGroupId,
    nominalTorque: menu.nominalTorque,
    lowerLimit: menu.lowerLimit,
    upperLimit: menu.upperLimit,
    unit: menu.unit,
    jigConditionCode: menu.jigConditionCode,
    conditionFingerprint: fingerprint,
    attemptCount: 5,
    wrenches: {
      create: assignments.map((assignment) => ({ torqueWrenchProfileId: assignment.profileId }))
    }
  };
}

export class TorqueTrainingCatalogRegistrationService {
  constructor(private readonly db: CatalogDatabase = prisma) {}

  async register(
    options: TorqueTrainingCatalogRegistrationOptions = {}
  ): Promise<TorqueTrainingCatalogRegistrationResult> {
    const dryRun = options.dryRun === true;
    const wrenchSerialNumbers = uniqueTrimmed(options.wrenchSerialNumbers);
    const legacyM5Codes = uniqueTrimmed(options.legacyM5Codes);
    return this.db.$transaction(async (tx) => {
      const profiles = await findProfiles(tx, wrenchSerialNumbers);
      const selectedAssignments = profiles.map(assignmentFromProfile);
      const menuResults: TorqueTrainingCatalogMenuResult[] = [];

      for (const menu of STANDARD_TORQUE_TRAINING_CATALOG) {
        const group = await ensureCapabilityGroup(tx, menu, dryRun);
        const program = await tx.torqueTrainingProgram.findUnique({
          where: { code: menu.code },
          select: { id: true, currentVersion: true, isActive: true }
        });
        if (program && !program.isActive) {
          throw new TorqueTrainingCatalogRegistrationError(`catalog program ${menu.code} is inactive`);
        }
        const current = program
          ? await findCurrentVersion(tx, program.id, program.currentVersion)
          : null;
        if (program && !current) {
          throw new TorqueTrainingCatalogRegistrationError(
            `catalog program ${menu.code} has no current version ${program.currentVersion}`
          );
        }

        const currentAssignments = current?.wrenches.map(assignmentFromExisting) ?? [];
        const sourceAssignments = wrenchSerialNumbers.length > 0 ? selectedAssignments : currentAssignments;
        const assignmentDecision = compatibleAssignments(menu, sourceAssignments);
        const desiredAssignments = assignmentDecision.compatible;
        const desiredIds = desiredAssignments.map((assignment) => assignment.profileId);
        const currentIds = currentAssignments.map((assignment) => assignment.profileId);
        const fingerprint = group.id ? conditionFingerprint(menu, group.id) : null;
        const sameCondition = Boolean(current && fingerprint && current.conditionFingerprint === fingerprint);
        const sameAssignments = Boolean(current && sameIdSet(currentIds, desiredIds));
        const needsRevision = !program || !current || !sameCondition || !sameAssignments;
        let action: TorqueTrainingCatalogMenuAction = 'skipped';
        let version = current?.version ?? 1;
        let programId = program?.id ?? null;
        let capabilityLinksAdded = 0;

        const linkAssignments = desiredAssignments;
        capabilityLinksAdded = await ensureCapabilityLinks(
          tx,
          group.id,
          menu,
          linkAssignments,
          dryRun
        );

        if (needsRevision) {
          action = program ? 'revised' : 'created';
          version = program ? program.currentVersion + 1 : 1;
          if (!dryRun) {
            if (!group.id) {
              throw new TorqueTrainingCatalogRegistrationError(
                `capability group ${menu.capabilityGroupName} was not created`
              );
            }
            const effectiveFingerprint = conditionFingerprint(menu, group.id);
            if (!program) {
              const created = await tx.torqueTrainingProgram.create({
                data: {
                  code: menu.code,
                  currentVersion: 1,
                  versions: {
                    create: canonicalProgramData(menu, group.id, effectiveFingerprint, version, linkAssignments)
                  }
                },
                select: { id: true }
              });
              programId = created.id;
            } else {
              await tx.torqueTrainingProgramVersion.create({
                data: {
                  programId: program.id,
                  ...canonicalProgramData(menu, group.id, effectiveFingerprint, version, linkAssignments)
                },
                select: { id: true }
              });
              await tx.torqueTrainingProgram.update({
                where: { id: program.id },
                data: { currentVersion: version }
              });
            }
          }
        }

        menuResults.push({
          code: menu.code,
          action,
          programId,
          version,
          capabilityGroupId: group.id,
          assignedSerialNumbers: desiredAssignments.map((assignment) => assignment.serialNumber),
          unassignedSerialNumbers: assignmentDecision.incompatible,
          capabilityLinksAdded
        });
      }

      const legacyResults: TorqueTrainingCatalogLegacyResult[] = [];
      for (const legacyCode of legacyM5Codes) {
        if (STANDARD_TORQUE_TRAINING_M5_CODES.includes(legacyCode)) {
          throw new TorqueTrainingCatalogRegistrationError(
            `legacy M5 code must not be a canonical code: ${legacyCode}`
          );
        }
        const legacy = await tx.torqueTrainingProgram.findUnique({
          where: { code: legacyCode },
          select: { id: true, currentVersion: true, isActive: true }
        });
        if (!legacy) {
          throw new TorqueTrainingCatalogRegistrationError(
            `legacy M5 code was not found: ${legacyCode}`
          );
        }
        const legacyVersion = await findCurrentVersion(tx, legacy.id, legacy.currentVersion);
        if (!legacyVersion || normalizeNominalDiameter(legacyVersion.nominalDiameter) !== 'M5') {
          throw new TorqueTrainingCatalogRegistrationError(
            `legacy code is not an M5 program: ${legacyCode}`
          );
        }
        if (!legacy.isActive) {
          legacyResults.push({ code: legacyCode, action: 'skipped', programId: legacy.id });
          continue;
        }
        if (!dryRun) {
          await tx.torqueTrainingProgram.update({
            where: { id: legacy.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: `Replaced by canonical M5 catalog programs: ${STANDARD_TORQUE_TRAINING_M5_CODES.join(', ')}`
            }
          });
        }
        legacyResults.push({
          code: legacyCode,
          action: dryRun ? 'would-deactivate' : 'deactivated',
          programId: legacy.id
        });
      }

      const summary = {
        totalMenus: menuResults.length,
        created: menuResults.filter((menu) => menu.action === 'created').length,
        revised: menuResults.filter((menu) => menu.action === 'revised').length,
        skipped: menuResults.filter((menu) => menu.action === 'skipped').length,
        capabilityLinksAdded: menuResults.reduce((sum, menu) => sum + menu.capabilityLinksAdded, 0),
        legacyDeactivated: legacyResults.filter((legacy) => legacy.action !== 'skipped').length
      };
      return { dryRun, menus: menuResults, legacyM5: legacyResults, summary };
    });
  }
}
