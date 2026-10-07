import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';

import { kioskClientStatusColor } from './kioskClientStatusColor';

type KioskClientStatusChipProps = {
  clientKey: string;
  clientId: string;
  clientStatus?: { temperature: number | null; cpuUsage: number } | null;
};

function formatKey(value: string) {
  if (!value) return '未設定';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function KioskClientStatusChip({ clientKey, clientId, clientStatus }: KioskClientStatusChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.stopPropagation();
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={anchorRef} className="relative shrink-0" data-kiosk-dock-overlay={isOpen}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="端末の状態"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-11 items-center gap-2.5 whitespace-nowrap rounded-lg border border-inv-line px-3 text-[15px] font-semibold tabular-nums text-inv-text hover:bg-inv-s2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan"
      >
        {clientStatus ? (
          <>
            <span aria-hidden="true" className={clsx('h-2 w-2 shrink-0 rounded-full', kioskClientStatusColor(clientStatus.temperature, clientStatus.cpuUsage))} />
            {clientStatus.temperature !== null ? <span>{clientStatus.temperature.toFixed(1)}<span className="text-inv-muted">°C</span></span> : null}
            <span>{clientStatus.cpuUsage.toFixed(0)}<span className="text-inv-muted">%</span></span>
          </>
        ) : '端末'}
      </button>
      {isOpen ? (
        <div id={popoverId} className="absolute bottom-[calc(100%+60px)] left-0 w-[260px] rounded-[10px] border border-inv-line2 bg-inv-s1 p-[14px] text-inv-text">
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-[13px] [&>dt]:text-[13px] [&>dt]:text-inv-muted [&>dd]:text-right [&>dd]:font-mono [&>dd]:text-sm [&>dd]:whitespace-nowrap">
            <dt>端末</dt><dd>キオスク端末</dd>
            <dt>APIキー</dt><dd>{formatKey(clientKey)}</dd>
            <dt>通話ID</dt><dd>{formatKey(clientId)}</dd>
            {clientStatus?.temperature != null ? <><dt>CPU温度</dt><dd>{clientStatus.temperature.toFixed(1)}°C</dd></> : null}
            {clientStatus ? <><dt>CPU負荷</dt><dd>{clientStatus.cpuUsage.toFixed(0)}%</dd></> : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
