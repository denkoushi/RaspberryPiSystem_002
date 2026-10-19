import { describe, expect, it } from 'vitest';

import { signageQueryKeys } from './signage';

describe('signageQueryKeys', () => {
  it('preserves fixed keys and invalidation prefixes', () => {
    expect(signageQueryKeys.schedulesAll).toEqual(['signage-schedules']);
    expect(signageQueryKeys.schedulesManagementAll).toEqual(['signage-schedules', 'management']);
    expect(signageQueryKeys.pdfsAll).toEqual(['signage-pdfs']);
    expect(signageQueryKeys.emergencyAll).toEqual(['signage-emergency']);
    expect(signageQueryKeys.contentAll).toEqual(['signage-content']);
    expect(signageQueryKeys.renderStatusAll).toEqual(['signage-render-status']);
    expect(signageQueryKeys.webCapturesAll).toEqual(['signage-web-captures']);
    expect(signageQueryKeys.managementOverviewAll).toEqual(['signage-management-overview']);
    expect(signageQueryKeys.kioskPreviewOptionsAll).toEqual(['kiosk-signage-preview-options']);
  });
});
