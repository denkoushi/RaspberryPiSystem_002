import clsx from 'clsx';
import { useEffect, useRef } from 'react';

import { buildSignalAxisTicks, SIGNAL_CATEGORY_COLORS, SIGNAL_DAY_SECONDS } from './machineSignalViewModel';

const ALARM_CATEGORY_INDEXES = new Set([1, 3]);
const NO_RECORD_INDEX = 5;

/** 明るい地に置くときの6区分の色。待機と記録なしを、地に合わせて薄くする。 */
const LIGHT_CATEGORY_COLORS = ['#2fb170', '#f58a3c', '#e3c53a', '#e5484d', '#93a1b3', '#e3e8ee'] as const;

function paint(
  canvas: HTMLCanvasElement,
  timeline: ReadonlyArray<readonly [number, number, number]>,
  colors: ReadonlyArray<string>
) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  // 短い異常が他の区分に埋もれないよう、異常は最後に最低1pxの幅で描く。
  for (const alarmPass of [false, true]) {
    for (const [start, duration, category] of timeline) {
      const isAlarm = ALARM_CATEGORY_INDEXES.has(category);
      if (category === NO_RECORD_INDEX || isAlarm !== alarmPass) continue;
      context.fillStyle = colors[category];
      context.fillRect(
        (start / SIGNAL_DAY_SECONDS) * width,
        0,
        Math.max(isAlarm ? ratio : 0.5, (duration / SIGNAL_DAY_SECONDS) * width),
        height
      );
    }
  }
}

/** 1台の24時間を、共通6区分の色の帯で描く。 */
export function SignalBand({
  timeline,
  className,
  label,
  tone = 'dark'
}: {
  timeline: ReadonlyArray<readonly [number, number, number]>;
  className?: string;
  label: string;
  /** 帯の地の色。キオスクは暗い地、管理画面は明るい地 */
  tone?: 'dark' | 'light';
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const colors = tone === 'dark' ? SIGNAL_CATEGORY_COLORS : LIGHT_CATEGORY_COLORS;
    paint(canvas, timeline, colors);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => paint(canvas, timeline, colors));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [timeline, tone]);

  return <canvas ref={ref} role="img" aria-label={label} className={clsx('block w-full rounded-[3px]', tone === 'dark' ? 'bg-[#1a2533]' : 'bg-[#e3e8ee]', className)} />;
}

/** 帯と同じ幅で並べる時間軸（4時間ごと）。 */
export function SignalAxis({ dayStartMinute, className }: { dayStartMinute: number; className?: string }) {
  const ticks = buildSignalAxisTicks(dayStartMinute);
  return (
    <div className={clsx('relative font-mono text-xs text-[#8b9cb2]', className)} aria-hidden="true">
      {ticks.map((tick, index) => (
        <span
          key={index}
          className="absolute top-0"
          style={{
            left: `${tick.position * 100}%`,
            transform: index === 0 ? undefined : index === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)'
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}
