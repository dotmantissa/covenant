interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

export function Spinner({ size = "md", className = "", label }: SpinnerProps) {
  const dimensions = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-10 h-10",
  }[size];

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div className={`relative ${dimensions} shrink-0`} role="status" aria-label={label || "Loading"}>
        {/* Outer orbital track */}
        <svg
          className="w-full h-full animate-spin"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Subtle static guide circle */}
          <circle
            cx="20"
            cy="20"
            r="16"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeOpacity="0.12"
          />
          {/* Dynamic consensus arc */}
          <path
            d="M 20 4 A 16 16 0 0 1 36 20"
            stroke="var(--signal)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* Second trailing validator node */}
          <circle
            cx="36"
            cy="20"
            r="2.5"
            fill="var(--signal)"
          />
          <circle
            cx="20"
            cy="36"
            r="1.5"
            fill="currentColor"
            fillOpacity="0.3"
          />
        </svg>
      </div>
      {label && (
        <span className="text-xs font-mono uppercase tracking-wider text-[var(--ink-2)]">
          {label}
        </span>
      )}
    </div>
  );
}

export function PageLoading({ message = "Querying GenLayer Consensus..." }: { message?: string }) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Spinner size="lg" />
      <div className="space-y-1">
        <p className="text-sm font-mono tracking-wide text-[var(--ink)] font-medium">
          {message}
        </p>
        <p className="text-xs text-[var(--ink-3)] font-sans">
          Verifying validator quorum and ledger state
        </p>
      </div>
    </div>
  );
}
