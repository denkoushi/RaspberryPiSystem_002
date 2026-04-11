import type { SVGAttributes } from 'react';

/** 太めの塗りバーコード（プレビュー HTML の #mp-scan-barcode と同系） */
export function BarcodeBarsIcon(props: SVGAttributes<SVGSVGElement>) {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
      {...rest}
    >
      <rect x="1.5" y="4" width="2.8" height="16" rx="0.6" />
      <rect x="5.8" y="4" width="1.8" height="16" rx="0.5" />
      <rect x="9" y="4" width="3.2" height="16" rx="0.6" />
      <rect x="13.4" y="4" width="1.8" height="16" rx="0.5" />
      <rect x="16.4" y="4" width="2.8" height="16" rx="0.6" />
      <rect x="20.4" y="4" width="2.8" height="16" rx="0.6" />
    </svg>
  );
}
