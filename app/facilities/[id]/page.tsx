"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { apiFetch } from "@/lib/client-api";
import { formatAddress, formatAtto, formatBp, formatIsoDate } from "@/lib/format";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FilePlus,
  Play,
  RefreshCw,
  X,
} from "lucide-react";

type FacilityDetail = {
  facilityId: string;
  lenderAddress: string;
  borrowerAddress: string;
  borrowerName: string;
  purpose: string;
  principalAtto: string;
  rateBp: number;
  stepUpBp: number;
  status: string;
  treasuryRpcUrl: string;
  treasuryAddress: string;
  governanceUrl: string;
  chainCreatedAt: string;
  lenderEmail: string | null;
  borrowerEmail: string | null;
};

type PositionDetail = {
  committedAtto: string;
  drawnAtto: string;
  accruedInterestAtto: string;
  effectiveRateBp: number;
  drawFrozen: boolean;
  accelerated: boolean;
};

type CovenantDetail = {
  covenantIndex: number;
  text: string;
  kind: string;
  metric: string;
  numeratorLabel: string;
  denominatorLabel: string;
  thresholdBp: number;
  thresholdAtto: string;
  comparator: string;
  testFrequencyHours: number;
  curePeriodHours: number;
  filingDeadlineDays: number;
  breachConsequence: string;
  sourceUrls: string[];
  status: string;
  observedBp: number;
  observedAtto: string;
  evidenceRef: string;
  lastTestedAt: string;
  nextDueAt: string;
  cureDeadline: string;
  testCount: number;
  breachCount: number;
  appealStatus: string;
  appealBondAtto: string;
};

type TestRow = {
  id: number;
  covenantIndex: number;
  testedAt: string;
  breached: boolean;
  status: string;
  narrative: string;
  consequenceApplied: string;
  txHash: string | null;
};

