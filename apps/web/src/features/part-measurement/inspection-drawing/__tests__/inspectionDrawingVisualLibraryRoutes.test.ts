import { describe, expect, it } from 'vitest';

import {
  kioskInspectionDrawingCreatePathWithVisual,
  parseInspectionDrawingVisualTemplateIdFromSearch
} from '../kioskInspectionDrawingRoutes';

describe('kioskInspectionDrawingRoutes visualTemplateId', () => {
  it('parseInspectionDrawingVisualTemplateIdFromSearch reads query param', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(parseInspectionDrawingVisualTemplateIdFromSearch(`?visualTemplateId=${id}`)).toBe(id);
    expect(parseInspectionDrawingVisualTemplateIdFromSearch('')).toBeNull();
  });

  it('kioskInspectionDrawingCreatePathWithVisual builds create URL', () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(kioskInspectionDrawingCreatePathWithVisual(id)).toBe(
      `/kiosk/part-measurement/inspection/create?visualTemplateId=${id}`
    );
  });
});
