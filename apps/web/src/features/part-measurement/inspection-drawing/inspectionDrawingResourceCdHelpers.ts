import type { KioskInspectionDrawingTemplateSummaryDto } from '../types';

export function activeResourceCdsForTemplate(
  template: KioskInspectionDrawingTemplateSummaryDto
): string[] {
  return template.siblingGroup?.activeResourceCds && template.siblingGroup.activeResourceCds.length > 0
    ? template.siblingGroup.activeResourceCds
    : [template.resourceCd];
}

export function buildResourceCdsByVisualId(
  templates: KioskInspectionDrawingTemplateSummaryDto[]
): Record<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const template of templates) {
    if (!template.isActive) continue;
    const visualId = template.visualTemplateId;
    if (!visualId) continue;

    const cds = activeResourceCdsForTemplate(template);
    const set = map.get(visualId) ?? new Set<string>();
    for (const cd of cds) {
      set.add(cd);
    }
    map.set(visualId, set);
  }

  const result: Record<string, string[]> = {};
  for (const [visualId, cds] of map) {
    result[visualId] = [...cds].sort((a, b) => a.localeCompare(b, 'ja'));
  }
  return result;
}