export default function FacilityConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: facilityId } = use(params);
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [covenants, setCovenants] = useState<CovenantDetail[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals state
  const [modalType, setModalType] = useState<
    "commit" | "draw" | "repay" | "withdraw" | "add_covenant" | "appeal" | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Action form inputs
  const [actionAmountGen, setActionAmountGen] = useState("");
  const [selectedCovenantIndex, setSelectedCovenantIndex] = useState<number | null>(null);
  const [appealBondGen, setAppealBondGen] = useState("10");

  // Covenant drafting inputs
  const [covText, setCovText] = useState("");
  const [covKind, setCovKind] = useState("ratio");
  const [covMetric, setCovMetric] = useState("Leverage Ratio");
  const [covNumLabel, setCovNumLabel] = useState("Total Debt");
  const [covDenomLabel, setCovDenomLabel] = useState("EBITDA");
  const [covThresholdVal, setCovThresholdVal] = useState("3.5");
  const [covComparator, setCovComparator] = useState("lte");
  const [covFrequencyHours, setCovFrequencyHours] = useState("24");
  const [covCureHours, setCovCureHours] = useState("72");
  const [covDeadlineDays, setCovDeadlineDays] = useState("45");
  const [covConsequence, setCovConsequence] = useState("draw_stop");
  const [covUrls, setCovUrls] = useState("");

  const loadData = useCallback(async (refreshFromChain = false) => {
    setLoading(true);
    setError(null);
    try {
      const token = authenticated ? await getAccessToken() : null;
      const url = `/api/facilities/${encodeURIComponent(facilityId)}${refreshFromChain ? "?refresh=true" : ""}`;
      const res = await apiFetch<{
        facility: FacilityDetail;
        position: PositionDetail | null;
        covenants: CovenantDetail[];
        tests: TestRow[];
      }>(url, {}, token);

      setFacility(res.facility);
      setPosition(res.position);
      setCovenants(res.covenants);
      setTests(res.tests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load facility data");
    } finally {
      setLoading(false);
    }
  }, [authenticated, facilityId, getAccessToken]);

  useEffect(() => {
    if (ready) {
      void loadData();
    }
  }, [ready, loadData]);

  // Handle Capital Operations (commit, draw, repay, withdraw)
  const handleCapitalAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalType) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const token = await getAccessToken();
      const amountAtto = (BigInt(Math.floor(parseFloat(actionAmountGen) * 100)) * 10n ** 16n).toString();

      await apiFetch(
        `/api/facilities/${encodeURIComponent(facilityId)}/${modalType}`,
        {
          method: "POST",
          body: JSON.stringify({ amountAtto }),
        },
        token,
      );

      setActionSuccess(`Capital ${modalType} executed successfully on chain.`);
      setModalType(null);
      setActionAmountGen("");
      await loadData(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to execute ${modalType}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Covenant Drafting
  const handleDraftCovenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionError(null);

    try {
      const token = await getAccessToken();
      const thresholdBp = Math.round(parseFloat(covThresholdVal) * 10000);
      const thresholdAtto = (BigInt(Math.floor(parseFloat(covThresholdVal) || 0)) * 10n ** 18n).toString();
      const sourceUrls = covUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);

      await apiFetch(
        `/api/facilities/${encodeURIComponent(facilityId)}/covenants`,
        {
          method: "POST",
          body: JSON.stringify({
            text: covText.trim(),
            kind: covKind,
            metric: covMetric.trim(),
            numeratorLabel: covNumLabel.trim(),
            denominatorLabel: covDenomLabel.trim(),
            thresholdBp: covKind === "ratio" ? thresholdBp : 0,
            thresholdAtto: covKind === "treasury" ? thresholdAtto : "0",
            comparator: covComparator,
            testFrequencyHours: parseInt(covFrequencyHours, 10),
            curePeriodHours: parseInt(covCureHours, 10),
            filingDeadlineDays: parseInt(covDeadlineDays, 10),
            breachConsequence: covConsequence,
            sourceUrls,
          }),
        },
        token,
      );

      setActionSuccess("Covenant agreement drafted and stored on chain.");
      setModalType(null);
      setCovText("");
      setCovUrls("");
      await loadData(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to draft covenant");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Testing a Covenant
  const handleTestCovenant = async (covenantIndex: number) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const token = await getAccessToken();
      await apiFetch(
        `/api/facilities/${encodeURIComponent(facilityId)}/covenants/${covenantIndex}/test`,
        { method: "POST" },
        token,
      );
      setActionSuccess(`Covenant #${covenantIndex} tested by GenLayer validators.`);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test execution failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Appealing a Covenant Breach
  const handleAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCovenantIndex === null) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const token = await getAccessToken();
      const bondAtto = (BigInt(Math.floor(parseFloat(appealBondGen) || 1)) * 10n ** 18n).toString();

      await apiFetch(
        `/api/facilities/${encodeURIComponent(facilityId)}/covenants/${selectedCovenantIndex}/appeal`,
        {
          method: "POST",
          body: JSON.stringify({ bondAtto }),
        },
        token,
      );

      setActionSuccess(`Appeal bond posted for Covenant #${selectedCovenantIndex}.`);
      setModalType(null);
      await loadData(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Appeal submission failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Resolving an Appeal
  const handleResolveAppeal = async (covenantIndex: number) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const token = await getAccessToken();
      await apiFetch(
        `/api/facilities/${encodeURIComponent(facilityId)}/covenants/${covenantIndex}/resolve-appeal`,
        { method: "POST" },
        token,
      );
      setActionSuccess(`Appeal for Covenant #${covenantIndex} resolved on chain.`);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve appeal");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !facility) {
    return (
      <div className="text-center py-24 space-y-2">
        <div className="font-serif italic text-sm text-[var(--ink-2)]">
          Reading credit facility and on-chain covenants...
        </div>
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="space-y-4">
        <Link href="/facilities" className="inline-flex items-center gap-1 text-xs text-[var(--ink-2)] hover:text-[var(--ink)]">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Register</span>
        </Link>
        <div className="p-4 rounded border border-[rgba(168,48,30,0.2)] bg-[rgba(168,48,30,0.05)] text-xs text-[var(--breach)]">
          {error || "Credit facility not found."}
        </div>
      </div>
    );
  }

  const isAccelerated = facility.status === "accelerating" || position?.accelerated;
  const isDrawFrozen = facility.status === "draw_stopped" || position?.drawFrozen;
  const committedVal = position ? BigInt(position.committedAtto || "0") : 0n;
  const drawnVal = position ? BigInt(position.drawnAtto || "0") : 0n;
  const availableVal = committedVal > drawnVal ? committedVal - drawnVal : 0n;

  return (
    <div className="space-y-10">
      {/* Navigation Breadcrumb & Live Refresh */}
      <div className="flex items-center justify-between pb-2 ledger-rule">
        <Link
          href="/facilities"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Credit Facilities Register</span>
        </Link>

        <button
          type="button"
          onClick={() => void loadData(true)}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? "animate-spin" : ""}`} />
          <span>Sync from chain</span>
        </button>
      </div>

      {actionSuccess && (
        <div className="p-3 rounded bg-[var(--paper-2)] border border-[var(--signal)] text-xs text-[var(--signal-ink)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[var(--signal)]" />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess(null)} className="cursor-pointer text-[var(--ink-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Facility Terms Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-bold tracking-tight text-[var(--ink)]">
                {facility.facilityId}
              </h1>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                isAccelerated
                  ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)] font-semibold"
                  : isDrawFrozen
                  ? "bg-[rgba(168,48,30,0.06)] text-[var(--breach)] border border-[rgba(168,48,30,0.15)]"
                  : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
              }`}>
                {facility.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="font-serif text-base text-[var(--ink-2)] italic">
              {facility.borrowerName} {facility.purpose && `(${facility.purpose})`}
            </div>
          </div>

          {authenticated && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setModalType("commit"); setActionAmountGen("100"); }}
                className="px-3 py-1.5 rounded bg-[var(--ink)] text-[var(--paper)] text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                Commit Capital
              </button>
              <button
                type="button"
                disabled={Boolean(isDrawFrozen || isAccelerated || availableVal <= 0n)}
                onClick={() => { setModalType("draw"); setActionAmountGen("50"); }}
                className="px-3 py-1.5 rounded border border-[var(--rule)] text-[var(--ink)] text-xs font-medium hover:bg-[var(--paper-2)] disabled:opacity-40 transition-colors cursor-pointer"
              >
                Draw Capital
              </button>
              <button
                type="button"
                disabled={drawnVal <= 0n}
                onClick={() => { setModalType("repay"); setActionAmountGen("10"); }}
                className="px-3 py-1.5 rounded border border-[var(--rule)] text-[var(--ink)] text-xs font-medium hover:bg-[var(--paper-2)] disabled:opacity-40 transition-colors cursor-pointer"
              >
                Repay Debt
              </button>
              <button
                type="button"
                onClick={() => { setModalType("withdraw"); setActionAmountGen("50"); }}
                className="px-3 py-1.5 rounded border border-[var(--rule)] text-[var(--ink-2)] text-xs font-medium hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
              >
                Withdraw Free
              </button>
            </div>
          )}
        </div>

        {/* Contract Counterparties Register */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-xs">
          <div className="space-y-0.5">
            <span className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Lender</span>
            <div className="font-mono text-[var(--ink)] truncate" title={facility.lenderAddress}>
              {facility.lenderEmail ?? formatAddress(facility.lenderAddress)}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Borrower</span>
            <div className="font-mono text-[var(--ink)] truncate" title={facility.borrowerAddress}>
              {facility.borrowerEmail ?? formatAddress(facility.borrowerAddress)}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Base Interest Rate</span>
            <div className="font-mono text-[var(--ink)] tabular-numbers">
              {formatBp(facility.rateBp)}
              {facility.stepUpBp > 0 && ` (+${formatBp(facility.stepUpBp)} step)`}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Agreed Principal</span>
            <div className="font-mono text-[var(--ink)] tabular-numbers">
              {formatAtto(facility.principalAtto)}
            </div>
          </div>
        </div>
      </div>

      {/* Credit Vault Position Breakdown */}
      <section className="space-y-3">
        <div className="flex items-center justify-between pb-1 ledger-rule">
          <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
            Credit Vault Balance Ledger
          </h2>
          {position && (
            <span className="text-xs font-mono text-[var(--ink-3)]">
              Effective: {formatBp(position.effectiveRateBp)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3.5 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-1">
            <div className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Committed Capital</div>
            <div className="text-xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {position ? formatAtto(position.committedAtto) : "0 GEN"}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">Funded by lender</div>
          </div>

          <div className="p-3.5 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-1">
            <div className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Drawn Outstanding</div>
            <div className="text-xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {position ? formatAtto(position.drawnAtto) : "0 GEN"}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">Outstanding debt</div>
          </div>

          <div className="p-3.5 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-1">
            <div className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Available To Draw</div>
            <div className="text-xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {formatAtto(availableVal.toString())}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">
              {isDrawFrozen ? "Draws frozen by covenant" : "Ready for takedown"}
            </div>
          </div>

          <div className="p-3.5 rounded border border-[var(--rule)] bg-[var(--paper)] space-y-1">
            <div className="text-[10px] font-mono uppercase text-[var(--ink-3)]">Accrued Interest</div>
            <div className="text-xl font-mono tabular-numbers font-semibold text-[var(--ink)]">
              {position ? formatAtto(position.accruedInterestAtto) : "0 GEN"}
            </div>
            <div className="text-[11px] text-[var(--ink-2)]">Calculated on chain</div>
          </div>
        </div>
      </section>

      {/* Covenants Schedule & Compliance Register */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 ledger-rule">
          <div className="space-y-0.5">
            <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
              Covenant Schedule & Consensus Status
            </h2>
            <div className="text-xs text-[var(--ink-2)]">
              Every promise is audited by GenLayer validators on schedule.
            </div>
          </div>

          {authenticated && (
            <button
              type="button"
              onClick={() => setModalType("add_covenant")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--ink)] text-[var(--paper)] text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span>Draft Covenant</span>
            </button>
          )}
        </div>

        {covenants.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[var(--rule)] rounded space-y-2">
            <div className="font-serif italic text-sm text-[var(--ink-2)]">
              No covenants attached to this credit agreement yet.
            </div>
            {authenticated && (
              <button
                type="button"
                onClick={() => setModalType("add_covenant")}
                className="text-xs text-[var(--ink)] underline underline-offset-2 hover:opacity-80"
              >
                Draft the first covenant promise
              </button>
            )}
          </div>
        ) : (
          <div className="border border-[var(--rule)] rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--paper-2)] border-b border-[var(--rule)] text-[10px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
                    <th className="py-3 px-4 w-12">#</th>
                    <th className="py-3 px-4 max-w-xs">Covenant Legal Prose</th>
                    <th className="py-3 px-4">Kind / Metric</th>
                    <th className="py-3 px-4">Threshold</th>
                    <th className="py-3 px-4">Cadence / Due</th>
                    <th className="py-3 px-4">Consequence</th>
                    <th className="py-3 px-4">Compliance Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--rule)]">
                  {covenants.map((c) => {
                    const isOffside = c.status === "breach_pending_cure" || c.status === "breached";
                    const hasAppeal = c.appealStatus === "open";

                    return (
                      <tr key={c.covenantIndex} className="ledger-row">
                        <td className="py-4 px-4 font-mono font-medium text-[var(--ink-3)]">
                          {c.covenantIndex}
                        </td>

                        <td className="py-4 px-4 space-y-1">
                          <div className="font-serif text-[13px] text-[var(--ink)] leading-snug">
                            &ldquo;{c.text}&rdquo;
                          </div>
                          {c.sourceUrls.length > 0 && (
                            <div className="text-[10px] font-mono text-[var(--ink-3)] truncate max-w-xs">
                              Source: {c.sourceUrls[0]}
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-4 font-mono text-[11px] text-[var(--ink)]">
                          <span className="uppercase tracking-wider text-[10px] text-[var(--ink-2)] block">
                            {c.kind}
                          </span>
                          {c.metric || c.kind}
                        </td>

                        <td className="py-4 px-4 font-mono text-[11px] tabular-numbers text-[var(--ink)]">
                          {c.comparator} {c.kind === "ratio" ? formatBp(c.thresholdBp, true) : c.kind === "treasury" ? formatAtto(c.thresholdAtto) : `${c.filingDeadlineDays} days`}
                        </td>

                        <td className="py-4 px-4 font-mono text-[11px] space-y-0.5">
                          <div className="text-[var(--ink)]">Every {c.testFrequencyHours}h</div>
                          <div className="text-[10px] text-[var(--ink-3)]">
                            Due: {formatIsoDate(c.nextDueAt)}
                          </div>
                        </td>

                        <td className="py-4 px-4 font-mono text-[11px] uppercase tracking-wider text-[var(--ink-2)]">
                          {c.breachConsequence.replace(/_/g, " ")}
                        </td>

                        <td className="py-4 px-4 space-y-1">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                            isOffside
                              ? "bg-[rgba(168,48,30,0.1)] text-[var(--breach)] border border-[rgba(168,48,30,0.2)]"
                              : "bg-[var(--paper-2)] text-[var(--signal-ink)] border border-[var(--rule)]"
                          }`}>
                            {isOffside ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                            <span>{c.status.replace(/_/g, " ")}</span>
                          </span>

                          {hasAppeal && (
                            <span className="block text-[10px] font-mono text-[var(--signal-ink)]">
                              Appeal Open ({formatAtto(c.appealBondAtto)})
                            </span>
                          )}

                          {c.cureDeadline && (
                            <span className="block text-[10px] font-mono text-[var(--breach)]">
                              Cure by: {formatIsoDate(c.cureDeadline)}
                            </span>
                          )}
                        </td>

                        <td className="py-4 px-4 text-right space-y-1">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void handleTestCovenant(c.covenantIndex)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--rule)] hover:bg-[var(--paper-2)] text-[var(--ink)] text-[11px] font-medium transition-colors cursor-pointer"
                              title="Trigger consensus test on chain"
                            >
                              <Play className="w-3 h-3 text-[var(--signal-ink)]" />
                              <span>Test</span>
                            </button>

                            {isOffside && !hasAppeal && authenticated && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCovenantIndex(c.covenantIndex);
                                  setModalType("appeal");
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[rgba(168,48,30,0.1)] border border-[rgba(168,48,30,0.2)] text-[var(--breach)] text-[11px] font-medium hover:bg-[rgba(168,48,30,0.2)] transition-colors cursor-pointer"
                              >
                                <span>Appeal</span>
                              </button>
                            )}

                            {hasAppeal && authenticated && (
                              <button
                                type="button"
                                onClick={() => void handleResolveAppeal(c.covenantIndex)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--rule)] text-[var(--ink)] text-[11px] font-medium hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
                              >
                                <span>Resolve</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Recent Test Findings For This Facility */}
      {tests.length > 0 && (
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between pb-1 ledger-rule">
            <h2 className="text-xs uppercase tracking-widest font-mono text-[var(--ink-3)]">
              Recent Consensus Findings Trail
            </h2>
            <Link
              href={`/evidence?facilityId=${encodeURIComponent(facilityId)}`}
              className="text-xs text-[var(--ink-2)] hover:text-[var(--ink)] underline underline-offset-2"
            >
              Inspect all citations
            </Link>
          </div>

          <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)] text-xs">
            {tests.map((t) => (
              <div key={t.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ledger-row px-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-[var(--ink)]">
                      Covenant #{t.covenantIndex}
                    </span>
                    <span className={`px-2 py-0.2 rounded text-[10px] font-mono uppercase ${
                      t.breached ? "text-[var(--breach)] bg-[rgba(168,48,30,0.08)]" : "text-[var(--signal-ink)]"
                    }`}>
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="font-serif italic text-[var(--ink-2)] text-[12px]">
                    {t.narrative}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--ink-3)] shrink-0">
                  <span>{formatIsoDate(t.testedAt)}</span>
                  <Link href={`/evidence/${t.id}`} className="hover:text-[var(--ink)] underline">
                    Citation
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Capital Action Modal */}
      {modalType && modalType !== "add_covenant" && modalType !== "appeal" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,26,35,0.6)] backdrop-blur-xs p-4">
          <div className="max-w-md w-full rounded border border-[var(--rule)] bg-[var(--paper)] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 ledger-rule">
              <h2 className="font-serif text-lg font-semibold text-[var(--ink)] capitalize">
                {modalType} Capital
              </h2>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded bg-[rgba(168,48,30,0.08)] border border-[rgba(168,48,30,0.2)] text-xs text-[var(--breach)]">
                {actionError}
              </div>
            )}

            <form onSubmit={handleCapitalAction} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Amount in GEN *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={actionAmountGen}
                  onChange={(e) => setActionAmountGen(e.target.value)}
                  placeholder="100"
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono text-sm focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 ledger-rule">
                <button
                  type="button"
                  onClick={() => setModalType(null)}
                  className="px-4 py-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded bg-[var(--ink)] text-[var(--paper)] font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer capitalize"
                >
                  {actionLoading ? "Signing on chain..." : `Confirm ${modalType}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Draft Covenant Modal */}
      {modalType === "add_covenant" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,26,35,0.6)] backdrop-blur-xs p-4 overflow-y-auto">
          <div className="max-w-xl w-full rounded border border-[var(--rule)] bg-[var(--paper)] p-6 space-y-4 shadow-xl my-8">
            <div className="flex items-center justify-between pb-2 ledger-rule">
              <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                Draft Covenant Clause
              </h2>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded bg-[rgba(168,48,30,0.08)] border border-[rgba(168,48,30,0.2)] text-xs text-[var(--breach)]">
                {actionError}
              </div>
            )}

            <form onSubmit={handleDraftCovenant} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Covenant Promise Text (legal clause in full) *
                </label>
                <textarea
                  required
                  rows={3}
                  value={covText}
                  onChange={(e) => setCovText(e.target.value)}
                  placeholder="The Borrower covenants that the consolidated Leverage Ratio shall not exceed 3.50:1.00 at any quarterly test date."
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-serif focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Covenant Metric Name *
                </label>
                <input
                  type="text"
                  required
                  value={covMetric}
                  onChange={(e) => setCovMetric(e.target.value)}
                  placeholder="Consolidated Leverage Ratio"
                  className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono text-xs focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Covenant Kind *</label>
                  <select
                    value={covKind}
                    onChange={(e) => setCovKind(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  >
                    <option value="ratio">ratio (financial ratio)</option>
                    <option value="filing">filing (regulatory deadline)</option>
                    <option value="treasury">treasury (on-chain balance)</option>
                    <option value="prose">prose (governance promise)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Breach Consequence *</label>
                  <select
                    value={covConsequence}
                    onChange={(e) => setCovConsequence(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  >
                    <option value="draw_stop">draw_stop (freeze capital draws)</option>
                    <option value="rate_step_up">rate_step_up (increase interest rate)</option>
                    <option value="acceleration">acceleration (accelerate full debt)</option>
                  </select>
                </div>
              </div>

              {covKind === "ratio" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="font-mono text-[11px] text-[var(--ink-2)]">Numerator Figure Name *</label>
                    <input
                      type="text"
                      required
                      value={covNumLabel}
                      onChange={(e) => setCovNumLabel(e.target.value)}
                      placeholder="Total Debt"
                      className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono text-[11px] text-[var(--ink-2)]">Denominator Figure Name *</label>
                    <input
                      type="text"
                      required
                      value={covDenomLabel}
                      onChange={(e) => setCovDenomLabel(e.target.value)}
                      placeholder="EBITDA"
                      className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)]"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Comparator *</label>
                  <select
                    value={covComparator}
                    onChange={(e) => setCovComparator(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  >
                    <option value="lte">lte (&le;)</option>
                    <option value="gte">gte (&ge;)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Threshold Value *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={covThresholdVal}
                    onChange={(e) => setCovThresholdVal(e.target.value)}
                    placeholder="3.5"
                    className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Frequency (hours) *</label>
                  <input
                    type="number"
                    required
                    value={covFrequencyHours}
                    onChange={(e) => setCovFrequencyHours(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] text-[var(--ink-2)]">Cure Period (hours)</label>
                  <input
                    type="number"
                    value={covCureHours}
                    onChange={(e) => setCovCureHours(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                  />
                </div>

                {covKind === "filing" && (
                  <div className="space-y-1">
                    <label className="font-mono text-[11px] text-[var(--ink-2)]">Filing Deadline (days)</label>
                    <input
                      type="number"
                      value={covDeadlineDays}
                      onChange={(e) => setCovDeadlineDays(e.target.value)}
                      className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Source URLs to Audit (one per line)
                </label>
                <textarea
                  rows={2}
                  value={covUrls}
                  onChange={(e) => setCovUrls(e.target.value)}
                  placeholder="https://sec.gov/edgar/...&#10;https://investor.acme.com/q3-report"
                  className="w-full px-3 py-1.5 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono text-[11px]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 ledger-rule">
                <button
                  type="button"
                  onClick={() => setModalType(null)}
                  className="px-4 py-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded bg-[var(--ink)] text-[var(--paper)] font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? "Drafting on chain..." : "Sign & Add Covenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appeal Modal */}
      {modalType === "appeal" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,26,35,0.6)] backdrop-blur-xs p-4">
          <div className="max-w-md w-full rounded border border-[var(--rule)] bg-[var(--paper)] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 ledger-rule">
              <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                Dispute Breach Finding (Post Bond)
              </h2>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--ink-2)]">
              Borrowers may appeal a finding by posting a bond. The cure clock continues running.
              If the retest overturns the breach, the bond is returned; if confirmed, the bond is awarded to the lender.
            </p>

            {actionError && (
              <div className="p-3 rounded bg-[rgba(168,48,30,0.08)] border border-[rgba(168,48,30,0.2)] text-xs text-[var(--breach)]">
                {actionError}
              </div>
            )}

            <form onSubmit={handleAppeal} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-mono text-[11px] text-[var(--ink-2)]">
                  Dispute Bond (GEN) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={appealBondGen}
                  onChange={(e) => setAppealBondGen(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--ink)]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 ledger-rule">
                <button
                  type="button"
                  onClick={() => setModalType(null)}
                  className="px-4 py-2 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded bg-[var(--ink)] text-[var(--paper)] font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? "Posting bond on chain..." : "Sign & Post Bond"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
