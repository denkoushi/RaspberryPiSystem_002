import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { __testables } from '../usePalletVisualizationController';

describe('resolveMutationError', () => {
  it('uses API message for axios errors', () => {
    const err = new AxiosError('Request failed with status code 404');
    Object.assign(err, {
      response: {
        data: {
          message: '製造order番号に一致する日程行がないか、選択中の加工機（資源）と一致しません',
          errorCode: 'PALLET_SCHEDULE_NOT_FOUND_FOR_MACHINE',
        },
      },
    });
    expect(__testables.resolveMutationError(err)).toBe(
      '製造order番号に一致する日程行がないか、選択中の加工機（資源）と一致しません'
    );
  });

  it('falls back to native error message', () => {
    expect(__testables.resolveMutationError(new Error('fallback'))).toBe('fallback');
  });
});
