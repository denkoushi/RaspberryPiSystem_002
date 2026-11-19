import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { AssemblyProcedureCropView } from './features/assembly/AssemblyProcedureCropView';
import { AssemblyProcedureOverlayLayer } from './features/assembly/AssemblyProcedureOverlayLayer';
import './index.css';
import './assembly-procedure-print.css';

import type { ProcedureManualPrintPayload } from '@raspi-system/shared-types';

function BandText({ text, grow = false, right = false }: { text: string; grow?: boolean; right?: boolean }) {
  const field = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = field.current!;
    const label = container.firstElementChild as HTMLElement;
    const fit = () => {
      const scale = Math.min(1, container.clientWidth / Math.max(1, label.offsetWidth));
      label.style.transform = `scaleX(${scale})`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(label);
    fit();
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={field} className="procedure-print-field" style={{
      flexGrow: grow ? 1 : 0,
      textAlign: right ? 'right' : 'left',
      justifyContent: right ? 'end' : 'start'
    }}>
      <span style={{ transformOrigin: right ? 'right' : 'left' }}>{text}</span>
    </span>
  );
}

function PrintPage(print: ProcedureManualPrintPayload) {
  return (
    <main className="procedure-print" data-procedure-print>
      <header className="procedure-print-band">
        <BandText text={print.title} grow />
        <BandText text={print.revisionLabel} />
        <BandText text={print.pageLabel} right />
      </header>
      <div className="procedure-print-page">
        <AssemblyProcedureCropView pageUrl={print.pageUrl} crop={print.crop} overlay={
          <AssemblyProcedureOverlayLayer elements={print.overlays} crop={print.crop} assets={print.assets} />
        } />
        <div className="procedure-print-watermark">{print.watermark}</div>
      </div>
      <footer className="procedure-print-band">
        <BandText text={print.informationLabel} grow />
        <BandText text={print.outputLabel} right />
      </footer>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
let pageKey = 0;
Object.assign(window, {
  renderProcedureManualPrint(print: ProcedureManualPrintPayload) {
    flushSync(() => root.render(<PrintPage key={++pageKey} {...print} />));
  }
});
