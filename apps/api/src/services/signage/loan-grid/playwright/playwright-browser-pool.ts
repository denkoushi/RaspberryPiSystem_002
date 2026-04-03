import { chromium, type Browser } from 'playwright';

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

/**
 * One shared Chromium per process (signage worker / API in_process).
 * Avoids repeated browser boots on 30s signage interval.
 */
export async function getSharedChromium(): Promise<Browser> {
  if (browserInstance && !browserInstance.isConnected()) {
    browserInstance = null;
  }
  if (browserInstance) {
    return browserInstance;
  }
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    browserInstance = await browserLaunchPromise;
    return browserInstance;
  } finally {
    browserLaunchPromise = null;
  }
}

export async function closeSharedChromium(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // ignore
    }
    browserInstance = null;
  }
  browserLaunchPromise = null;
}
