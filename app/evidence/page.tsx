"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { apiFetch } from "@/lib/client-api";
import { formatAtto, formatBp } from "@/lib/format";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Filter,
  RefreshCw,
} from "lucide-react";

type EvidenceItem = {
  id: number;
  facilityId: string;
  covenantIndex: number;
  sequence: number;
  kind: string;
  testedAt: string;
  breached: boolean;
  status: string;
  citation: string;
  locator: string;
  asOf: string;
  numeratorMilli: string;
  denominatorMilli: string;
  observedBp: number;
  observedAtto: string;
  thresholdBp: number;
  narrative: string;
  consequenceApplied: string;
  txHash: string | null;
  triggeredBy: string;
  createdAt: string;
};

function EvidenceListContent() {
  const searchParams = useSearchParams();
  const facilityFilter = searchParams.get("facilityId") || "";

  const { ready, authenticated, getAccessToken } = usePrivy();
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFacility, setActiveFacility] = useState(facilityFilter);

  const fetchEvidence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authenticated ? await getAccessToken() : null;
      const url = activeFacility
        ? `/api/evidence?facilityId=${encodeURIComponent(activeFacility)}&limit=50`
        : "/api/evidence?limit=50";
      const res = await apiFetch<{ evidence: EvidenceItem[] }>(url, {}, token);
      setEvidence(res.evidence);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evidence trail");
    } finally {
      setLoading(false);
    }
  }, [authenticated, activeFacility, getAccessToken]);

  useEffect(() => {
    if (ready) {
      void fetchEvidence();
    }
  }, [ready, fetchEvidence]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 ledger-rule">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-[var(--ink)]">
              Evidence Citation Chain
            </h1>
            <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink-2)]">
              Anti-Hallucination Audit Trail
            </span>
          </div>
          <p className="text-xs text-[var(--ink-2)]">
            Every finding cites the specific source artifact, extracted figures, and sandboxed calculation verified by consensus.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchEvidence()}
          className="inline-flex items-center gap-1.5 p-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer self-start sm:self-auto"
          title="Refresh evidence trail"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Filter by facility */}
      <div className="flex items-center gap-3">
        <Filter className="w-3.5 h-3.5 text-[var(--ink-3)]" />
        <span className="text-xs font-mono text-[var(--ink-3)] uppercase tracking-wider">
          Filter by Facility:
        </span>
        <input
          type="text"
          value={activeFacility}
          onChange={(e) => setActiveFacility(e.target.value)}
          placeholder="All Facilities (or enter ID)"
          className="px-3 py-1 rounded text-xs bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)] max-w-xs"
        />
        {activeFacility && (
          <button
            type="button"
            onClick={() => setActiveFacility("")}
            className="text-xs text-[var(--ink-2)] hover:text-[var(--ink)] underline cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* Evidence Table */}
      {error ? (
        <div className="p-4 rounded border border-[rgba(168,48,30,0.2)] bg-[rgba(168,48,30,0.05)] text-xs text-[var(--breach)]">
          {error}
        </div>
      ) : evidence.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--rule)] rounded space-y-2">
          <div className="font-serif italic text-sm text-[var(--ink-2)]">
            {loading ? "Reading evidence trail..." : "No consensus findings recorded yet."}
          </div>
          <div className="text-xs text-[var(--ink-3)]">
            Run a covenant test from any facility console to generate the first verified citation.
          </div>
        </div>
      ) : (
        <div className="border border-[var(--rule)] rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--paper-2)] border-b border-[var(--rule)] text-[10px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
                  <th className="py-3 px-4">Test Date / Clock</th>
                  <th className="py-3 px-4">Facility & Clause</th>
                  <th className="py-3 px-4">Observed vs Threshold</th>
                  <th className="py-3 px-4">Cited Artifact / Locator</th>
                  <th className="py-3 px-4">Consensus Narrative</th>
                  <th className="py-3 px-4">Status & Enforcement</th>
                  <th className="py-3 px-4 text-right">Citation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rule)]">
                {evidence.map((item) => (
                  <tr key={item.id} className="ledger-row">
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[var(--ink)] whitespace-nowrap">
                      <div>{item.testedAt.slice(0, 10)}</div>
                      <div className="text-[10px] text-[var(--ink-3)]">{item.testedAt.slice(11, 19)} UTC</div>
                    </td>

                    <td className="py-3.5 px-4 font-mono space-y-0.5">
                      <Link
                        href={`/facilities/${encodeURIComponent(item.facilityId)}`}
                        className="text-[var(--ink)] hover:underline font-medium block"
                      >
                        {item.facilityId}
                      </Link>
                      <div className="text-[10px] text-[var(--ink-3)]">
                        Clause #{item.covenantIndex} &middot; seq #{item.sequence}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono tabular-numbers space-y-0.5">
                      <div className="text-[var(--ink)]">
                        {item.kind === "ratio"
                          ? `Observed: ${formatBp(item.observedBp, true)}`
                          : item.kind === "treasury"
                          ? `Holds: ${formatAtto(item.observedAtto)}`
                          : `${item.observedBp} days elapsed`}
                      </div>
                      <div className="text-[10px] text-[var(--ink-3)]">
                        Target: {item.kind === "ratio" ? formatBp(item.thresholdBp, true) : `${item.thresholdBp} bp`}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] space-y-0.5 max-w-xs">
                      <div className="truncate text-[var(--ink)]" title={item.citation}>
                        {item.citation || "No citation identifier"}
                      </div>
                      {item.locator && (
                        <div className="text-[10px] text-[var(--ink-3)] truncate" title={item.locator}>
                          Locator: {item.locator}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-serif text-[12px] italic text-[var(--ink-2)] max-w-md">
                      <div className="line-clamp-2" title={item.narrative}>
                        {item.narrative}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 space-y-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                        item.breached
                          ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)]"
                          : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
                      }`}>
                        {item.breached ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                        <span>{item.status.replace(/_/g, " ")}</span>
                      </span>

                      {item.consequenceApplied && item.consequenceApplied !== "none" && (
                        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--breach)]">
                          {item.consequenceApplied.replace(/_/g, " ")}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/evidence/${item.id}`}
                        className="inline-flex items-center gap-1 text-xs text-[var(--ink)] font-medium hover:underline underline-offset-2"
                      >
                        <span>Audit</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EvidencePage() {
  return (
    <Suspense fallback={
      <div className="text-center py-24 font-serif italic text-sm text-[var(--ink-2)]">
        Loading evidence trail...
      </div>
    }>
      <EvidenceListContent />
    </Suspense>
  );
}
