import { describe, expect, it } from 'vitest';

import { detectGraphTemplate, graphFieldsFor, writeJsonField } from '../data-boards/graphFieldModel';
import { formatVisualizationOptionLabel } from '../signage/signageScheduleDisplay';

import { buildSavePayload, setCsvDashboardId } from './visualizationDashboardFormModel';
import { buildHydraulicOilExchangePresetFields } from './visualizationDashboardPresets';

import type { VisualizationDashboard } from '../../../api/client';

describe('hydraulic oil exchange admin preset', () => {
  it('creates a configured dashboard using form fields without writing JSON', () => {
    const preset = buildHydraulicOilExchangePresetFields('', '');
    expect(preset).toMatchObject({ name: '作動油交換', rendererType: 'hydraulic_oil_exchange', rendererConfig: '{}' });
    expect(JSON.parse(preset.dataSourceConfig)).toEqual({ csvDashboardId: '', inspectionItem: '作動油の交換', targetEquipmentNumbers: [] });
    expect(buildSavePayload({ ...preset, enabled: true }).ok).toBe(false);
    const fields = graphFieldsFor(detectGraphTemplate(preset.dataSourceType));
    const item = fields.find((field) => field.key === 'inspectionItem')!;
    expect(item).toMatchObject({ label: '点検項目', kind: 'text', target: 'dataSource' });
    const config = writeJsonField(setCsvDashboardId(preset.dataSourceConfig, '11111111-1111-1111-1111-111111111111'), item, '作動油の交換');
    const result = buildSavePayload({ ...preset, dataSourceConfig: config, enabled: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.dataSourceConfig).toMatchObject({ inspectionItem: '作動油の交換', csvDashboardId: '11111111-1111-1111-1111-111111111111' });
    const dashboard = { name: '交換予定', dataSourceType: preset.dataSourceType, rendererType: preset.rendererType, enabled: true } as VisualizationDashboard;
    expect(formatVisualizationOptionLabel(dashboard)).toContain('[作動油交換 /');
  });
  it('keeps an existing name and description', () => {
    expect(buildHydraulicOilExchangePresetFields('交換予定', '現場')).toMatchObject({ name: '交換予定', description: '現場' });
  });
});
