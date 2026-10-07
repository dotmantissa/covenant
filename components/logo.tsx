import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 group ${className}`}>
      <div className="w-5 h-5 rounded-sm border border-[var(--ink-2)] flex items-center justify-center relative overflow-hidden bg-[var(--paper)]">
        <div className="w-full h-[1px] bg-[var(--ink-3)] absolute top-1.5" />
        <div className="w-full h-[1px] bg-[var(--ink-3)] absolute top-3" />
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--signal)] absolute bottom-0.5 right-0.5" />
      </div>
      <span className="font-serif text-lg font-semibold tracking-tight text-[var(--ink)]">
        Covenant
      </span>
      <span className="text-[10px] tracking-widest uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--paper-2)] text-[var(--ink-2)] border border-[var(--rule)]">
        studionet
      </span>
    </Link>
  );
}
