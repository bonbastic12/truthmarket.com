/** The Truth Market mark: a white check on a blue rounded square. Same artwork as /logo-mark.svg. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#1D5BFF" />
      <path d="M17 33.500l10.500 10.500L47 20" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo({ markClassName }: { markClassName?: string }) {
  return (
    <span className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
      <LogoMark className={markClassName} />
      Truth Market
    </span>
  );
}
