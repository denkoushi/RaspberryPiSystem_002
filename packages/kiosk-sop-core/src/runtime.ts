import { computeContainedRect, computeLeaderSegment } from './runtimeGeometry.js';

function runKioskSopRuntime(): void {
  const runtimeDocument = globalThis.document;
  const runtimeWindow = globalThis.window;
  const sheets = Array.from(runtimeDocument.querySelectorAll<HTMLElement>('.sheet'));
  let layoutFrame = 0;

  const rectOf = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const activeStepFor = (sheet: HTMLElement): string | null =>
    sheet.dataset.hoveredStep ?? sheet.dataset.selectedStep ?? null;

  const updateActiveStep = (sheet: HTMLElement): void => {
    const activeStep = activeStepFor(sheet);
    sheet.querySelectorAll<HTMLElement>('.step-item').forEach((item) => {
      const active = item.dataset.step === activeStep;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active && item.dataset.step === sheet.dataset.selectedStep ? 'true' : 'false');
    });
    sheet.querySelectorAll<HTMLElement>('.pin').forEach((pin) => {
      pin.classList.toggle('is-active', pin.dataset.pin === activeStep);
    });
    sheet.querySelectorAll<SVGLineElement>('.leader-layer line').forEach((line) => {
      line.classList.toggle('is-active', line.dataset.line === activeStep);
    });
  };

  const layoutSheet = (sheet: HTMLElement): void => {
    const body = sheet.querySelector<HTMLElement>('.body');
    const stage = sheet.querySelector<HTMLElement>('.stage');
    const layer = sheet.querySelector<SVGSVGElement>('.leader-layer');
    if (!body || !stage || !layer || body.clientWidth <= 0 || body.clientHeight <= 0) {
      delete sheet.dataset.kioskSopLayoutReady;
      return;
    }

    const screenWidth = Number(stage.dataset.screenWidth);
    const screenHeight = Number(stage.dataset.screenHeight);
    const imageRect = computeContainedRect(
      stage.clientWidth,
      stage.clientHeight,
      screenWidth,
      screenHeight
    );
    if (imageRect.width <= 0 || imageRect.height <= 0) {
      delete sheet.dataset.kioskSopLayoutReady;
      return;
    }

    sheet.querySelectorAll<HTMLElement>('.pin').forEach((pin) => {
      const targetX = Number(pin.dataset.targetX);
      const targetY = Number(pin.dataset.targetY);
      pin.style.left = `${imageRect.left + imageRect.width * targetX}px`;
      pin.style.top = `${imageRect.top + imageRect.height * targetY}px`;
    });

    layer.setAttribute('viewBox', `0 0 ${body.clientWidth} ${body.clientHeight}`);
    const bodyRect = rectOf(body);
    sheet.querySelectorAll<SVGLineElement>('.leader-layer line').forEach((line) => {
      const step = line.dataset.line;
      const card = sheet.querySelector<HTMLElement>(`.step-item[data-step="${step}"]`);
      const pin = sheet.querySelector<HTMLElement>(`.pin[data-pin="${step}"]`);
      if (!card || !pin) return;
      const segment = computeLeaderSegment(bodyRect, rectOf(card), rectOf(pin));
      line.setAttribute('x1', segment.start.x.toFixed(2));
      line.setAttribute('y1', segment.start.y.toFixed(2));
      line.setAttribute('x2', segment.end.x.toFixed(2));
      line.setAttribute('y2', segment.end.y.toFixed(2));
    });
    sheet.dataset.kioskSopLayoutReady = 'true';
    updateActiveStep(sheet);
  };

  const layoutAll = (): void => {
    layoutFrame = 0;
    sheets.forEach(layoutSheet);
  };

  const requestLayout = (): void => {
    if (layoutFrame !== 0) return;
    layoutFrame = runtimeWindow.requestAnimationFrame(layoutAll);
  };

  sheets.forEach((sheet) => {
    sheet.querySelectorAll<HTMLElement>('.step-item').forEach((item) => {
      const step = item.dataset.step;
      if (!step) return;
      item.addEventListener('click', () => {
        sheet.dataset.selectedStep = step;
        updateActiveStep(sheet);
      });
      item.addEventListener('focus', () => {
        sheet.dataset.selectedStep = step;
        updateActiveStep(sheet);
      });
      item.addEventListener('pointerenter', () => {
        sheet.dataset.hoveredStep = step;
        updateActiveStep(sheet);
      });
      item.addEventListener('pointerleave', () => {
        delete sheet.dataset.hoveredStep;
        updateActiveStep(sheet);
      });
    });
    sheet.querySelectorAll<HTMLImageElement>('.stage > img').forEach((image) => {
      if (!image.complete) image.addEventListener('load', requestLayout, { once: true });
    });
  });

  const ResizeObserverConstructor = Reflect.get(
    runtimeWindow,
    'ResizeObserver'
  ) as typeof ResizeObserver | undefined;
  if (ResizeObserverConstructor) {
    const resizeObserver = new ResizeObserverConstructor(requestLayout);
    sheets.forEach((sheet) => resizeObserver.observe(sheet));
  } else {
    runtimeWindow.addEventListener('resize', requestLayout);
  }
  runtimeDocument.fonts?.ready.then(requestLayout);
  requestLayout();
}

/** Emits a type-checked runtime without introducing an external iframe dependency. */
export function renderKioskSopRuntimeScript(): string {
  return `<script>
const computeContainedRect = ${computeContainedRect.toString()};
const computeLeaderSegment = ${computeLeaderSegment.toString()};
(${runKioskSopRuntime.toString()})();
</script>`;
}
