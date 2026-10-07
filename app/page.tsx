import Link from "next/link";
import { db, facilities, positions, covenants, covenantTests } from "@/lib/db";
import { contractAddresses } from "@/lib/env";
import { formatAtto } from "@/lib/format";
import { ArrowRight, FileText, Scale, Zap } from "lucide-react";
import { desc } from "drizzle-orm";

export const revalidate = 10;

export default async function HomePage() {
  const addrs = contractAddresses();

  // Load real aggregates from database
  const allFacilities = await db().select().from(facilities);
  const allPositions = await db().select().from(positions);
  const allCovenants = await db().select().from(covenants);
  const recentTests = await db()
    .select()
    .from(covenantTests)
    .orderBy(desc(covenantTests.createdAt))
    .limit(5);

  let totalCommittedAtto = 0n;
  let totalDrawnAtto = 0n;
  for (const pos of allPositions) {
    totalCommittedAtto += BigInt(pos.committedAtto || "0");
    totalDrawnAtto += BigInt(pos.drawnAtto || "0");
  }

  const offsideCount = allCovenants.filter(
    (c) => c.status === "breach_pending_cure" || c.status === "breached",
  ).length;

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="space-y-6 pt-4 pb-8 ledger-rule">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-xs text-[var(--ink-2)]">
          <span className="w-2 h-2 rounded-full bg-[var(--signal)] animate-pulse" />
          <span className="font-mono uppercase tracking-wider text-[11px]">
            Live on GenLayer Studionet
          </span>
        </div>

        <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-[var(--ink)] max-w-4xl leading-[1.12]">
          Credit agreements written in plain English, evaluated by intelligent validators.
        </h1>

        <p className="text-base sm:text-lg text-[var(--ink-2)] max-w-3xl leading-relaxed">
          Covenant connects natural language loan conditions directly to vault enforcement.
          Financial covenants, regulatory filings, and treasury thresholds are evaluated continuously.
          Consequences such as draw stops, rate step-ups, and acceleration fire trustlessly on chain.
        </p>

        <div className="pt-2 flex flex-wrap items-center gap-4">
          <Link
            href="/facilities"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <span>Open Consoles</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/evidence"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded border border-[var(--rule-2)] text-[var(--ink)] text-sm font-medium hover:bg-[var(--paper-2)] transition-colors"
          >
            <span>Inspect Evidence Chain</span>
          </Link>
        </div>
      </section>

      {/* Aggregate Portfolio Metrics (Ledger Horizontal Register) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 ledger-rule">
          <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
            Portfolio Register Summary
          </h2>
          <span className="text-xs font-mono text-[var(--ink-3)]">
            Consensus Verified
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-4">
          <div className="space-y-1">
            <div className="text-xs text-[var(--ink-3)] uppercase tracking-wider font-mono">
              Credit Facilities
            </div>
            <div className="text-3xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {allFacilities.length}
            </div>
            <div className="text-xs text-[var(--ink-2)]">
              Registered on chain
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[var(--ink-3)] uppercase tracking-wider font-mono">
              Committed Capital
            </div>
            <div className="text-3xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {formatAtto(totalCommittedAtto.toString())}
            </div>
            <div className="text-xs text-[var(--ink-2)]">
              Drawn: {formatAtto(totalDrawnAtto.toString())}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[var(--ink-3)] uppercase tracking-wider font-mono">
              Active Covenants
            </div>
            <div className="text-3xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {allCovenants.length}
            </div>
            <div className="text-xs text-[var(--ink-2)]">
              Under continuous audit
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[var(--ink-3)] uppercase tracking-wider font-mono">
              Offside Conditions
            </div>
            <div className={`text-3xl font-mono tabular-numbers font-semibold ${
              offsideCount > 0 ? "text-[var(--breach)]" : "text-[var(--ink)]"
            }`}>
              {offsideCount}
            </div>
            <div className="text-xs text-[var(--ink-2)]">
              {offsideCount === 0 ? "All facilities in good standing" : "Pending cure or breached"}
            </div>
          </div>
        </div>
      </section>

      {/* Structural Architecture: The Evidence Citation Chain */}
      <section className="space-y-6 pt-4">
        <div className="pb-2 ledger-rule">
          <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
            How Covenant Enforces Credit Agreements
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="space-y-3 p-5 rounded border border-[var(--rule)] bg-[var(--paper)]">
            <div className="w-8 h-8 rounded flex items-center justify-center bg-[var(--paper-2)] text-[var(--ink)] border border-[var(--rule)]">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="font-serif text-lg font-semibold text-[var(--ink)]">
              1. Plain English Covenants
            </h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Lenders draft credit covenants using standard financial covenants and narrative criteria.
              The registry preserves the legal prose alongside extraction parameters, comparator thresholds,
              and cure periods.
            </p>
          </div>

          <div className="space-y-3 p-5 rounded border border-[var(--rule)] bg-[var(--paper)]">
            <div className="w-8 h-8 rounded flex items-center justify-center bg-[var(--paper-2)] text-[var(--ink)] border border-[var(--rule)]">
              <Scale className="w-4 h-4" />
            </div>
            <h3 className="font-serif text-lg font-semibold text-[var(--ink)]">
              2. Sandboxed Consensus
            </h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Validators re-read public financial sources, SEC filings, and treasury states.
              Language models extract figures with exact source citations; all arithmetic runs
              inside deterministic sandboxes to eliminate hallucinated calculations.
            </p>
          </div>

          <div className="space-y-3 p-5 rounded border border-[var(--rule)] bg-[var(--paper)]">
            <div className="w-8 h-8 rounded flex items-center justify-center bg-[var(--paper-2)] text-[var(--ink)] border border-[var(--rule)]">
              <Zap className="w-4 h-4" />
            </div>
            <h3 className="font-serif text-lg font-semibold text-[var(--ink)]">
              3. Vault Enforcement
            </h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Upon validator consensus on a breach, the covenant monitor emits instructions
              directly to the credit vault. Draws freeze, interest rates step up, or the loan
              accelerates without discretion.
            </p>
          </div>
        </div>
      </section>

      {/* Recent Evidence Trail Register */}
      {recentTests.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between pb-2 ledger-rule">
            <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
              Latest Consensus Evidence
            </h2>
            <Link
              href="/evidence"
              className="text-xs text-[var(--ink-2)] hover:text-[var(--ink)] flex items-center gap-1"
            >
              <span>View full audit log</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {recentTests.map((test) => (
              <div
                key={test.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ledger-row px-2"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-[var(--ink)]">
                      Facility: {test.facilityId}
                    </span>
                    <span className="text-[var(--ink-3)] font-mono">
                      Covenant #{test.covenantIndex}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                      test.breached
                        ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)]"
                        : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
                    }`}>
                      {test.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-[var(--ink-2)] font-serif italic truncate">
                    {test.narrative}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[var(--ink-3)] font-mono text-[11px] shrink-0">
                  <span>{test.testedAt.slice(0, 10)}</span>
                  <Link
                    href={`/evidence/${test.id}`}
                    className="hover:text-[var(--ink)] underline underline-offset-2"
                  >
                    Citation
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Deployed Intelligent Contracts */}
      <section className="space-y-4 pt-4 ledger-rule pb-8">
        <div className="pb-2 ledger-rule">
          <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
            Deployed Contracts On Studionet
          </h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 font-mono text-xs">
          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper-2)] space-y-1">
            <div className="text-[var(--ink-3)] uppercase tracking-wider text-[10px]">
              Facility Registry
            </div>
            <div className="font-medium text-[var(--ink)] truncate" title={addrs.facilityRegistry}>
              {addrs.facilityRegistry}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">
              Agreements & covenant definitions
            </div>
          </div>

          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper-2)] space-y-1">
            <div className="text-[var(--ink-3)] uppercase tracking-wider text-[10px]">
              Covenant Monitor
            </div>
            <div className="font-medium text-[var(--ink)] truncate" title={addrs.covenantMonitor}>
              {addrs.covenantMonitor}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">
              Intelligent validator consensus & sandboxes
            </div>
          </div>

          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper-2)] space-y-1">
            <div className="text-[var(--ink-3)] uppercase tracking-wider text-[10px]">
              Credit Vault
            </div>
            <div className="font-medium text-[var(--ink)] truncate" title={addrs.creditVault}>
              {addrs.creditVault}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">
              Capital commitments, takedowns & enforcement
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
