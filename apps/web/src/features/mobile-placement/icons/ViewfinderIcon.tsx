import type { SVGAttributes } from 'react';

/** 棚QR用: 視野枠（プレビュー #mp-icon-viewfinder と同系） */
export function ViewfinderIcon(props: SVGAttributes<SVGSVGElement>) {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      {...rest}
    >
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="8" y="8" width="8" height="8" rx="1" strokeWidth={1.5} opacity={0.85} />
    </svg>
  );
}
