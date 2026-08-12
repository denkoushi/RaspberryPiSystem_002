import { describe, expect, it } from 'vitest';

import { isLoopbackAddress } from '../loopback-address.js';

describe('isLoopbackAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.255',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('accepts loopback address %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each([
    undefined,
    '',
    '127.0.0.999',
    '172.18.0.2',
    '::ffff:172.18.0.2',
    '10.20.30.40',
    '::2',
  ])('rejects non-loopback address %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});
