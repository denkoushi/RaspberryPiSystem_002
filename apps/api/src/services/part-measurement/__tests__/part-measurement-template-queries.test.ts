import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    partMeasurementTemplate: {
      findFirst: vi.fn(),
      findMany: vi.fn()
    }
  }
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));

import { normalizePartMeasurementResourceCd } from '../part-measurement-resource-cd.js';
import { productionPartMeasurementTemplateWhere } from '../part-measurement-template-guards.js';
import { partMeasurementTemplateFullInclude } from '../part-measurement-template-include.js';
import { PartMeasurementTemplateService } from '../part-measurement-template.service.js';

const listOrderBy = [
  { fhincd: 'asc' },
  { processGroup: 'asc' },
  { fkojun: 'asc' },
  { resourceCd: 'asc' },
  { version: 'desc' }
];

const kioskInclude = {
  siblingGroup: true,
  visualTemplate: true,
  items: {
    orderBy: { sortOrder: 'asc' },
    select: { markerXRatio: true, markerYRatio: true, lowerLimit: true, upperLimit: true }
  }
};

describe('PartMeasurementTemplateService queries', () => {
  const service = new PartMeasurementTemplateService();
  const { findFirst, findMany } = mocks.prisma.partMeasurementTemplate;

  beforeEach(() => {
    vi.resetAllMocks();
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
  });

  it('finds the latest active three-key template with normalized keys and a trimmed FKOJUN', async () => {
    const template = { id: 'template-1', version: 3, items: [], visualTemplate: null, siblingGroup: null };
    findFirst.mockResolvedValue(template);

    const result = await service.findActiveByFhincdGroupAndResource(' part-a ', 'CUTTING', ' r1 ', ' 10 ');

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        fhincd: { equals: 'PART-A', mode: 'insensitive' },
        processGroup: 'CUTTING',
        resourceCd: 'r1',
        AND: [{ fkojun: '10' }],
        isActive: true,
        templateScope: 'THREE_KEY'
      },
      orderBy: { version: 'desc' },
      include: partMeasurementTemplateFullInclude
    });
    expect(result).toBe(template);
  });

  it('uses the legacy resource and empty-or-null FKOJUN by default and returns a missing match', async () => {
    const result = await service.findActiveByFhincdGroupAndResource(' part-b ', 'GRINDING', '  ');

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        fhincd: { equals: 'PART-B', mode: 'insensitive' },
        processGroup: 'GRINDING',
        resourceCd: normalizePartMeasurementResourceCd('  '),
        AND: [{ OR: [{ fkojun: '' }, { fkojun: null }] }],
        isActive: true,
        templateScope: 'THREE_KEY'
      },
      orderBy: { version: 'desc' },
      include: partMeasurementTemplateFullInclude
    });
    expect(result).toBeNull();
  });

  it('returns null without querying Prisma when the normalized FHINCD is empty', async () => {
    expect(await service.findActiveByFhincdGroupAndResource(' \t ', 'CUTTING', 'R1')).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('applies all kiosk filters and returns only drawing-supported rows with item counts', async () => {
    const template = {
      id: 'drawing-1',
      siblingGroupId: null,
      visualTemplate: { drawingImageRelativePath: 'drawings/part-a.png' },
      items: [{ markerXRatio: 0.2, markerYRatio: 0.3, lowerLimit: 9, upperLimit: 11 }]
    };
    findMany.mockResolvedValue([template, { ...template, id: 'without-drawing', visualTemplate: null }]);

    const result = await service.listKioskInspectionDrawingTemplates({
      fhincd: ' part-a ',
      processGroup: 'GRINDING',
      resourceCd: ' r2 ',
      fkojun: ' 20 ',
      visualName: ' Drawing A ',
      digitQuery: 'AB-12/34'
    });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: productionPartMeasurementTemplateWhere({
        templateScope: 'THREE_KEY',
        processGroup: 'GRINDING',
        visualTemplateId: { not: null },
        fhincd: { contains: 'part-a', mode: 'insensitive' },
        resourceCd: 'r2',
        AND: [{ fkojun: '20' }],
        isActive: true,
        visualTemplate: {
          is: { name: { contains: 'Drawing A', mode: 'insensitive' }, searchDigits: { contains: '1234' } }
        }
      }),
      orderBy: listOrderBy,
      include: kioskInclude
    });
    expect(result).toEqual([{ template: { ...template, siblingGroupActiveResourceCds: [] }, itemCount: 1 }]);
  });

  it('keeps blank kiosk FKOJUN and resource filters while including inactive templates', async () => {
    const result = await service.listKioskInspectionDrawingTemplates({
      fhincd: '  ',
      resourceCd: '  ',
      fkojun: ' \t ',
      includeInactive: true,
      visualName: '  ',
      digitQuery: 'ABC'
    });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: productionPartMeasurementTemplateWhere({
        templateScope: 'THREE_KEY',
        processGroup: { in: ['CUTTING', 'GRINDING'] },
        visualTemplateId: { not: null },
        resourceCd: normalizePartMeasurementResourceCd('  '),
        AND: [{ OR: [{ fkojun: '' }, { fkojun: null }] }]
      }),
      orderBy: listOrderBy,
      include: kioskInclude
    });
    expect(result).toEqual([]);
  });

  it('omits unspecified kiosk filters and defaults to active cutting and grinding templates', async () => {
    expect(await service.listKioskInspectionDrawingTemplates({})).toEqual([]);

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: productionPartMeasurementTemplateWhere({
        templateScope: 'THREE_KEY',
        processGroup: { in: ['CUTTING', 'GRINDING'] },
        visualTemplateId: { not: null },
        isActive: true
      }),
      orderBy: listOrderBy,
      include: kioskInclude
    });
  });

  it('lists templates with exact trimmed FHINCD and all optional identity filters', async () => {
    const templates = [{ id: 'template-2', items: [], visualTemplate: null, siblingGroup: null }];
    findMany.mockResolvedValue(templates);

    const result = await service.listTemplates({
      fhincd: ' part-a ',
      processGroup: 'CUTTING',
      resourceCd: ' r3 ',
      fkojun: ' 30 '
    });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: productionPartMeasurementTemplateWhere({
        fhincd: 'part-a',
        processGroup: 'CUTTING',
        resourceCd: 'r3',
        AND: [{ fkojun: '30' }],
        isActive: true
      }),
      orderBy: listOrderBy,
      include: partMeasurementTemplateFullInclude
    });
    expect(result).toBe(templates);
  });

  it('lists inactive templates with an empty-or-null FKOJUN filter and a legacy resource', async () => {
    const result = await service.listTemplates({ fhincd: ' ', resourceCd: ' ', fkojun: ' ', includeInactive: true });

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: productionPartMeasurementTemplateWhere({
        resourceCd: normalizePartMeasurementResourceCd(' '),
        AND: [{ OR: [{ fkojun: '' }, { fkojun: null }] }]
      }),
      orderBy: listOrderBy,
      include: partMeasurementTemplateFullInclude
    });
    expect(result).toEqual([]);
  });

  it('loads sibling resources using unique nonblank IDs without trimming them or deduplicating resources', async () => {
    findMany.mockResolvedValue([
      { siblingGroupId: null, resourceCd: 'ignored' },
      { siblingGroupId: 'group-1', resourceCd: 'R1' },
      { siblingGroupId: 'group-1', resourceCd: 'R1' },
      { siblingGroupId: 'group-1', resourceCd: 'R2' },
      { siblingGroupId: ' group-2 ', resourceCd: 'r3' }
    ]);

    const result = await service.getActiveResourceCdsBySiblingGroupIds([
      'group-1', '', ' \t ', 'group-1', ' group-2 ', 'missing-group'
    ]);

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        siblingGroupId: { in: ['group-1', ' group-2 ', 'missing-group'] },
        isActive: true,
        templateScope: 'THREE_KEY'
      },
      orderBy: [{ siblingGroupId: 'asc' }, { resourceCd: 'asc' }],
      select: { siblingGroupId: true, resourceCd: true }
    });
    expect(result).toEqual(new Map([
      ['group-1', ['R1', 'R1', 'R2']],
      [' group-2 ', ['r3']]
    ]));
  });

  it('returns an empty sibling resource map without querying for empty or whitespace-only IDs', async () => {
    expect(await service.getActiveResourceCdsBySiblingGroupIds([])).toEqual(new Map());
    expect(await service.getActiveResourceCdsBySiblingGroupIds(['', ' \t '])).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});
