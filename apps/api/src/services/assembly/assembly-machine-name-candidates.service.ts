import {
  machineNameCatalogRepository,
  type MachineNameCatalogRepository,
} from '../production-schedule/machine-name-catalog.repository.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../production-schedule/constants.js';

export type AssemblyMachineNameCandidateResult = {
  candidates: string[];
  hasMore: boolean;
};

export type AssemblyMachineNameCandidateQuery = {
  digitQuery?: string;
  q?: string;
  limit?: number;
};

const naturalCollator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
});

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export class AssemblyMachineNameCandidatesService {
  constructor(private readonly repository: Pick<MachineNameCatalogRepository, 'list'> = machineNameCatalogRepository) {}

  async list(query: AssemblyMachineNameCandidateQuery): Promise<AssemblyMachineNameCandidateResult> {
    const digitQuery = query.digitQuery ?? '';
    const textQuery = normalizeMachineNameForCompare(query.q);
    const limit = query.limit ?? 40;
    const unregisteredKey = normalizeMachineNameForCompare(SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL);
    const unique = new Map<string, string>();

    for (const entry of await this.repository.list()) {
      const normalized = normalizeMachineNameForCompare(entry.machineName);
      if (!normalized || normalized === unregisteredKey || unique.has(normalized)) continue;
      if (digitQuery && !digitsOnly(normalized).includes(digitQuery)) continue;
      if (textQuery && !normalized.includes(textQuery)) continue;
      unique.set(normalized, entry.machineName.trim());
    }

    const matches = [...unique.entries()]
      .sort(([aKey], [bKey]) => naturalCollator.compare(aKey, bKey) || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0))
      .map(([, name]) => name);

    return {
      candidates: matches.slice(0, limit),
      hasMore: matches.length > limit,
    };
  }
}
