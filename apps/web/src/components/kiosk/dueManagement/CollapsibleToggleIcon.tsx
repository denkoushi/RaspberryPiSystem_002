type CollapsibleToggleIconProps = {
  isOpen: boolean;
  ariaLabel: string;
};

export function CollapsibleToggleIcon(props: CollapsibleToggleIconProps) {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center" role="img" aria-label={props.ariaLabel}>
      <svg
        viewBox="0 0 24 24"
        className={`h-3 w-3 transition-transform ${props.isOpen ? 'rotate-180' : 'rotate-0'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
