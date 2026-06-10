import { describe, expect, it } from 'vitest';

import { normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';

describe('kiosk-header-tab-order normalization', () => {
  it('drops unknown ids and appends missing defaults', () => {
    expect(normalizeKioskHeaderTabOrder(['leader_order_board', 'unknown', 'borrow'])).toEqual([
      'leader_order_board',
      'borrow',
      'self_inspection',
      'instruments_borrow',
      'rigging_borrow',
      'production_schedule',
      'manual_order',
      'progress_overview',
      'load_balancing',
      'purchase_order_lookup',
      'pallet_visualization',
      'shelf_master',
      'documents',
      'part_measurement',
      'inspection_drawing',
      'rigging_analytics',
      'due_management',
      'call'
    ]);
  });

  it('deduplicates ids keeping first occurrence', () => {
    expect(
      normalizeKioskHeaderTabOrder(['borrow', 'self_inspection', 'borrow', 'self_inspection'])
    ).toEqual([
      'borrow',
      'self_inspection',
      'instruments_borrow',
      'rigging_borrow',
      'production_schedule',
      'manual_order',
      'leader_order_board',
      'progress_overview',
      'load_balancing',
      'purchase_order_lookup',
      'pallet_visualization',
      'shelf_master',
      'documents',
      'part_measurement',
      'inspection_drawing',
      'rigging_analytics',
      'due_management',
      'call'
    ]);
  });
});
