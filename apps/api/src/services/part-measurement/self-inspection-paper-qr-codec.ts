import { createHash, randomBytes } from 'node:crypto';

export const SELF_INSPECTION_PAPER_QR_VERSION = 'SIP1';

const PAGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAGE_CODE_LENGTH = 8;

export type SelfInspectionPaperQrPayload = {
  version: typeof SELF_INSPECTION_PAPER_QR_VERSION;
  pageCode: string;
  check: string;
};

export type SelfInspectionPaperQrDecodeResult =
  | { ok: true; payload: SelfInspectionPaperQrPayload }
  | { ok: false; reason: 'format' | 'version' | 'check' };

export class SelfInspectionPaperQrCodec {
  generatePageCode(): string {
    const bytes = randomBytes(PAGE_CODE_LENGTH);
    let code = '';
    for (const byte of bytes) {
      code += PAGE_CODE_ALPHABET[byte % PAGE_CODE_ALPHABET.length];
    }
    return code;
  }

  encode(pageCode: string): string {
    const normalized = this.normalizePageCode(pageCode);
    return `${SELF_INSPECTION_PAPER_QR_VERSION}:${normalized}:${this.computeCheck(normalized)}`;
  }

  decode(payload: string): SelfInspectionPaperQrDecodeResult {
    const parts = payload.trim().split(':');
    if (parts.length !== 3) {
      return { ok: false, reason: 'format' };
    }

    const [version, rawPageCode, rawCheck] = parts;
    if (version !== SELF_INSPECTION_PAPER_QR_VERSION) {
      return { ok: false, reason: 'version' };
    }

    const pageCode = this.normalizePageCode(rawPageCode);
    const check = rawCheck.trim().toUpperCase();
    if (!pageCode || !/^[A-Z0-9]{2}$/.test(check)) {
      return { ok: false, reason: 'format' };
    }

    if (check !== this.computeCheck(pageCode)) {
      return { ok: false, reason: 'check' };
    }

    return {
      ok: true,
      payload: {
        version: SELF_INSPECTION_PAPER_QR_VERSION,
        pageCode,
        check
      }
    };
  }

  private normalizePageCode(pageCode: string | undefined): string {
    return (pageCode ?? '').trim().toUpperCase();
  }

  private computeCheck(pageCode: string): string {
    return createHash('sha256')
      .update(`${SELF_INSPECTION_PAPER_QR_VERSION}:${pageCode}`)
      .digest('hex')
      .slice(0, 2)
      .toUpperCase();
  }
}
