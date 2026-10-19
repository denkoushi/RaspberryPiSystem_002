import { describe, expect, it } from 'vitest';

import { kioskQueryKeys } from './kiosk';

describe('kioskQueryKeys', () => {
  it('preserves constant keys and invalidation prefix lengths', () => {
    expect(kioskQueryKeys.navTabOrderSettingsAll).toEqual(['kiosk-nav-tab-order-settings']);
    expect(kioskQueryKeys.configAll).toEqual(['kiosk-config']);
    expect(kioskQueryKeys.callTargetsAll).toEqual(['kiosk-call-targets']);
    expect(kioskQueryKeys.inquirySummaryAll).toEqual(['kiosk-inquiry-summary']);
    expect(kioskQueryKeys.inquiryReceiverSettingsAll).toEqual(['kiosk-inquiry-receiver-settings']);
  });

  it('preserves employees values, argument order and boundary values', () => {
    expect(kioskQueryKeys.employees('client-1')).toEqual(['kiosk-employees', 'client-1']);
    expect(kioskQueryKeys.employees()).toEqual(['kiosk-employees', undefined]);
    expect(kioskQueryKeys.employees(undefined)).toEqual(['kiosk-employees', undefined]);
    expect(Reflect.apply(kioskQueryKeys.employees, undefined, [{}])).toEqual(['kiosk-employees', {}]);
    expect(Reflect.apply(kioskQueryKeys.employees, undefined, [null])).toEqual(['kiosk-employees', null]);
  });

  it('preserves inquirySummary values, argument order and boundary values', () => {
    expect(kioskQueryKeys.inquirySummary('client-1')).toEqual(['kiosk-inquiry-summary', 'client-1']);
    expect(kioskQueryKeys.inquirySummary()).toEqual(['kiosk-inquiry-summary', undefined]);
    expect(kioskQueryKeys.inquirySummary(undefined)).toEqual(['kiosk-inquiry-summary', undefined]);
    expect(Reflect.apply(kioskQueryKeys.inquirySummary, undefined, [{}])).toEqual(['kiosk-inquiry-summary', {}]);
    expect(Reflect.apply(kioskQueryKeys.inquirySummary, undefined, [null])).toEqual(['kiosk-inquiry-summary', null]);
  });

  it('preserves inquiries values, argument order and boundary values', () => {
    expect(kioskQueryKeys.inquiries('client-1', 'session-1')).toEqual(['kiosk-inquiries', 'client-1', 'session-1']);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, [])).toEqual(['kiosk-inquiries', undefined, undefined]);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, [undefined, undefined])).toEqual(['kiosk-inquiries', undefined, undefined]);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, ['client-1'])).toEqual(['kiosk-inquiries', 'client-1', undefined]);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, [undefined, 'session-1'])).toEqual(['kiosk-inquiries', undefined, 'session-1']);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, [null, null])).toEqual(['kiosk-inquiries', null, null]);
    expect(Reflect.apply(kioskQueryKeys.inquiries, undefined, [{}, {}])).toEqual(['kiosk-inquiries', {}, {}]);
    expect(kioskQueryKeys.inquiries('', '')).toEqual(['kiosk-inquiries', '', '']);
  });
});
