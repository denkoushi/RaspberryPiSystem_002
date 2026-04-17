import { describe, expect, it, vi } from 'vitest';
import {
  buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition,
  ensureProductionScheduleSeibanMachineNameSupplementDashboard,
} from '../seiban-machine-name-supplement-dashboard.definition.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';

describe('seiban-machine-name-supplement-dashboard.definition', () => {
  it('builds the fixed dashboard definition', () => {
    const definition = buildProductionScheduleSeibanMachineNameSupplementDashboardDefinition();

    expect(definition.gmailSubjectPattern).toBe('FHINMEI_MH_SH');
    expect(definition.enabled).toBe(true);
    expect(definition.displayPeriodDays).toBe(365);
    expect(definition.templateConfig.displayColumns).toEqual(['FSEIBAN', 'FHINMEI_MH_SH']);
  });

  it('ensures the fixed dashboard row via upsert', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);

    await ensureProductionScheduleSeibanMachineNameSupplementDashboard({
      csvDashboard: { upsert },
    });

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
        create: expect.objectContaining({
          id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
          gmailSubjectPattern: 'FHINMEI_MH_SH',
        }),
        update: expect.objectContaining({
          gmailSubjectPattern: 'FHINMEI_MH_SH',
          enabled: true,
        }),
      })
    );
  });
});
