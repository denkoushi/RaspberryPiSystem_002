import { describe, expect, it } from 'vitest';

import { buildProcessGroupsByVisualId } from '../inspectionDrawingResourceCdHelpers';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../types';

const template: KioskInspectionDrawingTemplateSummaryDto = {
  id: 'template-1',
  fhincd: 'PART-1',
  resourceCd: 'R001',
  processGroup: 'grinding',
  name: 'PART-1 研削',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: 'visual-1',
  visualTemplate: null,
  siblingGroupId: null,
  siblingGroup: null,
  itemCount: 1,
  updatedAt: '2026-07-01T07:46:02.229Z'
};

describe('buildProcessGroupsByVisualId', () => {
  it('collects distinct active processes per drawing', () => {
    expect(buildProcessGroupsByVisualId([
      template,
      { ...template, id: 'template-2', resourceCd: 'R002' },
      { ...template, id: 'template-3', processGroup: 'cutting' },
      { ...template, id: 'template-4', processGroup: 'cutting', visualTemplateId: 'visual-2' },
      { ...template, id: 'template-5', isActive: false, visualTemplateId: 'visual-2' }
    ])).toEqual({ 'visual-1': ['grinding', 'cutting'], 'visual-2': ['cutting'] });
  });

  it('ignores rows without a drawing or a process', () => {
    expect(buildProcessGroupsByVisualId([
      { ...template, visualTemplateId: null },
      { ...template, id: 'template-2', processGroup: null }
    ])).toEqual({});
  });
});
