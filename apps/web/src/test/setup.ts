import '@testing-library/jest-dom';

// jsdom has no Network Information API; tests run as if the device is on Wi-Fi unless they stub otherwise.
if (typeof navigator !== 'undefined' && !('connection' in navigator)) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: Object.assign(new EventTarget(), { type: 'wifi' }),
  });
}
