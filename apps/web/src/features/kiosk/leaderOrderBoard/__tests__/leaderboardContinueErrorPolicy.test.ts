import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import {
  classifyLeaderboardContinueFailure,
  normalizeLeaderboardContinueFailure
} from '../leaderboardContinueErrorPolicy';

function axiosWithStatus(status: number): AxiosError {
  const err = new AxiosError(`${status}`, undefined, {} as never, {}, {
    status,
    statusText: String(status),
    data: {},
    headers: {},
    config: {} as never
  });
  return err;
}

describe('leaderboardContinueErrorPolicy', () => {
  describe('normalizeLeaderboardContinueFailure', () => {
    it('Error をそのまま返す', () => {
      const e = new Error('x');
      expect(normalizeLeaderboardContinueFailure(e)).toBe(e);
    });

    it('非 Error を Error に包む', () => {
      const e = normalizeLeaderboardContinueFailure('oops');
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('oops');
    });
  });

  describe('classifyLeaderboardContinueFailure', () => {
    it('axios 応答未取得は transient（Network Error 相当）', () => {
      const err = new AxiosError('Network Error');
      expect(err.response).toBeUndefined();
      expect(classifyLeaderboardContinueFailure(err)).toBe('transient');
    });

    it('5xx は transient', () => {
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(502))).toBe('transient');
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(503))).toBe('transient');
    });

    it('408/429 は transient', () => {
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(408))).toBe('transient');
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(429))).toBe('transient');
    });

    it('4xx（408/429 以外）は terminal', () => {
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(400))).toBe('terminal');
      expect(classifyLeaderboardContinueFailure(axiosWithStatus(401))).toBe('terminal');
    });

    it('axios 以外は terminal', () => {
      expect(classifyLeaderboardContinueFailure(new TypeError('x'))).toBe('terminal');
    });
  });
});
