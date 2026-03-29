import { getResourceCategoryPolicy } from '../production-schedule/policies/resource-category-policy.service.js';
import {
  apiProcessGroupToPrisma,
  type ApiProcessGroup,
  parseApiProcessGroup,
  resourceCdMatchesProcessGroup
} from './part-measurement-process-group.adapter.js';
import {
  listScheduleRowsByProductNo,
  resolveMachineNameForSeiban,
  type PartMeasurementScheduleRowCandidate
} from './part-measurement-schedule-lookup.service.js';
import { PartMeasurementTemplateService } from './part-measurement-template.service.js';

type ActiveTemplate = Awaited<ReturnType<PartMeasurementTemplateService['findActiveByFhincdGroupAndResource']>>;

export type ResolveTicketInput = {
  productNo: string;
  processGroup: string;
  scannedFhincd?: string | null;
  /** 指定時はこの資源CDの行に絞り、テンプレートも fhincd+工程+資源CD で解決 */
  resourceCd?: string | null;
  /** 端末スコープ（資源カテゴリポリシー解決用） */
  deviceScopeKey?: string | null;
};

export type ResolvedTicketCandidate = PartMeasurementScheduleRowCandidate & {
  machineName: string | null;
};

export type ResolveTicketResult = {
  processGroup: ApiProcessGroup;
  candidates: ResolvedTicketCandidate[];
  ambiguous: boolean;
  selected: ResolvedTicketCandidate | null;
  fhincdMismatch: boolean;
  template: ActiveTemplate;
};

export class PartMeasurementResolveService {
  private readonly templates = new PartMeasurementTemplateService();

  async resolveTicket(input: ResolveTicketInput): Promise<ResolveTicketResult> {
    const group = parseApiProcessGroup(input.processGroup);

    const policy = await getResourceCategoryPolicy({
      deviceScopeKey: input.deviceScopeKey ?? undefined
    });

    const rawRows = await listScheduleRowsByProductNo(input.productNo);
    let matched = rawRows.filter((row) =>
      resourceCdMatchesProcessGroup(row.fsigencd, group, policy)
    );
    const wantResource = input.resourceCd?.trim() ?? '';
    if (wantResource.length > 0) {
      matched = matched.filter((row) => row.fsigencd.trim() === wantResource);
    }

    const scanned = input.scannedFhincd?.trim() ?? '';
    const filteredByFhincd =
      scanned.length > 0
        ? matched.filter((row) => row.fhincd.trim().toUpperCase() === scanned.toUpperCase())
        : matched;

    const fhincdMismatch = scanned.length > 0 && matched.length > 0 && filteredByFhincd.length === 0;

    const useRows =
      fhincdMismatch ? matched : filteredByFhincd.length > 0 ? filteredByFhincd : matched;

    const fseibans = [...new Set(useRows.map((r) => r.fseiban))];
    const machineBySeiban = new Map<string, string | null>();
    for (const fb of fseibans) {
      machineBySeiban.set(fb, await resolveMachineNameForSeiban(fb));
    }

    const candidates: ResolvedTicketCandidate[] = useRows.map((row) => ({
      ...row,
      machineName: machineBySeiban.get(row.fseiban) ?? null
    }));

    const ambiguous = candidates.length > 1;
    const selected = candidates.length === 1 ? candidates[0] : null;

    const prismaGroup = apiProcessGroupToPrisma(group);
    const templateFhincd = selected?.fhincd.trim() ?? '';
    const templateResourceCd = selected?.fsigencd.trim() ?? wantResource;
    const template =
      templateFhincd.length > 0 && templateResourceCd.length > 0
        ? await this.templates.findActiveByFhincdGroupAndResource(
            templateFhincd,
            prismaGroup,
            templateResourceCd
          )
        : null;

    return {
      processGroup: group,
      candidates,
      ambiguous,
      selected,
      fhincdMismatch,
      template
    };
  }
}
