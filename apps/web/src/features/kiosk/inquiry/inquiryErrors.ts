import axios from 'axios';

export function inquiryErrorCode(error: unknown): string | undefined {
  return axios.isAxiosError(error) ? error.response?.data?.errorCode : undefined;
}

export function isInquiryAccessError(error: unknown): boolean {
  const code = inquiryErrorCode(error);
  return code === 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED' || code === 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED';
}

export function inquiryErrorMessage(error: unknown, fallback: string): string {
  switch (inquiryErrorCode(error)) {
    case 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED': return 'この社員証では開けません';
    case 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED': return '社員証をタッチ';
    case 'KIOSK_INQUIRY_NOT_FOUND': return 'お問い合わせが見つかりません';
    default: return fallback;
  }
}
