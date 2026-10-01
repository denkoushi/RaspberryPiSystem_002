import { describe, expect, it } from 'vitest';

import { buildHideStyle, isSafeHideSelector } from '../web-page-capturer.js';

describe('isSafeHideSelector', () => {
  it('accepts ordinary selectors', () => {
    expect(isSafeHideSelector('header')).toBe(true);
    expect(isSafeHideSelector('body > div:nth-of-type(2) > aside')).toBe(true);
    expect(isSafeHideSelector('#filters')).toBe(true);
  });

  it('rejects selectors that could escape the style rule', () => {
    expect(isSafeHideSelector('header{} body{background:url(http://x)}')).toBe(false);
    expect(isSafeHideSelector('a;b')).toBe(false);
    expect(isSafeHideSelector('@import "x"')).toBe(false);
    expect(isSafeHideSelector('</style><script>')).toBe(false);
    expect(isSafeHideSelector('   ')).toBe(false);
  });
});

describe('buildHideStyle', () => {
  it('always hides the Hermes floating button and drops unsafe selectors', () => {
    expect(buildHideStyle(['header', 'x{}'])).toBe('.hermes-floating-root,header{display:none !important}');
  });
});
