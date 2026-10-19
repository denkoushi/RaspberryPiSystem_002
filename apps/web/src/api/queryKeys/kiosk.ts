export const kioskQueryKeys = {
  employees: (clientKey?: string) => ['kiosk-employees', clientKey] as const,
  navTabOrderSettingsAll: ['kiosk-nav-tab-order-settings'] as const,
  configAll: ['kiosk-config'] as const,
  callTargetsAll: ['kiosk-call-targets'] as const,
  inquirySummaryAll: ['kiosk-inquiry-summary'] as const,
  inquirySummary: (clientKey?: string) => ['kiosk-inquiry-summary', clientKey] as const,
  inquiries: (clientKey: string, sessionId: string) => ['kiosk-inquiries', clientKey, sessionId] as const,
  inquiryReceiverSettingsAll: ['kiosk-inquiry-receiver-settings'] as const,
};
