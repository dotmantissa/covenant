"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { apiFetch } from "@/lib/client-api";
import { formatAddress, formatAtto, formatBp, formatIsoDate } from "@/lib/format";
import { PageLoading } from "@/components/spinner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

type EvidenceDetailResponse = {
  test: {
    id: number;
    facilityId: string;
    covenantIndex: number;
    sequence: number;
    kind: string;
    testedAt: string;
    breached: boolean;
    status: string;
    sourceUrls: string[];
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
    leaderAddress: string | null;
    triggeredBy: string;
    createdAt: string;
  };
  facility: {
    facilityId: string;
    borrowerName: string;
    borrowerAddress: string;
    lenderAddress: string;
    principalAtto: string;
    rateBp: number;
  } | null;
  covenant: {
    text: string;
    metric: string;
    comparator: string;
    thresholdBp: number;
    thresholdAtto: string;
    breachConsequence: string;
    testFrequencyHours: number;
  } | null;
};

export default function EvidenceCitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: testIdStr } = use(params);
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [data, setData] = useState<EvidenceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      setLoading(true);
      setError(null);
      try {
        const token = authenticated ? await getAccessToken() : null;
        const res = await apiFetch<EvidenceDetailResponse>(
          `/api/evidence/${testIdStr}`,
          {},
          token,
        );
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load citation");
      } finally {
        setLoading(false);
      }
    }

    if (ready) {
      void fetchDetail();
    }
  }, [ready, authenticated, testIdStr, getAccessToken]);

  if (loading) {
    return <PageLoading message="Retrieving consensus citation audit trail..." />;
  }

  if (!data || error) {
    return (
      <div className="space-y-4">
        <Link href="/evidence" className="inline-flex items-center gap-1 text-xs text-[var(--ink-2)] hover:text-[var(--ink)]">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Evidence Chain</span>
        </Link>
        <div className="p-4 rounded border border-[rgba(168,48,30,0.2)] bg-[rgba(168,48,30,0.05)] text-xs text-[var(--breach)]">
          {error || "Citation not found."}
        </div>
      </div>
    );
  }

  const { test, facility, covenant } = data;

  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      {/* Navigation Breadcrumb */}
      <div className="pb-2 ledger-rule">
        <Link
          href="/evidence"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Evidence Citation Chain</span>
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold text-[var(--ink)]">
            Consensus Citation Audit #{test.id}
          </h1>
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono uppercase tracking-wider ${
            test.breached
              ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)] font-semibold"
              : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
          }`}>
            {test.breached ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>{test.status.replace(/_/g, " ")}</span>
          </span>
        </div>

        <div className="text-xs font-mono text-[var(--ink-2)]">
          Facility:{" "}
          <Link
            href={`/facilities/${encodeURIComponent(test.facilityId)}`}
            className="text-[var(--ink)] hover:underline font-semibold"
          >
            {test.facilityId}
          </Link>{" "}
          &middot; Clause #{test.covenantIndex} &middot; Tested at {formatIsoDate(test.testedAt)}
          {facility && (
            <span className="text-[var(--ink-3)]">
              {" "}&middot; Borrower: {facility.borrowerName}
            </span>
          )}
        </div>
      </div>

      {/* Agreement Clause Summary */}
      {covenant && (
        <div className="p-5 rounded bg-[var(--paper-2)] border border-[var(--rule)] space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
            Tested Covenant Promise
          </div>
          <p className="font-serif text-base italic text-[var(--ink)] leading-relaxed">
            &ldquo;{covenant.text}&rdquo;
          </p>
          <div className="text-xs font-mono text-[var(--ink-2)] pt-1 flex flex-wrap gap-4">
            <span>Kind: {test.kind}</span>
            <span>Comparator: {covenant.comparator}</span>
            <span>Consequence: {covenant.breachConsequence.replace(/_/g, " ")}</span>
          </div>
        </div>
      )}

      {/* The Evidence Citation Chain (Signature element) */}
      <section className="space-y-6">
        <div className="pb-2 ledger-rule">
          <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
            The Verified Citation Chain
          </h2>
        </div>

        <div className="space-y-4">
          {/* Link 1: Source Artifact */}
          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-3)] uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-[var(--paper-2)] border border-[var(--rule)] flex items-center justify-center text-[10px] text-[var(--ink)] font-semibold">
                1
              </span>
              <span>Source Artifact & Citation Identifier</span>
            </div>

            <div className="space-y-1 pl-7 text-xs">
              <div className="font-mono font-medium text-[var(--ink)]">
                {test.citation || "No citation identifier provided"}
              </div>
              {test.locator && (
                <div className="text-[var(--ink-2)] font-mono text-[11px]">
                  Locator: {test.locator}
                </div>
              )}
              {test.asOf && (
                <div className="text-[var(--ink-3)] font-mono text-[11px]">
                  Artifact Date: {test.asOf}
                </div>
              )}
              {test.sourceUrls.length > 0 && (
                <div className="pt-1 space-y-0.5">
                  <span className="text-[10px] uppercase font-mono text-[var(--ink-3)] block">
                    Public URLs Re-read by Validators:
                  </span>
                  {test.sourceUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--ink-2)] hover:text-[var(--ink)] underline truncate max-w-full"
                    >
                      <span>{url}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Link 2: Extracted Figures */}
          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-3)] uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-[var(--paper-2)] border border-[var(--rule)] flex items-center justify-center text-[10px] text-[var(--ink)] font-semibold">
                2
              </span>
              <span>Named Extraction Figures</span>
            </div>

            <div className="pl-7 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
              {test.kind === "ratio" && (
                <>
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase text-[var(--ink-3)]">Numerator Figure</span>
                    <div className="text-sm font-semibold text-[var(--ink)] tabular-numbers">
                      {(Number(test.numeratorMilli) / 1000).toLocaleString("en-US")}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase text-[var(--ink-3)]">Denominator Figure</span>
                    <div className="text-sm font-semibold text-[var(--ink)] tabular-numbers">
                      {(Number(test.denominatorMilli) / 1000).toLocaleString("en-US")}
                    </div>
                  </div>
                </>
              )}

              {test.kind === "treasury" && (
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase text-[var(--ink-3)]">Treasury Balance</span>
                  <div className="text-sm font-semibold text-[var(--ink)] tabular-numbers">
                    {formatAtto(test.observedAtto)}
                  </div>
                </div>
              )}

              {test.kind === "filing" && (
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase text-[var(--ink-3)]">Days Elapsed</span>
                  <div className="text-sm font-semibold text-[var(--ink)] tabular-numbers">
                    {test.observedBp} days
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Link 3: Sandboxed Deterministic Calculation */}
          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-3)] uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-[var(--paper-2)] border border-[var(--rule)] flex items-center justify-center text-[10px] text-[var(--ink)] font-semibold">
                3
              </span>
              <span>Sandboxed Arithmetic & Consensus Narrative</span>
            </div>

            <div className="pl-7 space-y-2 text-xs">
              <div className="p-3 rounded bg-[var(--paper-2)] border border-[var(--rule)] font-mono text-[11px] space-y-1">
                <div className="text-[var(--ink-3)] uppercase text-[10px]">Deterministic Output</div>
                <div className="text-[var(--ink)] font-semibold">
                  Observed: {test.kind === "ratio" ? formatBp(test.observedBp, true) : test.observedBp.toString()}{" "}
                  vs Threshold: {test.kind === "ratio" ? formatBp(test.thresholdBp, true) : test.thresholdBp.toString()}
                </div>
              </div>

              <div className="font-serif italic text-sm text-[var(--ink)] leading-relaxed pt-1">
                &ldquo;{test.narrative}&rdquo;
              </div>
            </div>
          </div>

          {/* Link 4: Enforced Vault Consequence */}
          <div className="p-4 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-3)] uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-[var(--paper-2)] border border-[var(--rule)] flex items-center justify-center text-[10px] text-[var(--ink)] font-semibold">
                4
              </span>
              <span>Vault Enforcement Action</span>
            </div>

            <div className="pl-7 text-xs font-mono space-y-1">
              <div className="text-[var(--ink)] font-medium">
                Consequence:{" "}
                <span className="uppercase text-[var(--breach)] font-semibold">
                  {test.consequenceApplied || "None"}
                </span>
              </div>
              <p className="text-[var(--ink-2)] text-[11px]">
                {test.breached
                  ? "Enforcement instruction emitted to CreditVault contract upon consensus finalization."
                  : "All tested metrics remain within agreed parameters; facility remains active."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* On-Chain Transaction Metadata */}
      {test.txHash && (
        <section className="p-4 rounded bg-[var(--paper-2)] border border-[var(--rule)] space-y-2 text-xs font-mono">
          <div className="text-[10px] uppercase text-[var(--ink-3)]">
            GenLayer Transaction Proof
          </div>
          <div className="text-[var(--ink)] truncate" title={test.txHash}>
            Hash: {test.txHash}
          </div>
          {test.leaderAddress && (
            <div className="text-[var(--ink-2)] text-[11px] truncate">
              Consensus Leader: {formatAddress(test.leaderAddress)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
