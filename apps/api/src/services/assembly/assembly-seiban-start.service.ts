import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from '../production-schedule/constants.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';
import { SeibanMachineNameSupplementRepository } from '../production-schedule/seiban-machine-name-supplement.repository.js';
import { fetchSeibanProgressRows } from '../production-schedule/seiban-progress.service.js';
import { isAssemblyIdentifierLike, normalizeAssemblyUpperIdentifier } from './assembly-identifiers.js';

export type AssemblyMachineNameSource = 'production_schedule' | 'supplement' | 'unregistered';

export type AssemblySeibanCandidate = {
  fseiban: string;
  machineName: string;
  machineNameSource: AssemblyMachineNameSource;
  activeTemplate: {
    id: string;
    modelCode: string;
    procedurePattern: string;
    name: string;
    version: number;
  } | null;
};

type SeibanCandidateRow = {
  fseiban: string;
};

type MachineNameResolution = {
  machineName: string;
  source: AssemblyMachineNameSource;
};

function normalizeMachineDisplayName(value: string | null | undefined): string | null {
  const normalized = normalizeMachineNameForCompare(value);
  return normalized.length > 0 ? normalized : null;
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 20;
  return Math.min(Math.max(Math.trunc(value ?? 20), 1), 50);
}

export class AssemblySeibanStartService {
  async listSeibanCandidates(params: { prefix: string; limit?: number }): Promise<AssemblySeibanCandidate[]> {
    const prefix = normalizeAssemblyUpperIdentifier(params.prefix);
    if (prefix.length === 0) return [];
    if (!isAssemblyIdentifierLike(prefix)) {
      return [];
    }

    const limit = clampLimit(params.limit);
    const rows = await prisma.$queryRaw<SeibanCandidateRow[]>`
      SELECT MIN("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban"
      FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '') <> ''
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) LIKE ${`${prefix}%`}
      GROUP BY UPPER("CsvDashboardRow"."rowData"->>'FSEIBAN')
      ORDER BY UPPER("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
      LIMIT ${limit}
    `;

    const fseibans = rows.map((row) => row.fseiban?.trim()).filter((value): value is string => !!value);
    if (fseibans.length === 0) return [];

    const machineNames = await this.resolveMachineNames(fseibans);
    const activeTemplates = await this.resolveActiveTemplates([...machineNames.values()].map((row) => row.machineName));

    return fseibans.map((fseiban) => {
      const resolved = machineNames.get(fseiban) ?? {
        machineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
        source: 'unregistered' as const
      };
      const template = activeTemplates.get(normalizeMachineNameForCompare(resolved.machineName)) ?? null;
      return {
        fseiban,
        machineName: resolved.machineName,
        machineNameSource: resolved.source,
        activeTemplate: template
      };
    });
  }

  private async resolveMachineNames(fseibans: string[]): Promise<Map<string, MachineNameResolution>> {
    const result = new Map<string, MachineNameResolution>();
    const progressRows = await fetchSeibanProgressRows(fseibans);
    const progressByFseiban = new Map(progressRows.map((row) => [row.fseiban, row.machineName] as const));

    const needSupplement: string[] = [];
    for (const fseiban of fseibans) {
      const direct = normalizeMachineDisplayName(progressByFseiban.get(fseiban));
      if (direct) {
        result.set(fseiban, { machineName: direct, source: 'production_schedule' });
      } else {
        needSupplement.push(fseiban);
      }
    }

    if (needSupplement.length > 0) {
      const supplementMap = await new SeibanMachineNameSupplementRepository().findByFseibans(needSupplement);
      for (const fseiban of needSupplement) {
        const supplement = normalizeMachineDisplayName(supplementMap.get(fseiban));
        result.set(
          fseiban,
          supplement
            ? { machineName: supplement, source: 'supplement' }
            : { machineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL, source: 'unregistered' }
        );
      }
    }

    return result;
  }

  private async resolveActiveTemplates(machineNames: string[]): Promise<
    Map<
      string,
      {
        id: string;
        modelCode: string;
        procedurePattern: string;
        name: string;
        version: number;
      }
    >
  > {
    const keys = [...new Set(machineNames.map((value) => normalizeMachineNameForCompare(value)).filter((value) => value.length > 0))];
    const matchableKeys = keys.filter((key) => key !== normalizeMachineNameForCompare(SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL));
    if (matchableKeys.length === 0) return new Map();

    const templates = await prisma.assemblyTemplate.findMany({
      where: {
        isActive: true,
        OR: matchableKeys.map((modelCode) => ({
          modelCode: { equals: modelCode, mode: 'insensitive' as Prisma.QueryMode }
        }))
      },
      select: {
        id: true,
        modelCode: true,
        procedurePattern: true,
        name: true,
        version: true
      },
      orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }]
    });

    const byMachineName = new Map<string, (typeof templates)[number]>();
    for (const template of templates) {
      const key = normalizeMachineNameForCompare(template.modelCode);
      if (!byMachineName.has(key)) {
        byMachineName.set(key, template);
      }
    }
    return byMachineName;
  }
}
